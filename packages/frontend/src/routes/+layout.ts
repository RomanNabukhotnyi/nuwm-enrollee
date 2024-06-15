import api from '../api';
import type { LayoutLoad } from './$types';

export const ssr = false;

// export const load: LayoutLoad = async () => {
//   const res = await api.me.get();
//   if (res.status === 401) {
//     return {
//       user: null,
//     };
//   }
//   return {
//     user: res.data?.user ?? null,
//   };
// };
