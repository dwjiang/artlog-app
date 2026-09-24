import type { MuseumManifest } from "@/shared/offline/types";
import { museumDownloads, previewUri } from "./storage";

const mockFiles = new Map<string, Uint8Array | true>();
jest.mock("expo-file-system", () => {
  class Node {
    uri: string;
    constructor(...parts: (string | Node)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
    }
    create() {
      mockFiles.set(this.uri, true);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    write(bytes: Uint8Array) {
      mockFiles.set(this.uri, bytes);
    }
    delete() {
      for (const key of mockFiles.keys()) {
        if (key === this.uri || key.startsWith(`${this.uri}/`)) {
          mockFiles.delete(key);
        }
      }
    }
  }
  return {
    File: Node,
    Directory: Node,
    Paths: { document: "file:///documents", availableDiskSpace: 1_000_000_000 },
  };
});
const mockFetch = jest.fn();
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async () => new Uint8Array(32).fill(0xab).buffer,
}));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({
    isConnected: true,
    isInternetReachable: true,
  }),
}));
const mockQuery = jest.fn();
jest.mock("@/lib/convex-client", () => ({
  convex: { query: (...args: unknown[]) => mockQuery(...args) },
}));
let mockSetting: string | undefined;
jest.mock("@/db/repos/settings", () => ({
  getSetting: async () => mockSetting,
  setSetting: async (_key: string, value: string) => {
    mockSetting = value;
  },
}));

const model = jest.requireActual<{ modelVersion: string }>("../../../shared/model/model-version.json");
const manifest: MuseumManifest = {
  id: "museum-1" as never,
  key: "one",
  name: "Art Institute of Chicago",
  lat: 1,
  lng: 1,
  version: "v2",
  modelVersion: model.modelVersion,
  size: 3,
  count: 1,
  previews: [
    { title: "Dead link", url: "https://images.museum/dead.jpg" },
    { title: "Reachable", url: "https://images.museum/ok.jpg" },
  ],
  chunks: [{ url: "https://files/0", size: 3, sha256: "ab".repeat(32) }],
};
const response = (body: number[] | undefined, status = 200) => ({
  ok: status < 300,
  status,
  arrayBuffer: async () => new Uint8Array(body ?? []).buffer,
});

beforeEach(() => {
  mockFiles.clear();
  mockFetch.mockReset();
  mockQuery.mockReset();
});

it("deletes a package folder that the bundled model can no longer read instead of orphaning it on disk", async () => {
  const stale = {
    manifest: { ...manifest, version: "v1", modelVersion: "previous-model" },
    folder: "museum-1-v1",
  };
  mockFiles.set("file:///documents/museum-downloads/museum-1-v1", true);
  mockFiles.set("file:///documents/museum-downloads/museum-1-v1/0.json", true);
  mockSetting = JSON.stringify({
    catalog: [],
    downloads: {
      [manifest.id]: {
        museum: manifest,
        status: "ready",
        active: stale,
        completed: 1,
      },
    },
  });
  await museumDownloads.hydrate();
  expect(museumDownloads.getSnapshot().downloads[manifest.id]).toBeUndefined();
  expect([...mockFiles.keys()].some((uri) => uri.includes("museum-1-v1"))).toBe(false);
});

it("finishes a package whose preview thumbnail the museum refuses, keeping the previews it could fetch", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockQuery.mockResolvedValue(manifest);
  mockFetch.mockImplementation(async (url: string) =>
    url === manifest.chunks[0].url
      ? response([1, 2, 3])
      : url.endsWith("dead.jpg")
        ? response(undefined, 403)
        : response([9]),
  );
  await museumDownloads.start(manifest);
  const row = museumDownloads.getSnapshot().downloads[manifest.id];
  expect(row).toMatchObject({
    status: "ready",
    active: { folder: "museum-1-v2" },
    completed: 1,
  });
  expect(previewUri(row.active, 0)).toBeUndefined();
  expect(previewUri(row.active, 1)).toBe("file:///documents/museum-downloads/museum-1-v2/preview-1");
  expect(console.warn).toHaveBeenCalledWith("Museum preview unavailable", manifest.previews[0].url, expect.any(Error));
});
