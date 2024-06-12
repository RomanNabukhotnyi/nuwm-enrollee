import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { Telegraf } from 'telegraf';
import openai from './openai';
import { db } from './db';
import { documentSections, documents } from './db/schema';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import env from './env';
import { eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { processFile } from './utils/files';
import { cleanText } from './utils/text';
import { get_encoding } from 'tiktoken';
import { OAuth2RequestError, generateState } from 'arctic';
import { github, lucia, usersTable } from './db/lucia';
import { type Session, type User, generateIdFromEntropySize, verifyRequestOrigin } from 'lucia';

interface GitHubUser {
  id: number;
  login: string;
}

await migrate(db, {
  migrationsFolder: './drizzle',
});

const app = new Elysia()
  .derive(
    async (
      context,
    ): Promise<{
      user: User | null;
      session: Session | null;
    }> => {
      // CSRF check
      // if (context.request.method !== 'GET') {
      //   const originHeader = context.request.headers.get('Origin');
      //   // NOTE: You may need to use `X-Forwarded-Host` instead
      //   const hostHeader = context.request.headers.get('Host');
      //   if (!originHeader || !hostHeader || !verifyRequestOrigin(originHeader, [hostHeader])) {
      //     return {
      //       user: null,
      //       session: null,
      //     };
      //   }
      // }

      // use headers instead of Cookie API to prevent type coercion
      const cookieHeader = context.request.headers.get('Cookie') ?? '';
      const sessionId = lucia.readSessionCookie(cookieHeader);
      if (!sessionId) {
        return {
          user: null,
          session: null,
        };
      }

      const { session, user } = await lucia.validateSession(sessionId);
      if (session?.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id);
        context.cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
        });
      }
      if (!session) {
        const sessionCookie = lucia.createBlankSessionCookie();
        context.cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
        });
      }
      return {
        user,
        session,
      };
    },
  )
  .use(cors())
  .get('/sign-in', async ({ cookie: { github_oauth_state }, redirect }) => {
    const state = generateState();
    const url = await github.createAuthorizationURL(state);

    github_oauth_state.set({
      value: state,
      path: '/',
      secure: false,
      httpOnly: true,
      maxAge: 60 * 10,
      sameSite: 'lax',
    });

    return redirect(url.toString(), 302);
  })
  .get('/sign-in/callback', async ({ query: { code, state }, cookie, error, redirect }) => {
    const storedState = cookie.github_oauth_state.value;

    if (!code || !state || !storedState || state !== storedState) {
      return error(400);
    }

    try {
      const tokens = await github.validateAuthorizationCode(code);
      const githubUserResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
      const githubUser: GitHubUser = await githubUserResponse.json();

      // Replace this with your own DB client.
      const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.githubId, githubUser.id));

      if (existingUser) {
        const session = await lucia.createSession(existingUser.id, {});
        const sessionCookie = lucia.createSessionCookie(session.id);

        cookie[sessionCookie.name].set(sessionCookie);
      } else {
        const userId = generateIdFromEntropySize(10); // 16 characters long

        // Replace this with your own DB client.
        await db.insert(usersTable).values({
          id: userId,
          githubId: githubUser.id,
          username: githubUser.login,
        });

        const session = await lucia.createSession(userId, {});
        const sessionCookie = lucia.createSessionCookie(session.id);
        cookie[sessionCookie.name].set(sessionCookie);
      }
      return redirect('/', 302);
    } catch (e) {
      // the specific error message depends on the provider
      if (e instanceof OAuth2RequestError) {
        // invalid code
        return error(400);
      }
      // some other error
      return error(500);
    }
  })
  .post(
    '/upload',
    async ({ user, error, body: { file } }) => {
      if (!user) {
        return error(401);
      }

      const type = file.type.split('/')[1];
      const data = await file.arrayBuffer();

      // If the file is a zip file, extract the contents and upload each file
      if (type === 'zip') {
        const zip = new JSZip();
        await zip.loadAsync(data);

        const files = zip.file(/.*/);

        const promises = files.map(async (file) => {
          const name = file.name.split('/').pop() as string;
          const type = name.split('.').pop() as string;
          const buffer = await file.async('nodebuffer');
          console.log('file', {
            name,
            type,
          });
          processFile(name, type, buffer).catch((error) => {
            console.error(`Error processing text in file: ${name}`, error);
          });
        });

        Promise.all(promises);
      } else {
        const name = file.name;
        const type = name.split('.').pop() as string;
        const buffer = Buffer.from(data);
        console.log('file', {
          name,
          type,
        });
        processFile(name, type, buffer).catch((error) => {
          console.error(`Error processing text in file: ${name}`, error);
        });
      }

      return {
        message: 'Document uploaded successfully!',
      };
    },
    {
      type: 'multipart/form-data',
      body: t.ObjectString({
        relativePath: t.String(),
        type: t.String(),
        name: t.String(),
        file: t.File(),
      }),
    },
  )
  .get('/files', async ({ user, error }) => {
    if (!user) {
      return error(401);
    }

    const addDocuments = await db.select().from(documents);
    return {
      items: addDocuments,
    };
  })
  .delete(
    '/files/:id',
    async ({ user, params: { id }, error }) => {
      if (!user) {
        return error(401);
      }

      await db.delete(documents).where(eq(documents.id, id));

      return {
        message: 'Document deleted successfully!',
      };
    },
    {
      params: t.Object({
        id: t.Number(),
      }),
    },
  )
  .listen(3000);

export type App = typeof app;

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);

const bot = new Telegraf(env.TELEGRAM_TOKEN);

bot.start((ctx) => ctx.reply('Welcome!'));

bot.on('text', async (ctx) => {
  const {
    data: [{ embedding }],
  } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: [ctx.message.text],
  });

  const embeddingString = JSON.stringify(embedding);

  const sections = await db
    .select()
    .from(documentSections)
    .where(sql`${documentSections.embedding} <#> ${embeddingString} < 0.8`)
    .orderBy(sql`${documentSections.embedding} <#> ${embeddingString}`)
    .limit(5);

  const injectedSections =
    sections.length > 0 ? sections.map((section) => section.content).join() : 'No documents found';

  let systemMessage = `
		You're an AI assistant who answers questions about documents.
		You're a chat bot, so keep your replies succinct.
		You're only allowed to use the documents below to answer the question.
		If the question isn't related to these documents or if the information isn't available in the below documents, say:
		"Вибачте, я не зміг знайти жодної інформації на цю тему."
		Do not go off topic.
		Documents:
		${injectedSections}
	`;

  const enc = get_encoding('cl100k_base');
  const tokens = enc.encode(systemMessage);
  // Get the first 3000 tokens
  const tokensChunk = tokens.slice(0, 3000);
  const chunk = enc.decode(tokensChunk);
  const buffer = Buffer.from(chunk);
  systemMessage = buffer.toString('utf-8');

  const question = cleanText(ctx.message.text);
  const tokensQuestion = enc.encode(question);
  // if the question is greater than 150 tokens, throw an error
  if (tokensQuestion.length > 150) {
    ctx.reply('Запит занадто довгий. Будь ласка, введіть коротший запит.');
    return;
  }

  // Free the memory used by the encoder
  enc.free();

  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: question,
      },
    ],
  });

  const message = response.choices[0].message.content as string;

  ctx.reply(message);
});

bot.launch(() => {
  console.log('🤖 Telegram bot is running!');
});
