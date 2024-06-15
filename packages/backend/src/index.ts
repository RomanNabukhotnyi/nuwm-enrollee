import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { Telegraf } from 'telegraf';
import openai from './openai';
import { db } from './db';
import { documentSections, documents, usersTable } from './db/schema';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import env from './env';
import { eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { processFile } from './utils/files';
import { cleanText } from './utils/text';
import { OAuth2RequestError, generateState } from 'arctic';
import { github, lucia } from './db/lucia';
import { type Session, type User, generateIdFromEntropySize } from 'lucia';
import { numTokens } from './utils/tokens';
import { PromisePipeline } from './utils/pipeline';
import { PromisePool } from './utils/promise-pool';

interface GitHubUser {
  id: number;
  login: string;
}

await migrate(db, {
  migrationsFolder: './drizzle',
});

// const pipeline = new PromisePipeline('files', 10);

const pool = new PromisePool(1, 100, 1024);

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
  .use(
    cors({
      origin: () => true,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    }),
  )
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

        cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
          sameSite: 'none',
        });
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
        cookie[sessionCookie.name].set({
          value: sessionCookie.value,
          ...sessionCookie.attributes,
          sameSite: 'none',
        });
      }

      return redirect(env.FRONTEND_URL, 302);
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
  .get('/me', async ({ user, error }) => {
    if (!user) {
      return error(401);
    }

    return {
      user,
    };
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
          pool.add(async () => {
            await processFile(name, type, buffer).catch((error) => {
              console.error(`Error processing text in file: ${name}`, error);
            });
          });
        });

        Promise.all(promises);
      } else {
        const name = file.name;
        const type = name.split('.').pop() as string;
        const buffer = Buffer.from(data);
        pool.add(async () => {
          processFile(name, type, buffer).catch((error) => {
            console.error(`Error processing text in file: ${name}`, error);
          });
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

const TOKEN_BUDGET = 4096 - 500;

const systemMessage = `
  Ви — корисний помічник для абітурієнта Національного університету водного господарства та природокористування. 
  Коли вам надається секції, ви відповідаєте на запитання, використовуючи спочатку цю інформацію, і ви ЗАВЖДИ форматуєте свої відповіді у форматі Markdown.
  При можливості згадуйте та посилайтеся на приймальну комісію НУВГП або просто на Національний університет водного господарства та природокористування, якщо це доречно. 
  Відповідь повинна бути не надто довгою, не більше 3000 символів. 
  Якщо ви не впевнені і відповідь не прописана явно в наданих секціях, ви можете спробувати знайти відповідь десь, але якщо не знайдено, то говорите: "Вибачте, але я молодий чат-бот і поки не знаю відповіді. Будь ласка, задайте уточнене питання або зверніться до приймальної комісії НУВГП (м. Рівне, вул. М. Карнаухова, 53а, 7-й корпус НУВГП, ауд. 729, +38 (068) 477-83-66). Або пошукайте інформацію на нашому сайті https://nuwm.edu.ua/vstup".
  `.replace(/\n/g, '');

bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');

  try {
    const query = cleanText(ctx.message.text);

    const {
      data: [{ embedding }],
    } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: [query],
    });

    const embeddingString = JSON.stringify(embedding);

    const sections = await db
      .select()
      .from(documentSections)
      .where(sql`${documentSections.embedding} <#> ${embeddingString} < 0.7`)
      .orderBy(sql`${documentSections.embedding} <#> ${embeddingString}`)
      .limit(5);

    // console.log('sections', sections.length);

    // const injectedSections =
    //   sections.length > 0 ? sections.map((section) => section.content).join() : 'No documents found';

    // console.log('injectedSections', injectedSections);

    // const tokensPerSection = sections.length > 0 ? Math.floor(12000 / sections.length) : 12000;

    // const context = sections
    //   .map((section, index) => {
    //     // const enc = get_encoding('cl100k_base');
    //     // const tokens = enc.encode(section.content);
    //     // const tokensChunk = tokens.slice(0, tokensPerSection);
    //     // const chunk = enc.decode(tokensChunk);
    //     // const buffer = Buffer.from(chunk);
    //     // section.content = buffer.toString('utf-8');
    //     // enc.free();

    //     return section.content;
    //   })
    //   .join('');

    const introduction = 'Використовуй нижченаведені секції для відповіді на запитання.';
    const question = `\n\nЗапитання: ${query}`;
    let message = introduction;
    for (const section of sections) {
      const nextSection = `\n\nSection:\n"""\n${section.content}"""\n`;
      if (numTokens(message + nextSection + question) > TOKEN_BUDGET) {
        break;
      }

      message += nextSection;
    }
    message += question;

    // const enc = get_encoding('cl100k_base');

    // const tokensQuestion = enc.encode(question);
    // if the question is greater than 150 tokens, throw an error
    // if (tokensQuestion.length > 150) {
    //   ctx.reply('Запит занадто довгий. Будь ласка, введіть коротший запит.');
    //   return;
    // }

    // Free the memory used by the encoder
    // enc.free();

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemMessage,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      temperature: 0,
      // top_p: 1,
      // frequency_penalty: 0,
      // presence_penalty: 0,
      // max_tokens: 1500,
      // n: 1,
    });

    const answer = response.choices[0].message.content as string;

    ctx.reply(answer, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error processing message:', error);
    ctx.reply('Вибачте, сталася помилка під час обробки вашого запиту. Будь ласка, спробуйте ще раз.');
  }
});

bot.launch(() => {
  console.log('🤖 Telegram bot is running!');
});
