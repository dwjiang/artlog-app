import { imageHeaderSize } from "./image-header";

const reader = (bytes: number[]) => (offset: number, length: number) =>
  Uint8Array.from(bytes.slice(offset, offset + length));

const u16 = (value: number) => [value >> 8, value & 0xff];
const u16le = (value: number) => [value & 0xff, value >> 8];

/** A JPEG header: an optional EXIF segment carrying `orientation`, padding, then the frame size. */
function jpeg({
  width,
  height,
  orientation,
  little = false,
  padding = 0,
}: {
  width: number;
  height: number;
  orientation?: number;
  little?: boolean;
  padding?: number;
}) {
  const bytes = [0xff, 0xd8];
  // A JFIF segment comes first in many files and carries no size.
  bytes.push(0xff, 0xe0, ...u16(16), ...Array.from({ length: 14 }, () => 0));
  if (orientation !== undefined) {
    const short = little ? u16le : u16;
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...short(42),
      ...(little ? [8, 0, 0, 0] : [0, 0, 0, 8]),
      ...short(2),
      // An unrelated tag before Orientation.
      ...short(0x010f),
      ...short(2),
      ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]),
      0,
      0,
      0,
      0,
      ...short(0x0112),
      ...short(3),
      ...(little ? [1, 0, 0, 0] : [0, 0, 0, 1]),
      ...short(orientation),
      0,
      0,
    ];
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, ...u16(exif.length + 2), ...exif);
  }
  // Segment lengths are 16-bit, so long padding spans several segments.
  for (let left = padding; left > 0; left -= 60_000) {
    const size = Math.min(left, 60_000);
    bytes.push(0xff, 0xe2, ...u16(size + 2), ...Array.from({ length: size }, () => 0));
  }
  bytes.push(0xff, 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, ...Array.from({ length: 9 }, () => 0));
  bytes.push(0xff, 0xda);
  return bytes;
}

it("reads a JPEG's frame size after the segments before it", () => {
  expect(imageHeaderSize(reader(jpeg({ width: 4032, height: 3024, padding: 130_000 })))).toEqual({
    width: 4032,
    height: 3024,
  });
});

it.each([
  [1, { width: 4032, height: 3024 }],
  [3, { width: 4032, height: 3024 }],
  [6, { width: 3024, height: 4032 }],
  [8, { width: 3024, height: 4032 }],
])("draws a JPEG with EXIF orientation %s at its upright size", (orientation, size) => {
  expect(imageHeaderSize(reader(jpeg({ width: 4032, height: 3024, orientation })))).toEqual(size);
  expect(imageHeaderSize(reader(jpeg({ width: 4032, height: 3024, orientation, little: true })))).toEqual(size);
});

it("reads a PNG's size from its header", () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  expect(imageHeaderSize(reader([...png, 0, 0, 0x05, 0x00, 0, 0, 0x02, 0xd0]))).toEqual({ width: 1280, height: 720 });
});

it("gives up on formats it doesn't read and on cut-off or empty files", () => {
  expect(imageHeaderSize(reader([]))).toBeUndefined();
  expect(imageHeaderSize(reader([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeUndefined();
  expect(imageHeaderSize(reader(jpeg({ width: 10, height: 10 }).slice(0, 24)))).toBeUndefined();
  expect(imageHeaderSize(reader(jpeg({ width: 0, height: 10 })))).toBeUndefined();
});
