import { maintainStoredPhotos } from "./photo-maintenance";

const mockSettings = new Map<string, string>();
const mockFiles = new Map<string, string[]>();
const mockSaved = jest.fn();
const mockKeep = jest.fn();
const mockCleanup = jest.fn();
const mockReportError = jest.fn();
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
}));
jest.mock("@/db/repos/kept-photos", () => ({ listKeptPhotos: () => mockSaved() }));
jest.mock("./kept-photos", () => ({ keepPhotos: (...args: unknown[]) => mockKeep(...args) }));
jest.mock("./camera-temp", () => ({ cleanupCameraTempFiles: () => mockCleanup() }));
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("expo-file-system", () => {
  class File {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
  }
  return {
    File,
    Paths: { document: "file:///documents" },
    Directory: class {
      folder: string;
      constructor(_: string, folder: string) {
        this.folder = folder;
      }
      get exists() {
        return mockFiles.has(this.folder);
      }
      list() {
        return mockFiles.get(this.folder)!.map((name) => new File(name));
      }
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockSettings.clear();
  mockSaved.mockReturnValue([]);
  mockKeep.mockResolvedValue(undefined);
});

it("processes all 113 existing originals once per pass, deduplicating saved references and preserving label kinds", async () => {
  const originals = Array.from({ length: 113 }, (_, index) => `${index}.jpeg`);
  mockFiles.set("photos", [...originals, "unrelated.txt"]);
  mockFiles.set("labels", ["private-label.jpg"]);
  mockSaved.mockReturnValue([
    { path: "photos/0.jpeg", kind: "full" },
    { path: "photos/1.jpeg", kind: "label" },
    { path: "artwork-photos/extra.jpg", kind: "detail" },
  ]);
  await maintainStoredPhotos();
  expect(mockCleanup).toHaveBeenCalledTimes(1);
  const photos = mockKeep.mock.calls[0][0];
  expect(photos).toHaveLength(114);
  expect(photos).toContainEqual({ path: "photos/1.jpeg", kind: "label" });
  expect(photos).not.toContainEqual(expect.objectContaining({ path: "labels/private-label.jpg" }));
});

it("resumes the original snapshot on later launches but only adds new photos once saved", async () => {
  mockFiles.set("photos", ["old.jpg"]);
  await maintainStoredPhotos();
  mockFiles.set("photos", ["old.jpg", "unsaved.jpg", "kept.jpg"]);
  mockSaved.mockReturnValue([{ path: "photos/kept.jpg", kind: "full" }]);
  await maintainStoredPhotos();
  expect(mockKeep.mock.calls[1][0]).toEqual([
    { path: "photos/old.jpg", kind: "full" },
    { path: "photos/kept.jpg", kind: "full" },
  ]);
});

it("coalesces overlapping foreground runs and retries after an unexpected failure", async () => {
  let finish!: () => void;
  mockKeep.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = maintainStoredPhotos();
  expect(maintainStoredPhotos()).toBe(first);
  await Promise.resolve();
  await Promise.resolve();
  finish();
  await first;
  mockSaved.mockImplementationOnce(() => {
    throw new Error("Database unavailable");
  });
  await maintainStoredPhotos();
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), "photos.startup_maintenance", { level: "warning" });
  await maintainStoredPhotos();
  expect(mockKeep).toHaveBeenCalledTimes(2);
});
