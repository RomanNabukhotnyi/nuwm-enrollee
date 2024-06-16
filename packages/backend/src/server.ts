import { db } from './db';
import { documents, usersTable } from './db/schema';
import env from './env';
import { eq } from 'drizzle-orm';
import { getCookie, setCookie } from 'hono/cookie';
import { OAuth2RequestError, generateState } from 'arctic';
import { github, lucia } from './db/lucia';
import { type Session, type User, generateIdFromEntropySize } from 'lucia';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { cors } from 'hono/cors';

const pipelineAsync = promisify(pipeline);

interface GitHubUser {
  id: number;
  login: string;
}

const uploadDirectory = path.join(__dirname, 'uploads');

const app = new Hono<{
  Variables: {
    user: User | null;
    session: Session | null;
  };
}>();

app.use(
  '*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);

app.use('*', async (c, next) => {
  const sessionId = getCookie(c, lucia.sessionCookieName) ?? null;
  if (!sessionId) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }
  const { session, user } = await lucia.validateSession(sessionId);
  if (session?.fresh) {
    // use `header()` instead of `setCookie()` to avoid TS errors
    c.header('Set-Cookie', lucia.createSessionCookie(session.id).serialize(), {
      append: true,
    });
  }
  if (!session) {
    c.header('Set-Cookie', lucia.createBlankSessionCookie().serialize(), {
      append: true,
    });
  }
  c.set('user', user);
  c.set('session', session);
  return next();
});

const route = app
  .get('/sign-in', async (ctx) => {
    const state = generateState();
    const url = await github.createAuthorizationURL(state);

    setCookie(ctx, 'github_oauth_state', state, {
      path: '/',
      secure: false,
      httpOnly: true,
      maxAge: 60 * 10,
      sameSite: 'lax',
    });

    return ctx.redirect(url.toString(), 302);
  })
  .get('/sign-in/callback', zValidator('query', z.object({ code: z.string(), state: z.string() })), async (ctx) => {
    const { code, state } = ctx.req.query();
    const storedState = getCookie(ctx, 'github_oauth_state');

    if (!code || !state || !storedState || state !== storedState) {
      return ctx.json({ error: 'Invalid state' }, 400);
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

        setCookie(ctx, sessionCookie.name, sessionCookie.value, {
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
        setCookie(ctx, sessionCookie.name, sessionCookie.value, {
          ...sessionCookie.attributes,
          sameSite: 'none',
        });
      }

      return ctx.redirect(env.FRONTEND_URL, 302);
    } catch (e) {
      // the specific error message depends on the provider
      if (e instanceof OAuth2RequestError) {
        // invalid code
        return ctx.json({ error: e.message }, 400);
      }
      // some other error
      return ctx.json({ error: 'Internal Server Error' }, 500);
    }
  })
  .get('/me', async (ctx) => {
    const user = ctx.get('user');

    if (!user) {
      return ctx.json({ error: 'Unauthorized' }, 401);
    }

    return ctx.json({
      user,
    });
  })
  .post('/upload', async (ctx) => {
    const user = ctx.get('user');

    if (!user) {
      return ctx.json({ error: 'Unauthorized' }, 401);
    }

    const body = await ctx.req.parseBody();
    const file = body.file;

    // Assuming 'file' is a Readable stream from the request
    if (!(file instanceof File)) {
      return ctx.json({ error: 'No file uploaded' }, 400);
    }

    const filePath = path.join(uploadDirectory, file.name);

    try {
      // Ensure the 'uploads' directory exists
      if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
      }

      const writeStream = fs.createWriteStream(filePath);
      const readStream = file.stream();

      await pipelineAsync(readStream as unknown as NodeJS.ReadableStream, writeStream);

      // File upload successful
      return ctx.json({ status: 'success', message: 'File uploaded successfully', path: filePath });
    } catch (err) {
      console.error('Error uploading file:', err);
      return ctx.json({ error: 'Error uploading file' }, 500);
    }
  })
  .get('/files', async (ctx) => {
    const user = ctx.get('user');

    if (!user) {
      return ctx.json({ error: 'Unauthorized' }, 401);
    }

    const addDocuments = await db.select().from(documents);
    return ctx.json({
      items: addDocuments,
    });
  })
  .delete('/files/:id', async (ctx) => {
    const user = ctx.get('user');
    if (!user) {
      return ctx.json({ error: 'Unauthorized' }, 401);
    }

    const { id } = ctx.req.param();

    await db.delete(documents).where(eq(documents.id, +id));

    return ctx.json({
      message: 'Document deleted successfully!',
    });
  });

export type App = typeof route;

export default app;
