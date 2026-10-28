const mockFiles = new Set<string>();
const mockCopy = jest.fn();
const mockDownload = jest.fn();
jest.mock("expo-widgets", () => ({ widgetsDirectory: "shared" }));
jest.mock("./artlog-widget", () => ({ artlogWidget: { reload: jest.fn() } }));
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

beforeEach(() => {
  jest.isolateModules(() => {
    ({ prepareWidgetFont } = jest.requireActual<typeof import("./widget-storage")>("./widget-storage"));
  });
  mockFiles.clear();
  jest.clearAllMocks();
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
