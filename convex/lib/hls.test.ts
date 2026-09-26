import { describe, expect, it } from "vitest";

import { createSegmenter, eventPlaylist, SEGMENT_SECONDS } from "./hls";
import { FRAME_BYTES, speechFrame as frame, speechMp3 as stream } from "./hls.fixtures";

const TAG_BYTES = 73;
function timestampOf(segment: Uint8Array) {
  const text = new TextDecoder().decode(segment.subarray(0, TAG_BYTES));
  expect(text.startsWith("ID3")).toBe(true);
  expect(text).toContain("PRIV");
  expect(text).toContain("com.apple.streaming.transportStreamTimestamp\0");
  return Number(new DataView(segment.buffer, segment.byteOffset + TAG_BYTES - 8, 8).getBigUint64(0));
}
function chunked(bytes: Uint8Array, size: number) {
  const chunks = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.subarray(at, at + size));
  return chunks;
}

describe("createSegmenter", () => {
  it("cuts the stream at whole frames into segments whose timestamps continue where the last one ended", () => {
    const segmenter = createSegmenter();
    const source = stream(200); // 4.8 seconds
    const segments = [...chunked(source, 1000).flatMap((chunk) => segmenter.push(chunk)), segmenter.end()!];
    expect(segments.map(({ duration }) => duration)).toEqual([2.016, 2.016, 0.768]);
    let ticks = 0;
    for (const segment of segments) {
      expect(timestampOf(segment.bytes)).toBe(ticks);
      expect((segment.bytes.length - TAG_BYTES) % FRAME_BYTES).toBe(0);
      ticks += Math.round(segment.duration * 90_000);
    }
    const frames = segments.map(({ bytes }) => bytes.subarray(TAG_BYTES));
    expect(Buffer.concat(frames)).toEqual(Buffer.from(source));
    expect(segmenter.end()).toBeUndefined();
  });

  it("skips a leading ID3 tag and resynchronizes after bytes that are not frames", () => {
    const segmenter = createSegmenter();
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    const junk = new Uint8Array([0xff, 0x00, 0x12]);
    segmenter.push(new Uint8Array([...tag, ...frame(1), ...junk, ...frame(2)]));
    const segment = segmenter.end()!;
    expect(segment.duration).toBe(0.048);
    expect(Buffer.from(segment.bytes.subarray(TAG_BYTES))).toEqual(Buffer.from([...frame(1), ...frame(2)]));
  });
});

describe("eventPlaylist", () => {
  it("lists segments as a growing event from the start and closes it once speech has ended", () => {
    const segments = [
      { uri: "https://files.example/0", duration: 1.008 },
      { uri: "https://files.example/1", duration: 2.016 },
    ];
    const open = eventPlaylist(segments, false);
    expect(open.split("\n")).toEqual([
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:EVENT",
      "#EXT-X-START:TIME-OFFSET=0",
      "#EXTINF:1.008,",
      "https://files.example/0",
      "#EXTINF:2.016,",
      "https://files.example/1",
      "",
    ]);
    expect(eventPlaylist(segments, true)).toBe(`${open}#EXT-X-ENDLIST\n`);
  });
});
