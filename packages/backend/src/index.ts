import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db';
import { serve } from '@hono/node-server';
import { documentSections } from './db/schema';
import openai from './openai';
import env from './env';
import { processFiles } from './cron';
import cron from 'node-cron';
import app from './server';
import { Telegraf } from 'telegraf';
import { cleanText } from './utils/text';
import { sql } from 'drizzle-orm';
import { numTokens } from './utils/tokens';

const main = async () => {
  await migrate(db, {
    migrationsFolder: './drizzle',
  });

  serve(
    {
      fetch: app.fetch,
      hostname: '0.0.0.0',
      port: 3000,
    },
    (info) => {
      console.info(`Listening on http://${info.address}:${info.port}`);
    },
  );

  // every minute
  cron.schedule('*/1 * * * *', processFiles);

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
        .limit(10);

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
};

main();
