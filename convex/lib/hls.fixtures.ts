// MPEG-2 Layer III, 128 kbps, 24 kHz mono, as OpenAI speech returns it: 384 bytes and 24 ms per frame.
export const FRAME_BYTES = 384;

export function speechFrame(fill: number) {
  const bytes = new Uint8Array(FRAME_BYTES).fill(fill);
  bytes.set([0xff, 0xf3, 0xc4, 0xc4]);
  return bytes;
}

export function speechMp3(frameCount: number) {
  const bytes = new Uint8Array(frameCount * FRAME_BYTES);
  for (let index = 0; index < frameCount; index++) bytes.set(speechFrame(index % 200), index * FRAME_BYTES);
  return bytes;
}
