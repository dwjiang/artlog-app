import { reportError } from "@/lib/observability";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef, type ImageResult } from "expo-image-manipulator";

/** The contribution crop becomes the next visitor's thumbnail; contributions.ts caps it at 200 KB. */
export const CONTRIBUTION_CROP_SIZE = 256;
export const CONTRIBUTION_CROP_QUALITY = 0.85;

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
    reportError(error, "label.remove_temporary_image", { level: "warning" });
    console.warn("Could not remove a temporary image", error);
  }
}

/** The contribution crop for upload: the letterboxed square at 256 px, JPEG 0.85, written to the cache; the caller removes it. */
export async function resizeCropForContribution(cropUri: string): Promise<ImageResult> {
  const image = await renderWithin(cropUri, CONTRIBUTION_CROP_SIZE);
  return image.saveAsync({
    format: SaveFormat.JPEG,
    compress: CONTRIBUTION_CROP_QUALITY,
  });
}
