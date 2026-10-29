import { File, FileMode, type FileHandle } from "expo-file-system";

import { imageHeaderSize, type PixelSize } from "@/lib/files/image-header";

// Null marks a local file whose header couldn't be read, so it isn't read again.
const sizes = new Map<string, PixelSize | null>();

/** Records a picture's size once it has loaded, so the next page showing it reserves its shape from the first frame. */
export function rememberImageSize(uri: string, size: { width: number; height: number }) {
  if (size.width > 0 && size.height > 0) sizes.set(uri, { width: size.width, height: size.height });
}

/**
 * A picture's size before it loads: one already shown this session, or a photo on this iPhone read from its file
 * header. Undefined for a remote picture not shown yet.
 */
export function knownImageSize(uri: string): PixelSize | undefined {
  const known = sizes.get(uri);
  if (known !== undefined) return known ?? undefined;
  if (!uri.startsWith("file:")) return undefined;
  const size = readHeaderSize(uri);
  sizes.set(uri, size ?? null);
  return size;
}

// A missing or unreadable file is an expected state here: the picture's own load reports it.
function readHeaderSize(uri: string): PixelSize | undefined {
  let handle: FileHandle | undefined;
  try {
    const file = new File(uri).open(FileMode.ReadOnly);
    handle = file;
    return imageHeaderSize((offset, length) => {
      file.offset = offset;
      return file.readBytesSync(length);
    });
  } catch {
    return undefined;
  } finally {
    handle?.close();
  }
}
