import { toBytes } from '../crypto/bytes';
import type { VaultFile } from '../vault/vault';

export const MAX_IMAGE_EDGE = 2000;

export function isPdf(type: string, name = ''): boolean {
  return type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

function renamed(name: string, type: string): string {
  const ext = type === 'image/png' ? '.png' : '.jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return base + ext;
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, type: string): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality: 0.88 });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), type, 0.88),
  );
}

/**
 * Re-encodes an image with its long edge at most MAX_IMAGE_EDGE. Re-encoding
 * also bakes in the EXIF rotation and drops metadata such as GPS position.
 * PNGs (screenshots, QR codes) stay lossless PNG.
 */
async function downscale(file: File): Promise<VaultFile> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await encode(canvas, type);
  return { name: renamed(file.name, type), type, bytes: toBytes(await blob.arrayBuffer()) };
}

/** Turns a picked file into what goes into the vault: images downscaled, PDFs as is. */
export async function prepareFile(file: File): Promise<VaultFile> {
  if (isPdf(file.type, file.name)) {
    return { name: file.name || 'document.pdf', type: 'application/pdf', bytes: toBytes(await file.arrayBuffer()) };
  }
  if (file.type.startsWith('image/')) {
    try {
      return await downscale(file);
    } catch {
      // Formats this browser can't decode (e.g. HEIC outside Safari) are kept as is.
      return { name: file.name, type: file.type, bytes: toBytes(await file.arrayBuffer()) };
    }
  }
  throw new Error(`${file.name}: only images and PDFs can be added.`);
}
