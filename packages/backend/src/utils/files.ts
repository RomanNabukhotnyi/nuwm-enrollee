import { getTextExtractor } from 'office-text-extractor';
import { db } from '../db';
import { documentSections, documents } from '../db/schema';
import openai from '../openai';
import { getDocument } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { getTextFromImagesInDocx, getTextFromImagesInPDF } from './images';
import { PromisePipeline } from './pipeline';
import { get_encoding } from 'tiktoken';
import Tesseract from 'tesseract.js';
import { cleanText } from './text';

const MAX_CHUNK_SIZE = 8000;
const MIN_CHUNK_SIZE = 500;

// Create a pipeline to process text in parallel with a rate limit of 2950 per minute
const pipeline = new PromisePipeline(2950);

const extractor = getTextExtractor();

const getContent = async (type: string, buffer: Buffer) => {
  let content = '';

  // image
  if (type === 'png' || type === 'jpeg' || type === 'jpg') {
    const data = await Tesseract.recognize(buffer, 'ukr', {});
    content += data.data.text;
  } else if (type === 'pdf') {
    const doc = await getDocument(Uint8Array.from(buffer)).promise;
    const numPages = doc.numPages;

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const strings = textContent.items.map((item) => (item as TextItem).str);
      content += `${strings.join(' ')} `;
    }

    content += await getTextFromImagesInPDF(buffer);
  } else if (type === 'docx') {
    content = await extractor.extractText({
      input: buffer,
      type: 'buffer',
    });
    content += await getTextFromImagesInDocx(buffer);
  } else {
    console.error(`Unsupported file type: ${type}`);
    return '';
  }

  return content;
};

export const processFile = async (name: string, type: string, buffer: Buffer) => {
  const content = await getContent(type, buffer);

  const cleanedContent = cleanText(content);

  const enc = get_encoding('cl100k_base');
  const tokens = enc.encode(cleanedContent);
  const chunks = [];

  for (let i = 0; i < tokens.length; i += MAX_CHUNK_SIZE) {
    const tokensChunk = tokens.slice(i, i + MAX_CHUNK_SIZE);
    const chunk = enc.decode(tokensChunk);
    const buffer = Buffer.from(chunk);
    const textChunk = buffer.toString('utf-8');
    chunks.push(textChunk);
  }

  // Free the memory used by the encoder
  enc.free();

  // Ensure the last chunk has at least 500 characters
  if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_CHUNK_SIZE) {
    chunks.pop();
  }

  if (chunks.length === 0) {
    return;
  }

  const [document] = await db
    .insert(documents)
    .values([
      {
        name,
      },
    ])
    .returning();

  for (const chunk of chunks) {
    pipeline.add(async () => {
      console.log('chunk', chunk.length);
      const {
        data: [{ embedding }],
      } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk,
      });

      await db.insert(documentSections).values([
        {
          documentId: document.id,
          content: chunk,
          embedding,
        },
      ]);
    });
  }

  console.log(`Text processed in file: ${name}`);
};
