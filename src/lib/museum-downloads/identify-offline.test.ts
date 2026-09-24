import type { MuseumEntry } from "@/shared/offline/types";

import { identifyOffline } from "./identify-offline";
import type { LocalPackage, MuseumDownload } from "./model";

const mockRead = jest.fn();
const mockRecognize = jest.fn();
let mockDownloads: Record<string, MuseumDownload> = {};
jest.mock("./storage", () => ({
  museumDownloads: {
    hydrate: async () => {},
    getSnapshot: () => ({ downloads: mockDownloads }),
  },
  readEntries: (...args: unknown[]) => mockRead(...args),
}));
jest.mock("@/shared/offline/recognition", () => ({
  ...jest.requireActual("@/shared/offline/recognition"),
  recognizeEntries: (...args: unknown[]) => mockRecognize(...args),
}));

const { modelVersion } = jest.requireActual<{ modelVersion: string }>("@/shared/model/model-version.json");
const capture = {
  vector: [1, 0],
  descriptors: new ArrayBuffer(0),
  keypoints: new ArrayBuffer(0),
  modelVersion,
};
const downloaded = (id: string, packModelVersion = modelVersion): MuseumDownload => ({
  museum: { id } as never,
  status: "ready",
  completed: 1,
  active: {
    manifest: {
      modelVersion: packModelVersion,
      chunks: [{ url: "", size: 1, sha256: "" }],
    },
    folder: `${id}-v1`,
  } as unknown as LocalPackage,
});
const entry = (objectId: string, vector: number[]) =>
  ({
    vectors: [vector],
    candidate: { object: { _id: objectId }, similarity: 0 },
  }) as unknown as MuseumEntry;
const rankedIds = () => (mockRecognize.mock.calls[0][1] as MuseumEntry[]).map((match) => match.candidate.object._id);

beforeEach(() => {
  mockRead.mockReset();
  mockRecognize.mockReset().mockReturnValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it("keeps matching the remaining museums when one downloaded package cannot be read", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockDownloads = {
    damaged: downloaded("damaged"),
    intact: downloaded("intact"),
  };
  mockRead.mockImplementation(async (pack: LocalPackage) => {
    if (pack.folder === "damaged-v1") {
      throw new Error("Unexpected end of JSON input");
    }
    return [entry("obj-intact", [1, 0])];
  });
  mockRecognize.mockReturnValue({ outcome: "confident" });

  expect(await identifyOffline(capture)).toEqual({ outcome: "confident" });
  expect(rankedIds()).toEqual(["obj-intact"]);
  expect(console.warn).toHaveBeenCalledWith(
    "Museum download unreadable; skipping it for this scan",
    "damaged-v1",
    expect.any(Error),
  );
});

it("ranks across every package built for the bundled model and skips the others", async () => {
  mockDownloads = {
    one: downloaded("one"),
    two: downloaded("two"),
    stale: downloaded("stale", "previous-model"),
  };
  mockRead.mockImplementation(async (pack: LocalPackage) => [
    pack.folder === "one-v1" ? entry("obj-far", [0, 1]) : entry("obj-near", [1, 0]),
  ]);

  await identifyOffline(capture);
  expect(rankedIds()).toEqual(["obj-near", "obj-far"]);
  expect(mockRead).toHaveBeenCalledTimes(2);
});
