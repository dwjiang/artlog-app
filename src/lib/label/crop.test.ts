import { CONTRIBUTION_CROP_QUALITY, removeFile, resizeCropForContribution } from "./crop";

const mockManipulate = jest.fn();
const mockResize = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockExisting = new Set<string>();
const sizes: Record<string, [number, number]> = {};

type FakeImage = {
  width: number;
  height: number;
  saveAsync: (options: unknown) => Promise<unknown>;
};

function image(width: number, height: number): FakeImage {
  return { width, height, saveAsync: (options) => mockSave(width, height, options) };
}

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: { manipulate: (source: unknown) => mockManipulate(source) },
}));
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockExisting.has(this.uri);
    }
    delete() {
      mockDelete(this.uri);
      mockExisting.delete(this.uri);
    }
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockManipulate.mockImplementation((source: string | FakeImage) => {
    let requested: { width?: number; height?: number } | undefined;
    const context = {
      resize(size: { width?: number; height?: number }) {
        mockResize(size);
        requested = size;
        return context;
      },
      async renderAsync(): Promise<FakeImage> {
        const base = typeof source === "string" ? image(...sizes[source]) : source;
        if (requested?.width)
          return image(requested.width, Math.round((base.height * requested.width) / base.width));
        if (requested?.height)
          return image(Math.round((base.width * requested.height) / base.height), requested.height);
        return base;
      },
    };
    return context;
  });
  mockSave.mockImplementation(
    async (width: number, height: number, options: { base64?: boolean }) => {
      mockExisting.add("file:///cache/out.jpg");
      return {
        uri: "file:///cache/out.jpg",
        width,
        height,
        base64: options.base64 ? "QUJDRA==" : undefined,
      };
    },
  );
});

it("resizes the letterboxed crop to 256 px JPEG 0.85 without base64", async () => {
  sizes["file:///documents/crops/c1.jpg"] = [512, 512];
  const result = await resizeCropForContribution("file:///documents/crops/c1.jpg");
  expect(mockResize).toHaveBeenCalledWith({ width: 256 });
  expect(mockSave).toHaveBeenCalledWith(256, 256, {
    format: "jpeg",
    compress: CONTRIBUTION_CROP_QUALITY,
  });
  expect(result).toMatchObject({ uri: "file:///cache/out.jpg", width: 256, height: 256 });
  expect(mockDelete).not.toHaveBeenCalled();
});

it("removes only existing files", () => {
  removeFile("file:///missing.jpg");
  expect(mockDelete).not.toHaveBeenCalled();
  mockExisting.add("file:///present.jpg");
  removeFile("file:///present.jpg");
  expect(mockDelete).toHaveBeenCalledWith("file:///present.jpg");
});
