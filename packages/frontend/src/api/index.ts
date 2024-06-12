// client.ts
import { treaty } from '@elysiajs/eden';
import type { App } from '../../../backend/src/index';

const api = treaty<App>('https://nuwm-enrollee-be.fly.dev', {
  fetch: {
    credentials: 'include',
  },
});

export default api;
