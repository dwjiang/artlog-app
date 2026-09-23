import { guideBodyFixture, guideFixture, openingFixture, researchFixture } from '@/shared/audio/guide-fixtures';
import { cachedNarrationUri, createNarrationRenderer } from './narration-renderer';
import type { ListeningTrack } from './narration';

const mockFiles = new Map<string, Uint8Array>();
const mockFetch = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'download' }));
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  Directory: class {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
  },
  File: class {
    uri: string;
    constructor(parent: { uri: string }, name: string) { this.uri = `${parent.uri}/${name}`; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.length ?? 0; }
    write(bytes: Uint8Array | string) { mockFiles.set(this.uri, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes); }
    textSync() { return new TextDecoder().decode(mockFiles.get(this.uri)); }
    delete() { mockFiles.delete(this.uri); }
    async move(target: { uri: string }) {
      await Promise.resolve();
      if (!mockFiles.has(this.uri)) throw new Error('Source file is missing.');
      mockFiles.set(target.uri, mockFiles.get(this.uri)!); mockFiles.delete(this.uri); this.uri = target.uri;
    }
  },
}));

const track: ListeningTrack = { work: { artworkId: 'work' as never, title: 'Lilies', artist: 'Monet', facts: researchFixture, opening: openingFixture } };
const known: ListeningTrack = { work: { ...track.work, renderId: 'render-1' } };
const generated = { uri: 'https://example.test/audio', renderId: 'render-1', sentences: guideFixture };
beforeEach(() => {
  mockFiles.clear(); mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([73, 68, 51]).buffer });
});

it('finds already downloaded audio for duration lookup without generating or fetching it', async () => {
  const generate = jest.fn(async () => generated);
  const first = await createNarrationRenderer(generate).render(track);
  mockFetch.mockClear(); generate.mockClear();
  expect(await cachedNarrationUri('render-1')).toBe(first.uri);
  expect(generate).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('has no cached duration source for missing, empty, or superseded audio', async () => {
  expect(await cachedNarrationUri('render-1')).toBeUndefined();
  const first = await createNarrationRenderer(async () => generated).render(track);
  expect(await cachedNarrationUri('render-2')).toBeUndefined();
  mockFiles.set(first.uri, new Uint8Array());
  expect(await cachedNarrationUri('render-1')).toBeUndefined();
});

it('replays a known render offline without a backend or network request', async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  expect(generate).toHaveBeenCalledWith({ artworkId: 'work' });
  generate.mockRejectedValue(new Error('Offline'));
  expect(await renderer.render(known)).toEqual(first);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(first).toEqual({ uri: 'file:///cache/narration/render-1.mp3', sentences: generated.sentences, renderId: 'render-1' });
  expect([...mockFiles.keys()]).toEqual([first.uri, first.uri.replace('.mp3', '.json')]);
});

it('skips the download when the server names a render that is already on disk', async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFetch.mockClear();
  expect(await renderer.render(track)).toEqual(first);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('fetches a re-rendered narration even when an older render is cached', async () => {
  const renderer = createNarrationRenderer(async () => ({ ...generated, renderId: 'render-2' }));
  mockFiles.set('file:///cache/narration/render-1.mp3', new Uint8Array([1]));
  mockFiles.set('file:///cache/narration/render-1.json', new TextEncoder().encode(JSON.stringify(guideFixture)));
  const result = await renderer.render(track);
  expect(result.renderId).toBe('render-2');
  expect(result.uri).toBe('file:///cache/narration/render-2.mp3');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('does not save a failed or empty download as playable audio', async () => {
  const renderer = createNarrationRenderer(async () => generated);
  mockFetch.mockResolvedValueOnce({ ok: false });
  await expect(renderer.render(track)).rejects.toThrow('download failed');
  mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await expect(renderer.render(track)).rejects.toThrow('empty');
  expect(mockFiles.size).toBe(0);
  expect((await renderer.render(track)).uri).toMatch(/\.mp3$/);
});

it('ignores a late server result after playback is cancelled', async () => {
  let finish!: (result: typeof generated) => void;
  const generate = jest.fn(() => new Promise<typeof generated>((resolve) => { finish = resolve; }));
  const renderer = createNarrationRenderer(generate);
  const pending = renderer.render(track);
  await Promise.resolve();
  renderer.cancel(); finish(generated);
  await expect(pending).rejects.toThrow('cancelled');
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockFiles.size).toBe(0);
});

it('downloads a matching transcript again if the local transcript was corrupted', async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFiles.set(first.uri.replace('.mp3', '.json'), new TextEncoder().encode('invalid json'));
  expect((await renderer.render(known)).sentences).toEqual(generated.sentences);
  expect(generate).toHaveBeenCalledTimes(2);
});

it('rejects a server transcript that omits the artwork introduction', async () => {
  const renderer = createNarrationRenderer(async () => ({ ...generated, sentences: guideBodyFixture }));
  await expect(renderer.render(track)).rejects.toThrow('transcript is invalid');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('replaces cached audio whose transcript lacks the required opening', async () => {
  const generate = jest.fn(async () => generated);
  const renderer = createNarrationRenderer(generate);
  const first = await renderer.render(track);
  mockFiles.set(first.uri.replace('.mp3', '.json'), new TextEncoder().encode(JSON.stringify(guideBodyFixture)));
  expect((await renderer.render(known)).sentences[0].sentence).toBe(openingFixture);
  expect(generate).toHaveBeenCalledTimes(2);
});
