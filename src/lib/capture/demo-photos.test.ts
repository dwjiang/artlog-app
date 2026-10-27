import { copyForImport, listDemoPhotos } from "./demo-photos";

const mockFolders = new Map<string, string[]>();
const mockCopies: [string, string][] = [];

jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
jest.mock("expo-file-system", () => {
  const join = (parts: unknown[]) =>
    parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get name() {
      return this.uri.split("/").at(-1)!;
    }
    get extension() {
      const dot = this.name.lastIndexOf(".");
      return dot < 0 ? "" : this.name.slice(dot);
    }
    async copy(target: File) {
      mockCopies.push([this.uri, target.uri]);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFolders.has(this.uri);
    }
    list() {
      return (mockFolders.get(this.uri) ?? []).map((name) =>
        name.endsWith("/") ? new Directory(this.uri, name) : new File(this.uri, name),
      );
    }
  }
  return { File, Directory, Paths: { document: "file:///documents", cache: "file:///cache" } };
});

const folder = "file:///documents/judges-demo";

beforeEach(() => {
  mockFolders.clear();
  mockCopies.length = 0;
});

it("lists gallery stills in name order and uploads newest first, skipping other files", () => {
  mockFolders.set(`${folder}/photos`, ["roses.jpg", "credits.md", "bedroom.jpg", "nested/"]);
  mockFolders.set(`${folder}/uploads`, ["1761500000000-1.png", "1761500900000-2.HEIC", "notes.txt"]);

  expect(listDemoPhotos()).toEqual({
    gallery: [`${folder}/photos/bedroom.jpg`, `${folder}/photos/roses.jpg`],
    uploads: [`${folder}/uploads/1761500900000-2.HEIC`, `${folder}/uploads/1761500000000-1.png`],
  });
});

it("has no photos until the demo host copies them in", () => {
  expect(listDemoPhotos()).toEqual({ gallery: [], uploads: [] });
});

it("imports a copy so the demo photo stays for the next scan", async () => {
  await expect(copyForImport(`${folder}/uploads/1761500000000-1.png`)).resolves.toEqual({
    uri: "file:///cache/uuid.png",
  });
  expect(mockCopies).toEqual([[`${folder}/uploads/1761500000000-1.png`, "file:///cache/uuid.png"]]);
});
