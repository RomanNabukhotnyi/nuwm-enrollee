import JSZip from 'jszip';
import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import Tesseract, { createWorker } from 'tesseract.js';
import sharp, { type SharpOptions } from 'sharp';
import fs from 'node:fs';

import path from 'node:path';

const uploadDirectory = path.join(__dirname, '../../uploads');

const optimizeImage = async (buffer: Buffer, options?: SharpOptions) => {
  const optimized = await sharp(buffer, options)
    .toFormat('jpeg')
    // resize image to 1000px width
    .resize({ width: 1000 })
    // convert image to grayscale
    .grayscale()
    // normalize image
    .normalize()
    // convert image to buffer
    .toBuffer();
  return optimized;
};

export const getTextFromImagesInDocx = async (buffer: Buffer) => {
  const zip = new JSZip();
  await zip.loadAsync(buffer);

  const files = zip.file(/.*/);
  let content = '';

  for (const file of files) {
    const name = file.name.split('/').pop() as string;
    const type = name.split('.').pop() as string;
    if (type === 'png' || type === 'jpeg' || type === 'jpg') {
      const filePath = path.join(uploadDirectory, name);
      await fs.promises.writeFile(filePath, file.nodeStream('nodebuffer'));
      //   const optimized = await optimizeImage(buffer);
      const data = await Tesseract.recognize(filePath, 'ukr', {});
      content += data.data.text;
    }
  }

  return content;
};

export const getTextFromImagesInPDFPage = async (page: PDFPageProxy) => {
  let content = '';

  const ops = await page.getOperatorList();

  for (let i = 0; i < ops.fnArray.length; i++) {
    try {
      if (ops.fnArray[i] === OPS.paintImageXObject || ops.fnArray[i] === OPS.paintInlineImageXObject) {
        const objId = ops.argsArray[i][0];
        const common = page.commonObjs.has(objId);
        const img = await (common ? page.commonObjs.get(objId) : page.objs.get(objId));
        const { width, height, kind } = img;
        const bytes = img.data.length;
        const channels = bytes / width / height;
        if (!(channels === 1 || channels === 2 || channels === 3 || channels === 4)) {
          console.warn(`Invalid image channel: ${channels} for image ${objId} on page ${page}`);
          continue;
        }

        const optimized = await optimizeImage(img.data, {
          raw: { width, height, channels },
        });
        const worker = await createWorker('ukr');
        const data = await worker.recognize(optimized);
        await worker.terminate();

        content += data.data.text;
      }
    } catch (error) {
      console.error(error);
    }
  }

  return content;
};
