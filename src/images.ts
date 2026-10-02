const MAX_FILE_BYTES = 5 * 1024 * 1024;
export async function readImage(file: File): Promise<ImageBitmap> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose an image smaller than 5 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This image could not be opened. Try another PNG, JPEG, or WebP.'); }
  if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 40_000_000) {
    bitmap.close(); throw new Error('Choose an image no larger than 8192 pixels per side and 40 megapixels.');
  }
  return bitmap;
}
export function cropImage(bitmap: ImageBitmap, zoom: number, horizontal: number, vertical: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image editing is unavailable in this browser.');
  const side = Math.min(bitmap.width, bitmap.height) / zoom;
  const x = (bitmap.width-side)*horizontal/100, y = (bitmap.height-side)*vertical/100;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, x, y, side, side, 0, 0, 128, 128);
  return canvas.toDataURL('image/png');
}
