import { knownImageSize, rememberImageSize } from "./image-sizes";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
const mockFiles: Record<string, number[]> = {
  "file:///wide.png": [...PNG_HEADER, 0, 0, 0x06, 0x40, 0, 0, 0x03, 0x84],
};
const mockOpen = jest.fn();
jest.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: class {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    open() {
      mockOpen(this.mockUri);
      const bytes = mockFiles[this.mockUri];
      if (!bytes) throw new Error("No such file");
      return {
        offset: 0,
        readBytesSync(this: { offset: number }, length: number) {
          return Uint8Array.from(bytes.slice(this.offset, this.offset + length));
        },
        close: jest.fn(),
      };
    }
  },
}));

beforeEach(() => mockOpen.mockClear());

it("reads a photo on this iPhone from its header once", () => {
  expect(knownImageSize("file:///wide.png")).toEqual({ width: 1600, height: 900 });
  expect(knownImageSize("file:///wide.png")).toEqual({ width: 1600, height: 900 });
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

it("knows a remote picture only after it has loaded once", () => {
  expect(knownImageSize("https://museum.example/show.jpg")).toBeUndefined();
  rememberImageSize("https://museum.example/show.jpg", { width: 1200, height: 630 });
  expect(knownImageSize("https://museum.example/show.jpg")).toEqual({ width: 1200, height: 630 });
  expect(mockOpen).not.toHaveBeenCalled();
});

it("stops reading an unreadable file and takes the size its picture reports on load", () => {
  expect(knownImageSize("file:///missing.jpg")).toBeUndefined();
  expect(knownImageSize("file:///missing.jpg")).toBeUndefined();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  rememberImageSize("file:///missing.jpg", { width: 0, height: 0 });
  expect(knownImageSize("file:///missing.jpg")).toBeUndefined();
  rememberImageSize("file:///missing.jpg", { width: 3, height: 4 });
  expect(knownImageSize("file:///missing.jpg")).toEqual({ width: 3, height: 4 });
});
