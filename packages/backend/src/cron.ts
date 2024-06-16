import { promises as fs } from 'node:fs';
import path from 'node:path';
import { processFile } from './utils/files';
import JSZip from 'jszip';

const uploadDirectory = path.join(__dirname, 'uploads');
const processingFiles = new Set<string>();

export const processFiles = async () => {
  try {
    const files = await fs.readdir(uploadDirectory); // Читання файлів з директорії для завантаження
    console.log('Files in upload directory:', files.length);
    for (const file of files) {
      const filePath = path.join(uploadDirectory, file);

      if (processingFiles.has(filePath) || processFiles.length >= 1) {
        break; // Пропуск файлу, якщо він вже обробляється або кількість оброблюваних файлів перевищує 1
      }

      processingFiles.add(filePath);

      try {
        const fileBuffer = await fs.readFile(filePath); // Читання файлу у буфер
        const type = path.extname(file).substring(1); // Визначення типу файлу за його розширенням

        if (type === 'zip') {
          const zip = new JSZip();
          await zip.loadAsync(fileBuffer); // Завантаження zip-файлу

          const zipFiles = zip.file(/.*/);

          for (const zipFile of zipFiles) {
            const name = zipFile.name.split('/').pop() as string;
            const type = name.split('.').pop() as string;
            const buffer = await zipFile.async('nodebuffer');
            await processFile(name, type, buffer); // Обробка файлу з архіву
          }
        } else {
          const name = path.basename(file);
          await processFile(name, type, fileBuffer); // Обробка звичайного файлу
        }

        await fs.unlink(filePath); // Видалення файлу після обробки
      } catch (error) {
        console.error(`Error processing file: ${filePath}`, error); // Логування помилки при обробці файлу
      } finally {
        processingFiles.delete(filePath);
        console.log('File processed:', filePath);
      }
    }
  } catch (error) {
    console.error('Error processing files:', error); // Логування загальної помилки обробки файлів
  }
};
