import { getTextExtractor } from 'office-text-extractor';
import { db } from '../db';
import { documentSections, documents } from '../db/schema';
import openai from '../openai';
import { getDocument } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { getTextFromImagesInDocx, getTextFromImagesInPDFPage } from './images';
import { encoding_for_model } from 'tiktoken';
import Tesseract from 'tesseract.js';
import { cleanText } from './text';
import { PromisePool } from './promise-pool';

const CHUNK_SIZE = 800;
const OVERLAP_SIZE = 400;

const pool = new PromisePool(3, 2500, 1024);

// const pipeline = new PromisePipeline('chunks',500, 2500);

const extractor = getTextExtractor();

const getContent = async (type: string, buffer: Buffer) => {
  let content = '';

  // image
  if (type === 'png' || type === 'jpeg' || type === 'jpg') {
    const data = await Tesseract.recognize(buffer, 'ukr', {});
    content += data.data.text;
  } else if (type === 'pdf') {
    const doc = await getDocument({
      data: Uint8Array.from(buffer),
      verbosity: 0,
    }).promise;
    const numPages = doc.numPages;

    let strings: string[] = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const textFromImages = await getTextFromImagesInPDFPage(page);
      strings.push(...textContent.items.map((item) => (item as TextItem).str), textFromImages);
    }
    content += strings.join(' ');

    // Free the memory used by the document
    strings = [];
    doc.cleanup();
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

  const enc = encoding_for_model('gpt-3.5-turbo');
  const tokens = enc.encode(cleanedContent);
  const chunks: string[] = [];

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE - OVERLAP_SIZE) {
    const tokensChunk = tokens.slice(i, i + CHUNK_SIZE);
    const chunk = enc.decode(tokensChunk);
    const buffer = Buffer.from(chunk);
    const textChunk = buffer.toString('utf-8');
    chunks.push(textChunk);
  }

  // Free the memory used by the encoder
  enc.free();

  // Ensure the last chunk has at least 500 characters
  // if (chunks.length > 1 && chunks[chunks.length - 1].length < CHUNK_SIZE) {
  //   chunks.pop();
  // }

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

  for (let i = 0; i < chunks.length; i++) {
    pool.add(async () => {
      const {
        data: [{ embedding }],
      } = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunks[i],
      });

      await db.insert(documentSections).values([
        {
          documentId: document.id,
          content: chunks[i],
          embedding,
        },
      ]);
    });
  }
};
