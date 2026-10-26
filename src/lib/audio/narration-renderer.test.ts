import { getNetworkStateAsync } from "expo-network";

import { OfflineError, isNetworkError } from "@/lib/network-error";
import { guideBodyFixture, guideFixture, openingFixture, researchFixture } from "@/shared/audio/guide-fixtures";

import type { ListeningTrack } from "./narration";
import { cachedNarrationUri, createNarrationRenderer } from "./narration-renderer";

const mockFiles = new Map<string, Uint8Array>();
const mockFetch = jest.fn();
jest.mock("expo-crypto", () => ({ randomUUID: () => "download" }));
jest.mock("expo-network", () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  Directory: class {
    uri: string;
    constructor(parent: string, name: string) {
      this.uri = `${parent}/${name}`;
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}/${name}`;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri)?.length ?? 0;
    }
    writeSync(bytes: Uint8Array | string) {
      mockFiles.set(this.uri, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
    }
    textSync() {
      return new TextDecoder().decode(mockFiles.get(this.uri));
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async move(target: { uri: string }) {
      await Promise.resolve();
      if (!mockFiles.has(this.uri)) throw new Error("Source file is missing.");
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = target.uri;
    }
  },
}));

const track: ListeningTrack = {
  work: {
    artworkId: "work" as never,
    title: "Lilies",
    artist: "Monet",
    facts: researchFixture,
    opening: openingFixture,
  },
};
const known: ListeningTrack = { work: { ...track.work, renderId: "render-1" } };
const generated = {
  uri: "https://example.test/audio",
  renderId: "render-1",
  sentences: guideFixture,
  live: false,
  facts: researchFixture,
  researchUpdatedAt: 5,
};
function body(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
const finished = (bytes = [73, 68, 51]) => ({ ok: true, body: body(new Uint8Array(bytes)) });
// A download whose body arrives one chunk at a time, each after `delays[i]` ms, unless the request is aborted.
function trickle(delays: number[], signal: AbortSignal) {
  let sent = 0;
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.enqueue(new Uint8Array(1000).fill(1));
            if (++sent === delays.length) controller.close();
            resolve();
          }, delays[sent]);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        }),
    }),
  };
}
// Lets pending promise chains, such as the connectivity check, run before the test acts.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  mockFiles.clear();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => finished());
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: true, isInternetReachable: true });
});
afterEach(() => jest.useRealTimers());

it("finds already downloaded audio for duration lookup without generating or fetching it", async () => {
  const generate = jest.fn(async () => generated);
  const first = await createNarrationRenderer(generate).render(track);
  mockFetch.mockClear();
  generate.mockClear();
  expect(await cachedNarrationUri("render-1")).toBe(first.uri);
  expect(generate).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it("has no cached duration source for missing, empty, or superseded audio", async () => {
  expect(await cachedNarrationUri("render-1")).toBeUndefined();
  const first = await createNarrationRenderer(async () => generated).render(track);
  expect(await cachedNarrationUri("render-2")).toBeUndefined();
  mockFiles.set(first.uri, new Uint8Array());
  expect(await cachedNarrationUri("render-1")).toBeUndefined();
});

it("replays a known render offline without a backend or network request", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const { facts, researchUpdatedAt, ...first } = await renderer.render(track);
  expect(generate).toHaveBeenCalledWith({ artworkId: "work" });
  expect({ facts, researchUpdatedAt }).toEqual({ facts: generated.facts, researchUpdatedAt: 5 });
  generate.mockRejectedValue(new Error("Offline"));
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: false, isInternetReachable: false });
  // A known render already belongs to the track's research, so the replay brings none.
  expect(await renderer.render(known)).toEqual(first);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(first).toEqual({
    uri: "file:///cache/narration/render-1.mp3",
    sentences: generated.sentences,
    renderId: "render-1",
    live: false,
  });
  expect([...mockFiles.keys()]).toEqual([first.uri, first.uri.replace(".mp3", ".json")]);
});

it("plays speech that is still being generated from its playlist without downloading or caching it", async () => {
  const live = { ...generated, uri: "https://example.convex.site/narration-playlist?render=render-1", live: true };
  const renderer = createNarrationRenderer(async () => live);
  expect(await renderer.render(track)).toEqual(live);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockFiles.size).toBe(0);
  expect(await cachedNarrationUri("render-1")).toBeUndefined();
});

it("plays the server's script when the queued track's opening is out of date", async () => {
  // The track was queued before the work's date was corrected; the server writes from the current record.
  const opening = "Claude Monet. Water Lilies. Circa 1916.";
  const sentences = [{ sentence: opening, factIds: [], section: "hook" as const }, ...guideBodyFixture];
  const live = { ...generated, sentences, live: true };
  expect(await createNarrationRenderer(async () => live).render(track)).toEqual(live);
  const rendered = await createNarrationRenderer(async () => ({ ...generated, sentences })).render(track);
  expect(rendered.sentences).toEqual(sentences);
  // The cached copy keeps its own opening, so a replay of the stale track does not ask the server again.
  const generate = jest.fn(async () => generated);
  expect((await createNarrationRenderer(generate).render(known)).sentences).toEqual(sentences);
  expect(generate).not.toHaveBeenCalled();
});

it("trusts the server's content rules but rejects a script it cannot show", async () => {
  const thin = [{ sentence: openingFixture, factIds: [], section: "hook" as const }, guideBodyFixture[0]];
  const accepted = await createNarrationRenderer(async () => ({ ...generated, sentences: thin, live: true })).render(
    track,
  );
  expect(accepted.sentences).toEqual(thin);
  for (const sentences of [
    [],
    [{ sentence: openingFixture, factIds: [], section: "outro" }],
    [{ sentence: 7, factIds: [], section: "hook" }],
    [{ sentence: openingFixture, factIds: [1], section: "hook" }],
    [{ sentence: openingFixture, section: "hook" }],
    "not a script",
  ]) {
    const renderer = createNarrationRenderer(async () => ({ ...generated, sentences: sentences as never }));
    await expect(renderer.render(track)).rejects.toThrow("Narration transcript is invalid.");
  }
  expect(mockFetch).not.toHaveBeenCalled();
});

it("skips the download when the server names a render that is already on disk", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFetch.mockClear();
  expect(await renderer.render(track)).toEqual(first);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(mockFetch).not.toHaveBeenCalled();
});

it("fetches a re-rendered narration even when an older render is cached", async () => {
  const renderer = createNarrationRenderer(async () => ({
    ...generated,
    renderId: "render-2",
  }));
  mockFiles.set("file:///cache/narration/render-1.mp3", new Uint8Array([1]));
  mockFiles.set("file:///cache/narration/render-1.json", new TextEncoder().encode(JSON.stringify(guideFixture)));
  const result = await renderer.render(track);
  expect(result.renderId).toBe("render-2");
  expect(result.uri).toBe("file:///cache/narration/render-2.mp3");
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it("does not save a failed or empty download as playable audio", async () => {
  const renderer = createNarrationRenderer(async () => generated);
  mockFetch.mockResolvedValueOnce({ ok: false });
  await expect(renderer.render(track)).rejects.toThrow("download failed");
  mockFetch.mockResolvedValueOnce({ ok: true, body: body() });
  await expect(renderer.render(track)).rejects.toThrow("empty");
  expect(mockFiles.size).toBe(0);
  expect((await renderer.render(track)).uri).toMatch(/\.mp3$/);
});

it("ignores a late server result after playback is cancelled", async () => {
  let finish!: (result: typeof generated) => void;
  const generate = jest.fn(
    () =>
      new Promise<typeof generated>((resolve) => {
        finish = resolve;
      }),
  );
  const renderer = createNarrationRenderer(generate);
  const pending = renderer.render(track);
  await settle();
  renderer.cancel();
  finish(generated);
  await expect(pending).rejects.toThrow("cancelled");
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockFiles.size).toBe(0);
});

it("downloads a matching transcript again if the local transcript was corrupted", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFiles.set(first.uri.replace(".mp3", ".json"), new TextEncoder().encode("invalid json"));
  expect((await renderer.render(known)).sentences).toEqual(generated.sentences);
  expect(generate).toHaveBeenCalledTimes(2);
});

it("replaces cached audio whose transcript lacks the required opening", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFiles.set(first.uri.replace(".mp3", ".json"), new TextEncoder().encode(JSON.stringify(guideBodyFixture)));
  expect((await renderer.render(known)).sentences[0].sentence).toBe(openingFixture);
  expect(generate).toHaveBeenCalledTimes(2);
});

it("reports generation and download only while that work is happening, and skips both for a local replay", async () => {
  const onStage = jest.fn();
  const generate = jest.fn(async () => {
    expect(onStage).toHaveBeenLastCalledWith("generating");
    return generated;
  });
  mockFetch.mockImplementationOnce(async () => {
    expect(onStage).toHaveBeenLastCalledWith("downloading");
    return finished([1]);
  });
  const renderer = createNarrationRenderer(generate);
  await renderer.render(track, onStage);
  expect(onStage.mock.calls).toEqual([["generating"], ["downloading"]]);
  onStage.mockClear();
  await renderer.render(known, onStage);
  expect(onStage).not.toHaveBeenCalled();
});

it("does not report a download for live speech or a cancelled generation", async () => {
  const onStage = jest.fn();
  await createNarrationRenderer(async () => ({ ...generated, live: true })).render(track, onStage);
  expect(onStage.mock.calls).toEqual([["generating"]]);
  onStage.mockClear();
  const renderer = createNarrationRenderer(async () => {
    renderer.cancel();
    return generated;
  });
  await expect(renderer.render(track, onStage)).rejects.toThrow("cancelled");
  expect(onStage.mock.calls).toEqual([["generating"]]);
});

it("keeps the research a first play's render wrote, which the track did not have", async () => {
  const unresearched: ListeningTrack = { work: { ...track.work, facts: [] } };
  const rendered = await createNarrationRenderer(async () => generated).render(unresearched);
  expect(rendered).toMatchObject({ sentences: guideFixture, facts: researchFixture, researchUpdatedAt: 5 });
});

it("replaces audio rejected by the player without invalidating another cached guide", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  const other = await createNarrationRenderer(async () => ({ ...generated, renderId: "render-2" })).render(track);

  renderer.invalidate(first.renderId);
  expect(await cachedNarrationUri(first.renderId)).toBeUndefined();
  expect(mockFiles.has(first.uri.replace(".mp3", ".json"))).toBe(false);
  expect(await cachedNarrationUri(other.renderId)).toBe(other.uri);
  mockFetch.mockClear();
  expect(await renderer.render(known)).toEqual({ ...first, facts: generated.facts, researchUpdatedAt: 5 });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it("discards a cancelled download that finishes after a different guide is cached", async () => {
  let finish!: (bytes: Uint8Array) => void;
  mockFetch.mockResolvedValueOnce({
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start: (controller) => {
        finish = (bytes) => {
          controller.enqueue(bytes);
          controller.close();
        };
      },
    }),
  });
  const generate = jest.fn(async () => generated);
  generate.mockResolvedValueOnce({ ...generated, renderId: "old-render" });
  const renderer = createNarrationRenderer(generate);
  const old = renderer.render(track);
  await settle();
  const current = await renderer.render(track);
  finish(new Uint8Array([9]));
  await expect(old).rejects.toThrow("cancelled");
  expect([...mockFiles.keys()]).toEqual([current.uri, current.uri.replace(".mp3", ".json")]);
  expect((await renderer.render(known)).sentences).toEqual(current.sentences);
});

describe("downloading a finished guide on a slow connection", () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] }));

  it("keeps a download that takes minutes while bytes keep arriving", async () => {
    // About 1 MB at 260 kbit/s: a chunk every 8 s for over a minute.
    mockFetch.mockImplementation(async (_uri: string, { signal }: { signal: AbortSignal }) =>
      trickle(
        Array.from({ length: 10 }, () => 8_000),
        signal,
      ),
    );
    const result = createNarrationRenderer(async () => generated).render(track);
    await jest.advanceTimersByTimeAsync(80_000);
    const rendered = await result;
    expect(rendered.uri).toBe("file:///cache/narration/render-1.mp3");
    expect(mockFiles.get(rendered.uri)).toHaveLength(10_000);
  });

  it("gives up as a connection failure once no bytes arrive for 30 seconds, keeping no partial file", async () => {
    mockFetch.mockImplementation(async (_uri: string, { signal }: { signal: AbortSignal }) =>
      trickle([1_000, 40_000], signal),
    );
    const outcome = createNarrationRenderer(async () => generated)
      .render(track)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(31_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect(isNetworkError(error)).toBe(true);
    expect(mockFiles.size).toBe(0);
  });

  it("gives up after a few minutes even while bytes keep trickling in", async () => {
    mockFetch.mockImplementation(async (_uri: string, { signal }: { signal: AbortSignal }) =>
      trickle(
        Array.from({ length: 100 }, () => 20_000),
        signal,
      ),
    );
    const outcome = createNarrationRenderer(async () => generated)
      .render(track)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(180_000);
    expect(isNetworkError(await outcome)).toBe(true);
    expect(mockFiles.size).toBe(0);
  });

  it("treats a cancelled download as cancelled, not as a connection failure", async () => {
    mockFetch.mockImplementation(async (_uri: string, { signal }: { signal: AbortSignal }) =>
      trickle([10_000], signal),
    );
    const renderer = createNarrationRenderer(async () => generated);
    const outcome = renderer.render(track).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(1_000);
    renderer.cancel();
    const error = await outcome;
    expect(error).toEqual(new Error("Narration cancelled."));
    expect(isNetworkError(error)).toBe(false);
  });
});

it("fails fast offline instead of waiting for the server, but still replays cached audio", async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  jest.mocked(getNetworkStateAsync).mockResolvedValue({ isConnected: false, isInternetReachable: false });
  await expect(renderer.render({ work: { ...track.work, artworkId: "other" as never } })).rejects.toBeInstanceOf(
    OfflineError,
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect((await renderer.render(known)).uri).toBe(first.uri);
});

it("asks the server when connectivity cannot be checked", async () => {
  jest.mocked(getNetworkStateAsync).mockRejectedValue(new Error("Unavailable"));
  const generate = jest.fn(async () => generated);
  await createNarrationRenderer(generate).render(track);
  expect(generate).toHaveBeenCalledTimes(1);
});
