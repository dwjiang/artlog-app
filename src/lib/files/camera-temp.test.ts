import { cleanupCameraTempFiles, removeCameraTempFile } from "./camera-temp";

const mockFiles = new Map<string, { modified: number | null; fail?: boolean }>();
const mockReportError = jest.fn();
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get name() {
      return this.uri.split("/").at(-1);
    }
    get modificationTime() {
      return mockFiles.get(this.uri)?.modified;
    }
    delete() {
      if (mockFiles.get(this.uri)?.fail) throw new Error("Cannot delete");
      mockFiles.delete(this.uri);
    }
  }
  return {
    File,
    Paths: { document: { parentDirectory: "file:///app/" } },
    Directory: class {
      exists = true;
      list() {
        return [...mockFiles.keys()].filter((uri) => uri.startsWith("file:///app/tmp/")).map((uri) => new File(uri));
      }
    },
  };
});

const old = "file:///app/tmp/12345678-1234-1234-1234-123456789abc.jpg";
beforeEach(() => {
  mockFiles.clear();
  jest.clearAllMocks();
});

it("removes only camera filenames older than a day, leaving recent and unrelated temp files alone", () => {
  const now = 3 * 24 * 60 * 60 * 1000;
  mockFiles.set(old, { modified: 1 });
  const recent = old.replace("12345678", "87654321");
  mockFiles.set(recent, { modified: now - 100 });
  const boundary = old.replace(".jpg", ".jpeg");
  mockFiles.set(boundary, { modified: now - 24 * 60 * 60 * 1000 });
  const unknown = old.replace(".jpg", ".heic");
  mockFiles.set(unknown, { modified: null });
  mockFiles.set("file:///app/tmp/upload.jpg", { modified: 1 });
  mockFiles.set(old.replace(".jpg", ".mov"), { modified: 1 });
  cleanupCameraTempFiles(now);
  expect(mockFiles.has(old)).toBe(false);
  expect(mockFiles.size).toBe(5);
});

it("tolerates a moved capture and reports failed cleanup without interrupting the scan or other files", () => {
  removeCameraTempFile(old);
  mockFiles.set(old, { modified: 1, fail: true });
  const another = old.replace(".jpg", ".jpeg");
  mockFiles.set(another, { modified: 1 });
  cleanupCameraTempFiles(3 * 24 * 60 * 60 * 1000);
  expect(mockFiles.has(old)).toBe(true);
  expect(mockFiles.has(another)).toBe(false);
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), "capture.cleanup_temporary_photo", {
    level: "warning",
  });
});
