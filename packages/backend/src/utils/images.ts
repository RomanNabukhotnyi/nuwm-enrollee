import JSZip from "jszip";
import { OPS, getDocument } from "pdfjs-dist";
import Tesseract from "tesseract.js";
import sharp from "sharp";

export const getTextFromImagesInDocx = async (buffer: Buffer) => {
	const zip = new JSZip();
	await zip.loadAsync(buffer);

	const files = zip.file(/.*/);
	let content = "";

	for (const file of files) {
		const name = file.name.split("/").pop() as string;
		const type = name.split(".").pop() as string;
		const buffer = await file.async("nodebuffer");
		if (type === "png" || type === "jpeg" || type === "jpg") {
			const data = await Tesseract.recognize(buffer, "ukr", {});
			content += data.data.text;
		}
	}

	return content;
};

export const getTextFromImagesInPDF = async (buffer: Buffer) => {
	let content = "";

	const doc = await getDocument(Uint8Array.from(buffer)).promise;

	const pageCount = doc._pdfInfo.numPages;
	for (let p = 1; p <= pageCount; p++) {
		const page = await doc.getPage(p);
		const ops = await page.getOperatorList();

		for (let i = 0; i < ops.fnArray.length; i++) {
			try {
				if (
					ops.fnArray[i] === OPS.paintImageXObject ||
					ops.fnArray[i] === OPS.paintInlineImageXObject
				) {
					const objId = ops.argsArray[i][0];
					const common = page.commonObjs.has(objId);
					const img = await (common
						? page.commonObjs.get(objId)
						: page.objs.get(objId));
					const { width, height, kind } = img;
					const bytes = img.data.length;
					const channels = bytes / width / height;
					if (
						!(
							channels === 1 ||
							channels === 2 ||
							channels === 3 ||
							channels === 4
						)
					) {
						console.warn(
							`Invalid image channel: ${channels} for image ${objId} on page ${page}`,
						);
						continue;
					}
					const imgBuffer = await sharp(img.data, {
						raw: { width, height, channels },
					})
						.toFormat("jpeg")
						.toBuffer();

					const data = await Tesseract.recognize(imgBuffer, "ukr", {});

					content += data.data.text;
				}
			} catch (error) {
				console.error(error);
			}
		}
	}

	return content;
};
