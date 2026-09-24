import { ImageManipulator, type ImageRef } from "expo-image-manipulator";

// expo-image's loadAsync always disk-caches, even for file URIs. The manipulator reads local files directly.
export async function loadLocalImage(uri: string, longSide: number): Promise<ImageRef> {
  const context = ImageManipulator.manipulate(uri);
  let source: ImageRef | undefined;
  try {
    source = await context.renderAsync();
    if (Math.max(source.width, source.height) <= longSide) {
      const result = source;
      source = undefined;
      return result;
    }
    const resize = ImageManipulator.manipulate(source);
    try {
      return await resize
        .resize(source.width >= source.height ? { width: longSide } : { height: longSide })
        .renderAsync();
    } finally {
      resize.release();
    }
  } finally {
    source?.release();
    context.release();
  }
}
