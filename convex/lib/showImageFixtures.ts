/** A PNG header that image-size reads as `width`×`height`. */
export function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return header;
}
