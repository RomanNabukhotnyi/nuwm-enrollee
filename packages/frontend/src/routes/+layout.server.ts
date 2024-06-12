import api from '../api';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
  const res = await api.me.get();
  if (res.status === 401) {
    return {
      user: null,
    };
  }
  return {
    user: res.data?.user ?? null,
  };
};
