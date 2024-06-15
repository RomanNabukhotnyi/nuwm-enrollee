import { encoding_for_model } from 'tiktoken';

export const numTokens = (text: string): number => {
  const enc = encoding_for_model('gpt-3.5-turbo');
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
};
