import api from '../../api/index.js';
import type { PageLoad } from './$types.js';

export const load: PageLoad = async () => {
  try {
    const response = await api.files.get();
    return { files: response.data?.items || [] };
  } catch (error) {
    console.error(error);
    return { error: 'Unable to fetch files' };
  }
};
