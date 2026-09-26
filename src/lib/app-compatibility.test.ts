import { cacheMinimum, fetchMinimum, readCachedMinimum } from "./app-compatibility";
import { installationStorage } from "./installation-storage";
import { reportError } from "./observability";

jest.mock("./installation-storage", () => ({ installationStorage: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock("./observability", () => ({ reportError: jest.fn() }));

const getItem = jest.mocked(installationStorage.getItem);
const setItem = jest.mocked(installationStorage.setItem);

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue();
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
    getItem.mockResolvedValue(setItem.mock.calls.at(-1)![1]);
    expect(await readCachedMinimum()).toBe(minimum);
  }
});

it("does not reuse a requirement from a different deployment", async () => {
  getItem.mockResolvedValue(JSON.stringify({ deployment: "https://other.convex.cloud", minimum: "42" }));
  expect(await readCachedMinimum()).toBeNull();
});

it.each(["broken json", JSON.stringify({ deployment: process.env.EXPO_PUBLIC_CONVEX_URL, minimum: "latest" })])(
  "reports corrupt cache without crashing startup",
  async (cached) => {
    getItem.mockResolvedValue(cached);
    expect(await readCachedMinimum()).toBeNull();
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), "app-update.read-cache");
  },
);

it("reports storage failure without disrupting the compatibility decision", async () => {
  setItem.mockRejectedValue(new Error("storage unavailable"));
  await expect(cacheMinimum("42")).resolves.toBeUndefined();
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "app-update.write-cache");
});
