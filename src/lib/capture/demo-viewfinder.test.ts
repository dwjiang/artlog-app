import { findDemoVideo } from "./demo-viewfinder";

const mockFiles = new Map<string, string>();

jest.mock("expo-file-system", () => {
  const join = (parts: unknown[]) =>
    parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    textSync() {
      return mockFiles.get(this.uri)!;
    }
  }
  return { File, Directory, Paths: { document: "file:///documents" } };
});

const folder = "file:///documents/judges-demo";
const manifest = {
  idle: { start: 0, end: 8 },
  paintings: [
    {
      title: "Mona Lisa",
      artist: "Leonardo da Vinci",
      thumbnail: "thumbs/mona-lisa.jpg",
      walk: { start: 8, end: 15 },
    },
  ],
};

beforeEach(() => mockFiles.clear());

it("has no video until the demo host copies the video and its manifest in", () => {
  expect(findDemoVideo()).toBeUndefined();
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  expect(findDemoVideo()).toBeUndefined();
});

it("reads the idle loop and each painting's walk, with thumbnails beside the video", () => {
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  mockFiles.set(`${folder}/viewfinder.json`, JSON.stringify(manifest));

  expect(findDemoVideo()).toEqual({
    uri: `${folder}/viewfinder.mp4`,
    idle: { start: 0, end: 8 },
    paintings: [
      {
        title: "Mona Lisa",
        artist: "Leonardo da Vinci",
        thumbnail: `${folder}/thumbs/mona-lisa.jpg`,
        walk: { start: 8, end: 15 },
      },
    ],
  });
});

it.each([
  ["unreadable JSON", "{not json"],
  ["no paintings", JSON.stringify({ ...manifest, paintings: [] })],
  ["a backwards segment", JSON.stringify({ ...manifest, idle: { start: 8, end: 0 } })],
  ["a painting without a title", JSON.stringify({ ...manifest, paintings: [{ ...manifest.paintings[0], title: 3 }] })],
])("treats a manifest with %s as no video", (_case, text) => {
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  mockFiles.set(`${folder}/viewfinder.json`, text);
  expect(findDemoVideo()).toBeUndefined();
});
