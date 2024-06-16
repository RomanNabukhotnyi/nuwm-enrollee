import { parseEnv } from 'znv';
import { z } from 'zod';
import 'dotenv/config';

const env = parseEnv(process.env, {
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string(),
  TELEGRAM_TOKEN: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  FRONTEND_URL: z.string().url(),
});

export default env;
