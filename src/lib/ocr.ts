import { PaddleOCR, type OcrResult } from '@paddleocr/paddleocr-js';
import { loadSettings, type OcrModelSize } from './settings';

let ocrInstance: Awaited<ReturnType<typeof PaddleOCR.create>> | null = null;
let currentModelSize: OcrModelSize | null = null;

export type { OcrResult };

export async function initOCR(): Promise<void> {
  const settings = loadSettings();
  const modelSize = settings.ocrModelSize;

  // If already initialized with the same model size, skip
  if (ocrInstance && currentModelSize === modelSize) return;

  // Dispose old instance if switching models
  if (ocrInstance) {
    ocrInstance.dispose();
    ocrInstance = null;
  }

  const isTiny = modelSize === 'PP-OCRv6_tiny';

  ocrInstance = await PaddleOCR.create({
    lang: 'en',
    ocrVersion: isTiny ? undefined : 'PP-OCRv6',
    ...(isTiny && {
      textDetectionModelName: 'PP-OCRv6_tiny_det',
      textRecognitionModelName: 'PP-OCRv6_tiny_rec',
    }),
    worker: true,
    ortOptions: {
      backend: 'wasm',
      wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.1/dist/',
    },
  });

  currentModelSize = modelSize;
}

export async function ocrImage(
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement | Blob
): Promise<OcrResult> {
  if (!ocrInstance) throw new Error('OCR not initialized. Call initOCR() first.');
  const [result] = await ocrInstance.predict(image);
  return result;
}

export function disposeOCR(): void {
  ocrInstance?.dispose();
  ocrInstance = null;
  currentModelSize = null;
}

export function getCurrentModelSize(): OcrModelSize | null {
  return currentModelSize;
}
