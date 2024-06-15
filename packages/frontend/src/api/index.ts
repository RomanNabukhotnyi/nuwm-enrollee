// client.ts
import { treaty } from '@elysiajs/eden';
import type { App } from '../../../backend/src/index';

const api = treaty<App>(
  process.env.NODE_ENV === 'production' ? 'https://nuwm-enrollee-be.fly.dev' : 'http://localhost:3000',
  {
    fetch: {
      credentials: 'include',
    },
  },
);

export default api;
