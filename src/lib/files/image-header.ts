export type PixelSize = { width: number; height: number };
/** Reads up to `length` bytes at `offset`; fewer at the end of the file. */
export type ByteReader = (offset: number, length: number) => Uint8Array;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ORIENTATION_TAG = 0x0112;
// IFD0 sits right after the TIFF header, so its Orientation entry is well inside this.
const EXIF_READ = 4096;
const MAX_SEGMENTS = 256;

/**
 * The upright size a JPEG or PNG draws at, read from its header without decoding it; undefined for other formats or a
 * header it can't follow. Segments are skipped by their lengths, so a large EXIF thumbnail costs no extra reading.
 */
export function imageHeaderSize(read: ByteReader): PixelSize | undefined {
  const head = read(0, 24);
  if (PNG_SIGNATURE.every((byte, index) => head[index] === byte)) {
    return head.length >= 24 && ascii(head, 12, 4) === "IHDR"
      ? positive(uint32(head, 16, false), uint32(head, 20, false))
      : undefined;
  }
  if (head[0] !== 0xff || head[1] !== 0xd8) return undefined;
  let offset = 2;
  let orientation = 1;
  for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
    const marker = read(offset, 4);
    if (marker.length < 2 || marker[0] !== 0xff) return undefined;
    const type = marker[1];
    if (type === 0xff) {
      offset += 1;
      continue;
    }
    if (type === 0x01 || (type >= 0xd0 && type <= 0xd8)) {
      offset += 2;
      continue;
    }
    // The image data or its end came before any frame header.
    if (type === 0xd9 || type === 0xda || marker.length < 4) return undefined;
    const length = (marker[2] << 8) | marker[3];
    if (length < 2) return undefined;
    if (isStartOfFrame(type)) {
      const frame = read(offset + 5, 4);
      if (frame.length < 4) return undefined;
      const height = (frame[0] << 8) | frame[1];
      const width = (frame[2] << 8) | frame[3];
      // Orientations 5–8 turn the stored pixels a quarter turn.
      return orientation >= 5 && orientation <= 8 ? positive(height, width) : positive(width, height);
    }
    if (type === 0xe1) orientation = exifOrientation(read(offset + 4, Math.min(length - 2, EXIF_READ))) ?? orientation;
    offset += 2 + length;
  }
  return undefined;
}

// C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) share the SOF range but carry no frame size.
function isStartOfFrame(type: number) {
  return type >= 0xc0 && type <= 0xcf && type !== 0xc4 && type !== 0xc8 && type !== 0xcc;
}

function exifOrientation(segment: Uint8Array): number | undefined {
  if (ascii(segment, 0, 4) !== "Exif" || segment[4] !== 0 || segment[5] !== 0) return undefined;
  const tiff = 6;
  const order = ascii(segment, tiff, 2);
  if (order !== "II" && order !== "MM") return undefined;
  const little = order === "II";
  if (uint16(segment, tiff + 2, little) !== 42) return undefined;
  const directory = tiff + uint32(segment, tiff + 4, little);
  if (directory + 2 > segment.length) return undefined;
  const entries = uint16(segment, directory, little);
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > segment.length) return undefined;
    if (uint16(segment, entry, little) === ORIENTATION_TAG) return uint16(segment, entry + 8, little);
  }
  return undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16(bytes: Uint8Array, offset: number, little: boolean) {
  return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32(bytes: Uint8Array, offset: number, little: boolean) {
  const [a, b, c, d] = little
    ? [bytes[offset + 3], bytes[offset + 2], bytes[offset + 1], bytes[offset]]
    : [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function positive(width: number, height: number): PixelSize | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}
