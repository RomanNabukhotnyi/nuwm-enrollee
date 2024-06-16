import api from '../../api/index.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
  try {
    const response = await api.files.$get();
    const data = await response.json();

    if ('error' in data) {
      return { error: data.error };
    }

    return { files: data.items || [] };
  } catch (error) {
    console.error(error);
    return { error: 'Unable to fetch files' };
  }
};
