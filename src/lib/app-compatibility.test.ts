import { getInfoAsync, readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";

import { cacheMinimum, fetchMinimum, readCachedMinimum } from "./app-compatibility";
import { installationStorage } from "./installation-storage";
import { reportError } from "./observability";

jest.mock("expo-file-system", () => ({ Paths: { document: { uri: "file:///documents" } } }));
jest.mock("expo-file-system/legacy", () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));
jest.mock("./installation-storage", () => ({
  getInstallationId: jest.fn(() => "installation-a"),
  installationStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock("./observability", () => ({ reportError: jest.fn() }));

const getItem = jest.mocked(installationStorage.getItem);
const setItem = jest.mocked(installationStorage.setItem);
const info = jest.mocked(getInfoAsync);
const read = jest.mocked(readAsStringAsync);
const write = jest.mocked(writeAsStringAsync);
const cacheUri = "file:///documents/app-compatibility.json";

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue();
  info.mockResolvedValue({ exists: false, uri: cacheUri, isDirectory: false });
  read.mockResolvedValue("");
  write.mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

it("fetches the current policy without authentication and passes cancellation to the transport", async () => {
  const transport = jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ status: "success", value: "42", logLines: [] }), { status: 200 }));
  const controller = new AbortController();
  expect(await fetchMinimum(controller.signal)).toBe("42");
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe(`${process.env.EXPO_PUBLIC_CONVEX_URL}/api/query`);
  expect(options?.signal).toBe(controller.signal);
  expect(new Headers(options?.headers).has("Authorization")).toBe(false);
});

it("rejects an invalid response so it cannot overwrite a cached requirement", async () => {
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ status: "success", value: "latest", logLines: [] }), { status: 200 }),
    );
  await expect(fetchMinimum(new AbortController().signal)).rejects.toThrow("Invalid app compatibility response");
});

it("persists requirements and rollbacks for the next offline launch", async () => {
  for (const minimum of ["42", null]) {
    await cacheMinimum(minimum);
    expect(write).toHaveBeenLastCalledWith(cacheUri, expect.any(String));
    info.mockResolvedValue({ exists: true, uri: cacheUri, isDirectory: false, size: 1, modificationTime: 0 });
    read.mockResolvedValue(write.mock.calls.at(-1)![1]);
    expect(await readCachedMinimum()).toBe(minimum);
  }
});

it("has no saved answer before the first check or for a different deployment", async () => {
  expect(await readCachedMinimum()).toBeUndefined();
  getItem.mockResolvedValue(JSON.stringify({ deployment: "https://other.convex.cloud", minimum: "42" }));
  expect(await readCachedMinimum()).toBeUndefined();
});

it.each(["broken json", JSON.stringify({ deployment: process.env.EXPO_PUBLIC_CONVEX_URL, minimum: "latest" })])(
  "reports corrupt cache without crashing startup",
  async (cached) => {
    getItem.mockResolvedValue(cached);
    expect(await readCachedMinimum()).toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "app-update.read-cache");
  },
);

it("reports storage failure without disrupting the compatibility decision", async () => {
  write.mockRejectedValue(new Error("storage unavailable"));
  await expect(cacheMinimum("42")).resolves.toBeUndefined();
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "app-update.write-cache");
});

it("caches the public policy without a Keychain even when Keychain writes would fail", async () => {
  setItem.mockRejectedValue(Object.assign(new Error("No keychain is available"), { code: "ERR_KEY_CHAIN" }));
  await cacheMinimum("42");
  expect(setItem).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith(cacheUri, expect.stringContaining('"minimum":"42"'));
  expect(reportError).not.toHaveBeenCalled();
});

it("ignores a prior installation's file and does not use an older Keychain value", async () => {
  info.mockResolvedValue({ exists: true, uri: cacheUri, isDirectory: false, size: 1, modificationTime: 0 });
  read.mockResolvedValue(
    JSON.stringify({ installation: "installation-b", deployment: process.env.EXPO_PUBLIC_CONVEX_URL, minimum: "42" }),
  );
  expect(await readCachedMinimum()).toBeUndefined();
  expect(getItem).not.toHaveBeenCalled();
});

it("still reads the old cache when no file has been written yet", async () => {
  getItem.mockResolvedValue(JSON.stringify({ deployment: process.env.EXPO_PUBLIC_CONVEX_URL, minimum: "42" }));
  expect(await readCachedMinimum()).toBe("42");
});
