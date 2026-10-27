import { demoSource, mirrorToDemoPage, nextReport } from "./demo-narration";
import type { Playback } from "./listening-controller";

const mockWrites: [string, string][] = [];

jest.mock("expo-file-system", () => {
  const join = (parts: unknown[]) =>
    parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    writeSync(content: string) {
      mockWrites.push([this.uri, content]);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///app/Documents" } } };
});

const PLAYLIST = "https://site.example/narration-playlist?artworkId=a&render=r";
const status = (patch: Partial<Playback>): Playback => ({
  currentTime: 0,
  duration: 60,
  playing: true,
  isLoaded: true,
  didJustFinish: false,
  playbackRate: 1,
  ...patch,
});

beforeEach(() => {
  mockWrites.length = 0;
});

it("reports starts, pauses, rate changes and seeks, but not playback that keeps pace", () => {
  const started = nextReport(undefined, PLAYLIST, status({ currentTime: 0 }), 0);
  expect(started).toEqual({ source: PLAYLIST, playing: true, position: 0, rate: 1, at: 0 });

  expect(nextReport(started, PLAYLIST, status({ currentTime: 10.4 }), 10_000)).toBeUndefined();
  expect(nextReport(started, PLAYLIST, status({ currentTime: 30 }), 10_000)).toMatchObject({ position: 30 });
  expect(nextReport(started, PLAYLIST, status({ currentTime: 8 }), 10_000)).toMatchObject({ position: 8 });
  expect(nextReport(started, PLAYLIST, status({ currentTime: 10, playbackRate: 1.5 }), 10_000)).toMatchObject({
    rate: 1.5,
  });

  const paused = nextReport(started, PLAYLIST, status({ currentTime: 10, playing: false, playbackRate: 0 }), 10_000);
  expect(paused).toEqual({ source: PLAYLIST, playing: false, position: 10, rate: 1, at: 10_000 });
  expect(nextReport(paused, PLAYLIST, status({ currentTime: 10, playing: false, playbackRate: 0 }), 60_000)).toBe(
    undefined,
  );
});

it("names a cached narration by its path in the app's container and passes playlists through", () => {
  expect(demoSource("file:///app/Library/Caches/narration/render-1.mp3", "file:///app/Documents/")).toBe(
    "Library/Caches/narration/render-1.mp3",
  );
  expect(demoSource(PLAYLIST, "file:///app/Documents/")).toBe(PLAYLIST);
});

it("writes reports to the demo folder and a stopped report once the player goes", () => {
  let emit!: (value: Playback) => void;
  const stop = mirrorToDemoPage(PLAYLIST, {
    addListener: (_event, callback) => {
      emit = callback;
      return { remove: () => undefined };
    },
  });

  emit(status({ currentTime: 0 }));
  emit(status({ currentTime: 0.25 }));
  stop();

  expect(mockWrites.map(([uri]) => uri)).toEqual([
    "file:///app/Documents/judges-demo/narration.json",
    "file:///app/Documents/judges-demo/narration.json",
  ]);
  expect(mockWrites.map(([, content]) => JSON.parse(content))).toEqual([
    expect.objectContaining({ source: PLAYLIST, playing: true, position: 0 }),
    expect.objectContaining({ source: null, playing: false }),
  ]);
});
