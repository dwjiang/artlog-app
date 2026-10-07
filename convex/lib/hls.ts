// HLS packed audio (RFC 8216 §3.4) cut from an MPEG Layer III stream, so AVPlayer can start a narration while its
// speech is still being generated: it refuses progressive audio without byte ranges, which a live stream cannot offer.

// EXT-X-TARGETDURATION stays fixed while the playlist grows; short segments let AVPlayer start promptly.
export const SEGMENT_SECONDS = 2;

const BITRATES_KBPS = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
// Indexed by the header's version bits: 0 is MPEG-2.5, 2 is MPEG-2, 3 is MPEG-1.
const SAMPLE_RATES: Partial<Record<number, number[]>> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};
const TIMESTAMP_OWNER = "com.apple.streaming.transportStreamTimestamp\0";

type Frame = { bytes: Uint8Array; samples: number; sampleRate: number };

function layerThreeFrame(bytes: Uint8Array, at: number) {
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0 || ((bytes[at + 1] >> 1) & 3) !== 1) return undefined;
  const version = (bytes[at + 1] >> 3) & 3;
  const sampleRate = SAMPLE_RATES[version]?.[(bytes[at + 2] >> 2) & 3];
  const kbps = (version === 3 ? BITRATES_KBPS.mpeg1 : BITRATES_KBPS.mpeg2)[bytes[at + 2] >> 4];
  if (!sampleRate || !kbps) return undefined;
  const samples = version === 3 ? 1152 : 576;
  const padding = (bytes[at + 2] >> 1) & 1;
  return { length: Math.floor((samples / 8) * ((kbps * 1000) / sampleRate)) + padding, samples, sampleRate };
}

function id3Length(bytes: Uint8Array, at: number) {
  if (bytes[at] !== 0x49 || bytes[at + 1] !== 0x44 || bytes[at + 2] !== 0x33) return undefined;
  const size = (bytes[at + 6] << 21) | (bytes[at + 7] << 14) | (bytes[at + 8] << 7) | bytes[at + 9];
  return 10 + size + (bytes[at + 5] & 0x10 ? 10 : 0);
}

function createFrameReader() {
  let pending = new Uint8Array(0);
  return (chunk: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + chunk.length);
    bytes.set(pending);
    bytes.set(chunk, pending.length);
    const frames: Frame[] = [];
    let at = 0;
    while (at + 10 <= bytes.length) {
      const tag = id3Length(bytes, at);
      const header = tag === undefined ? layerThreeFrame(bytes, at) : undefined;
      const length = tag ?? header?.length;
      if (length === undefined) {
        at++;
        continue;
      }
      if (at + length > bytes.length) break;
      if (header) frames.push({ bytes: bytes.slice(at, at + length), ...header });
      at += length;
    }
    pending = bytes.slice(at);
    return frames;
  };
}

// An ID3v2.4 tag holding one PRIV frame: the 33-bit, 90 kHz timestamp of the segment's first sample.
function timestampTag(ticks: number) {
  const owner = new TextEncoder().encode(TIMESTAMP_OWNER);
  const tag = new Uint8Array(20 + owner.length + 8);
  const view = new DataView(tag.buffer);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0]);
  view.setUint32(6, tag.length - 10);
  tag.set([0x50, 0x52, 0x49, 0x56], 10);
  view.setUint32(14, owner.length + 8);
  tag.set(owner, 20);
  view.setBigUint64(20 + owner.length, BigInt(ticks));
  return tag;
}

export type PackedSegment = { bytes: Uint8Array<ArrayBuffer>; duration: number };

export function createSegmenter(targetSeconds = SEGMENT_SECONDS) {
  const read = createFrameReader();
  let frames: Frame[] = [];
  let samples = 0;
  let startTicks = 0;
  const cut = (): PackedSegment => {
    const { sampleRate } = frames[0];
    const tag = timestampTag(Math.round(startTicks));
    const bytes = new Uint8Array(tag.length + frames.reduce((total, frame) => total + frame.bytes.length, 0));
    bytes.set(tag);
    let at = tag.length;
    for (const frame of frames) {
      bytes.set(frame.bytes, at);
      at += frame.bytes.length;
    }
    const segment = { bytes, duration: samples / sampleRate };
    startTicks += (samples * 90_000) / sampleRate;
    frames = [];
    samples = 0;
    return segment;
  };
  return {
    push(chunk: Uint8Array) {
      const segments: PackedSegment[] = [];
      for (const frame of read(chunk)) {
        frames.push(frame);
        samples += frame.samples;
        if (samples / frames[0].sampleRate >= targetSeconds) segments.push(cut());
      }
      return segments;
    },
    end: () => (frames.length > 0 ? cut() : undefined),
  };
}

export function eventPlaylist(segments: { uri: string; duration: number }[], ended: boolean) {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    "#EXT-X-START:TIME-OFFSET=0",
    ...segments.flatMap(({ uri, duration }) => [`#EXTINF:${duration.toFixed(3)},`, uri]),
    ...(ended ? ["#EXT-X-ENDLIST"] : []),
  ];
  return `${lines.join("\n")}\n`;
}
