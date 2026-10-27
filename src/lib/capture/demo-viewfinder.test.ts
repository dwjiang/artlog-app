import { findDemoVideo, takeWalkRequest, walkRequestTime } from "./demo-viewfinder";

const mockFiles = new Map<string, string>();
const mockModified = new Map<string, number>();

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
    get modificationTime() {
      return mockModified.get(this.uri) ?? null;
    }
    textSync() {
      return mockFiles.get(this.uri)!;
    }
    delete() {
      mockFiles.delete(this.uri);
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

beforeEach(() => {
  mockFiles.clear();
  mockModified.clear();
});

it("has no video until the demo host copies the video and its manifest in", () => {
  expect(findDemoVideo()).toBeUndefined();
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  expect(findDemoVideo()).toBeUndefined();
});

it("reads the idle loop and each painting's walk", () => {
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  mockFiles.set(`${folder}/viewfinder.json`, JSON.stringify(manifest));

  expect(findDemoVideo()).toEqual({
    uri: `${folder}/viewfinder.mp4`,
    idle: { start: 0, end: 8 },
    walks: [{ start: 8, end: 15 }],
  });
});

it.each([
  ["unreadable JSON", "{not json"],
  ["no paintings", JSON.stringify({ ...manifest, paintings: [] })],
  ["a backwards segment", JSON.stringify({ ...manifest, idle: { start: 8, end: 0 } })],
  ["a painting without a walk", JSON.stringify({ ...manifest, paintings: [{ ...manifest.paintings[0], walk: 3 }] })],
])("treats a manifest with %s as no video", (_case, text) => {
  mockFiles.set(`${folder}/viewfinder.mp4`, "");
  mockFiles.set(`${folder}/viewfinder.json`, text);
  expect(findDemoVideo()).toBeUndefined();
});

describe("walk requests from the demo page", () => {
  const request = `${folder}/walk.json`;

  it("takes a picked painting once", () => {
    expect(takeWalkRequest(8)).toBeUndefined();
    mockFiles.set(request, JSON.stringify({ painting: 3 }));
    expect(takeWalkRequest(8)).toBe(3);
    expect(takeWalkRequest(8)).toBeUndefined();
  });

  it.each([
    ["past the last painting", 8],
    ["negative", -1],
    ["fractional", 1.5],
    ["not a number", "3"],
  ])("uses up a request whose painting is %s without walking", (_case, painting) => {
    mockFiles.set(request, JSON.stringify({ painting }));
    expect(takeWalkRequest(8)).toBeUndefined();
    expect(mockFiles.has(request)).toBe(false);
  });

  it("tells when a waiting request was written, until it is taken", () => {
    expect(walkRequestTime()).toBeUndefined();
    mockFiles.set(request, JSON.stringify({ painting: 3 }));
    mockModified.set(request, 1_000);
    expect(walkRequestTime()).toBe(1_000);

    takeWalkRequest(8);

    expect(walkRequestTime()).toBeUndefined();
  });

  it("leaves a request it cannot read yet for the next check", () => {
    mockFiles.set(request, '{"paint');
    expect(takeWalkRequest(8)).toBeUndefined();
    mockFiles.set(request, JSON.stringify({ painting: 2 }));
    expect(takeWalkRequest(8)).toBe(2);
  });
});
