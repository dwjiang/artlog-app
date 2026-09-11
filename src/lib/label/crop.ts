import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef, type ImageResult } from 'expo-image-manipulator';

/** The reader's input (design §4.4); the fallback keeps the base64 under the server's decoded-size limit. */
export const LABEL_PHOTO_LONG_SIDE = 1600;
export const LABEL_PHOTO_FALLBACK_LONG_SIDE = 1280;
export const LABEL_PHOTO_QUALITY = 0.8;
/** convex/label.ts rejects larger decoded images. */
export const MAX_LABEL_PHOTO_BYTES = 1_500_000;
/** The consented crop becomes the next visitor's thumbnail (design §4.7); contributions.ts caps it at 200 KB. */
export const CONTRIBUTION_CROP_SIZE = 256;
export const CONTRIBUTION_CROP_QUALITY = 0.85;

export type EncodedPhoto = { base64: string; width: number; height: number };

export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function renderWithin(uri: string, longSide: number): Promise<ImageRef> {
  const source = await ImageManipulator.manipulate(uri).renderAsync();
  if (Math.max(source.width, source.height) <= longSide) return source;
  const size = source.width >= source.height ? { width: longSide } : { height: longSide };
  return ImageManipulator.manipulate(source).resize(size).renderAsync();
}

export function removeFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('Could not remove a temporary image', { uri, error });
  }
}

/** The label photo as the reader takes it: long side 1600 px, JPEG 0.8, base64; 1280 px when that exceeds the limit. */
export async function prepareLabelPhoto(uri: string): Promise<EncodedPhoto> {
  const save = { format: SaveFormat.JPEG, compress: LABEL_PHOTO_QUALITY, base64: true };
  let result = await (await renderWithin(uri, LABEL_PHOTO_LONG_SIDE)).saveAsync(save);
  removeFile(result.uri);
  if (result.base64 && decodedBytes(result.base64) > MAX_LABEL_PHOTO_BYTES) {
    console.warn(`Label photo exceeds ${MAX_LABEL_PHOTO_BYTES} bytes at ${LABEL_PHOTO_LONG_SIDE} px; encoding at ${LABEL_PHOTO_FALLBACK_LONG_SIDE} px`);
    result = await (await renderWithin(uri, LABEL_PHOTO_FALLBACK_LONG_SIDE)).saveAsync(save);
    removeFile(result.uri);
  }
  if (!result.base64) throw new Error('The label photo could not be encoded');
  return { base64: result.base64, width: result.width, height: result.height };
}

/** The consented crop for upload: the letterboxed square at 256 px, JPEG 0.85, written to the cache; the caller removes it. */
export async function resizeCropForContribution(cropUri: string): Promise<ImageResult> {
  const image = await renderWithin(cropUri, CONTRIBUTION_CROP_SIZE);
  return image.saveAsync({ format: SaveFormat.JPEG, compress: CONTRIBUTION_CROP_QUALITY });
}
