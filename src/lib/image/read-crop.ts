import { File } from 'expo-file-system';
import type { Mat } from 'react-native-fast-opencv';

import { loadOpenCV, type FastOpenCV } from './opencv';

export type GrayImage = { gray: Mat; width: number; height: number };

/** Runs `run` on the decoded gray image and releases it afterwards, loading OpenCV when `cv` is omitted. */
export async function withGray<T>(
  imageUri: string,
  cv: FastOpenCV | undefined,
  run: (image: GrayImage, cv: FastOpenCV) => T,
): Promise<T> {
  const opencv = cv ?? (await loadOpenCV());
  const image = await loadGray(imageUri, opencv);
  try {
    return run(image, opencv);
  } finally {
    image.gray.release();
  }
}

/** Decodes an image file into an 8-bit single-channel Mat; the caller releases `gray`. */
export async function loadGray(imageUri: string, cv: FastOpenCV): Promise<GrayImage> {
  const encoded = await new File(imageUri).base64();
  const { Mat, OpenCV, ColorConversionCodes, DataTypes } = cv;
  const decoded = Mat.createFromBase64(encoded);
  const gray = Mat.create(0, 0, DataTypes.CV_8U);
  try {
    // imdecode yields BGR or BGRA; OpenCV's BGR2GRAY accepts both and ignores alpha.
    OpenCV.cvtColor(decoded, gray, ColorConversionCodes.COLOR_BGR2GRAY);
  } catch (error) {
    gray.release();
    throw error;
  } finally {
    decoded.release();
  }
  // Read dimensions while the Mat is alive; a released Mat throws on access.
  return { gray, width: gray.cols, height: gray.rows };
}
