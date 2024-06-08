// Clean the text by removing special characters, extra whitespace and newlines
export const cleanText = (text: string): string => {
  const regex = /[^a-zA-Zа-яА-Я0-9.,!?;:() \n\r\t-]/g;
  let refinedText = text;
  refinedText = refinedText.replace(regex, '');
  refinedText = refinedText.replace(/\s{2,}/g, ' ');
  refinedText = refinedText.replace('\n', ' ');
  refinedText = refinedText.trim();
  return refinedText;
};
