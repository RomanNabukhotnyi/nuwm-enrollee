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

await migrate(db, {
  migrationsFolder: './drizzle',
});

const app = new Elysia()
  .use(cors())
  .post(
    '/upload',
    async ({ body: { file } }) => {
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
  .get('/files', async () => {
    const addDocuments = await db.select().from(documents);
    return {
      items: addDocuments,
    };
  })
  .delete(
    '/files/:id',
    async ({ params: { id } }) => {
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
    sections.length > 0 ? sections.map((section) => section.content).join('\n\n') : 'No documents found';

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

  // prepare message for GPT-3
  systemMessage = cleanText(systemMessage);

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
