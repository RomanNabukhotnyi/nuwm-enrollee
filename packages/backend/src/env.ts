import { parseEnv } from 'znv';
import { z } from 'zod';

const env = parseEnv(process.env, {
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string(),
  TELEGRAM_TOKEN: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
});

export default env;