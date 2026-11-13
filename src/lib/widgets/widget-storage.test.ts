const mockFiles = new Set<string>();
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockReload = jest.fn();
const mockCopy = jest.fn();
const mockDownload = jest.fn();
jest.mock("expo-widgets", () => ({ widgetsDirectory: "shared" }));
jest.mock("./artlog-widget", () => ({ artlogWidget: { reload: () => mockReload() } }));
jest.mock("expo-asset", () => ({ Asset: { fromModule: () => ({ downloadAsync: () => mockDownload() }) } }));
jest.mock("expo-file-system", () => ({
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    textSync() {
      return mockRead(this.uri);
    }
    writeSync(value: string) {
      mockWrite(this.uri, value);
    }
    async copy(target: { uri: string }) {
      await mockCopy(this.uri, target.uri);
      if (mockFiles.has(target.uri)) throw new Error("An item with the same name already exists");
      mockFiles.add(target.uri);
    }
  },
}));

const font = "shared/artlog/space-grotesk-semibold.ttf";

// The shared copy lives in module state, so each test loads a fresh module.
let prepareWidgetFont: typeof import("./widget-storage").prepareWidgetFont;
let writeWidgetManifest: typeof import("./widget-storage").writeWidgetManifest;

beforeEach(() => {
  jest.isolateModules(() => {
    ({ prepareWidgetFont, writeWidgetManifest } =
      jest.requireActual<typeof import("./widget-storage")>("./widget-storage"));
  });
  mockFiles.clear();
  jest.clearAllMocks();
  mockRead.mockReset();
  mockWrite.mockReset();
  mockDownload.mockResolvedValue({ localUri: "cache/font.ttf" });
});

it("copies the widget font once when the widget and the Live Activity ask at the same time", async () => {
  await Promise.all([prepareWidgetFont(), prepareWidgetFont()]);
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockFiles.has(font)).toBe(true);
});

it("tries again after a failed copy", async () => {
  mockDownload.mockResolvedValueOnce({ localUri: null });
  await expect(prepareWidgetFont()).rejects.toThrow("Widget font is unavailable");
  await prepareWidgetFont();
  expect(mockFiles.has(font)).toBe(true);
});

const manifest = "shared/artlog/collection.json";
const emptyManifest = JSON.stringify({ interval: 21600, entries: [] });

it("does not rewrite an identical manifest when a write would fail for lack of space", () => {
  mockFiles.add(manifest);
  mockRead.mockReturnValue(emptyManifest);
  mockWrite.mockImplementation(() => {
    throw new Error("No space left on device");
  });

  expect(() => writeWidgetManifest([])).not.toThrow();
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockReload).toHaveBeenCalledTimes(1);
});

it("replaces an unreadable manifest and reloads after writing", () => {
  mockFiles.add(manifest);
  mockRead.mockImplementation(() => {
    throw new Error("Unable to read");
  });

  writeWidgetManifest([]);
  expect(mockWrite).toHaveBeenCalledWith(manifest, emptyManifest);
  expect(mockReload).toHaveBeenCalledTimes(1);
});

it("reports a changed manifest's write failure without reloading the widget", () => {
  mockFiles.add(manifest);
  mockRead.mockReturnValue("{}");
  mockWrite.mockImplementation(() => {
    throw new Error("No space left on device");
  });

  expect(() => writeWidgetManifest([])).toThrow("No space left on device");
  expect(mockReload).not.toHaveBeenCalled();
});
