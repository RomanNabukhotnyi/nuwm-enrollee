// client.ts
import { hc } from 'hono/client';
import type { App } from '../../../backend/src/server';

const api = hc<App>(import.meta.env.VITE_SERVER_URL || '', {
  fetch(input, requestInit, _Env, _executionCtx) {
    return fetch(input, {
      ...requestInit,
      credentials: 'include',
    });
  },
});

export default api;
