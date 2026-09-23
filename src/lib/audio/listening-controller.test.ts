import { openingFixture, researchFixture } from '@/shared/audio/guide-fixtures';
import { ListeningController, type AudioHandle, type Playback } from './listening-controller';
import { trackKey, type ListeningTrack } from './narration';

const track = (id: string): ListeningTrack => ({ work: { artworkId: id as never, title: id, artist: 'Artist', facts: researchFixture, researchUpdatedAt: 5, opening: openingFixture } });
class Player implements AudioHandle {
  volume = 1;
  callback?: (value: Playback) => void;
  play = jest.fn(); pause = jest.fn(); remove = jest.fn(); setPlaybackRate = jest.fn(); setActiveForLockScreen = jest.fn();
  seekTo = jest.fn(async () => {});
  addListener(_event: 'playbackStatusUpdate', callback: (value: Playback) => void) { this.callback = callback; return { remove: jest.fn() }; }
  emit(patch: Partial<Playback> = {}) { this.callback?.({ currentTime: 0, duration: 100, playing: false, isLoaded: true, didJustFinish: false, ...patch }); }
}
function setup() {
  const players: Player[] = [];
  const deps = { render: jest.fn(async () => ({ uri: 'file:///audio.mp3', duration: 100, sentences: [{ sentence: 'A spoken guide.', factIds: ['f1'] }] })), cancel: jest.fn(), configure: jest.fn(async () => {}), create: jest.fn(() => { const player = new Player(); players.push(player); return player; }) };
  const controller = new ListeningController(deps);
  async function play(item: ListeningTrack) { await controller.play(item); const player = players.at(-1)!; player.emit(); await Promise.resolve(); return player; }
  return { controller, deps, players, play };
}
afterEach(() => jest.useRealTimers());
it('preserves position for each artwork, including when another guide is loaded paused', async () => {
  const { controller, play, players } = setup();
  const first = await play(track('a')); first.emit({ currentTime: 22, playing: true });
  await controller.play(track('b'), false); const paused = players.at(-1)!; paused.emit(); await Promise.resolve();
  expect(paused.play).not.toHaveBeenCalled(); paused.emit({ currentTime: 8 });
  const resumed = await play(track('a'));
  expect(resumed.seekTo).toHaveBeenCalledWith(22);
  expect(controller.progressFor(track('b'))?.position).toBe(8);
  controller.dispose();
});
it('deduplicates queued versions, reorders and removes without interrupting playback', async () => {
  const { controller, play } = setup(); const player = await play(track('a'));
  controller.enqueue(track('a')); controller.enqueue(track('b')); controller.enqueue(track('b')); controller.enqueue(track('c'));
  controller.move(trackKey(track('c')), -1);
  expect(controller.snapshot().queue.map((item) => item.work.title)).toEqual(['c', 'b']);
  controller.remove(trackKey(track('b')));
  expect(controller.snapshot().current?.work.title).toBe('a'); expect(player.pause).not.toHaveBeenCalled();
  controller.dispose();
});
it('waits at the next artwork by default and autoplays only when enabled', async () => {
  const { controller, play, players } = setup();
  const first = await play(track('a')); controller.enqueue(track('b')); first.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve(); await Promise.resolve(); const second = players.at(-1)!; second.emit(); await Promise.resolve();
  expect(controller.snapshot().current?.work.title).toBe('b'); expect(controller.snapshot().waiting).toBe(true); expect(second.play).not.toHaveBeenCalled();
  controller.setPauseBetween(false); controller.enqueue(track('c')); second.emit({ currentTime: 100, didJustFinish: true });
  await Promise.resolve(); await Promise.resolve(); const third = players.at(-1)!; third.emit(); await Promise.resolve();
  expect(third.play).toHaveBeenCalled(); controller.dispose();
});
it('ignores late synthesis after a different track or stop', async () => {
  const { controller, deps } = setup();
  let resolve!: (value: { uri: string; duration: number; sentences: { sentence: string; factIds: string[] }[] }) => void;
  deps.render.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const old = controller.play(track('a')); await Promise.resolve();
  await controller.play(track('b')); resolve({ uri: 'old', duration: 3, sentences: [{ sentence: 'Old script.', factIds: ['f1'] }] }); await old;
  expect(deps.create).toHaveBeenCalledTimes(1); expect(controller.snapshot().current?.work.title).toBe('b');
  controller.stop(); expect(controller.snapshot().current).toBeUndefined(); expect(deps.cancel).toHaveBeenCalled();
});
it('clamps seeks and restarts completed narration', async () => {
  const { controller, play, players } = setup(); const first = await play(track('a'));
  await controller.seek(-15); expect(first.seekTo).toHaveBeenLastCalledWith(0);
  await controller.seek(150); expect(first.seekTo).toHaveBeenLastCalledWith(100);
  first.emit({ currentTime: 100, didJustFinish: true }); controller.toggle();
  await Promise.resolve(); await Promise.resolve(); const second = players.at(-1)!; second.emit(); await Promise.resolve();
  expect(second.seekTo).toHaveBeenCalledWith(0); controller.dispose();
});
it('shows a retryable error on synthesis failure without dropping the remaining queue', async () => {
  const { controller, deps } = setup(); controller.enqueue(track('b')); deps.render.mockRejectedValueOnce(new Error('No voice'));
  await controller.play(track('a')); expect(controller.snapshot().phase).toBe('error'); expect(controller.snapshot().queue).toHaveLength(1);
  controller.dispose();
});
it('resets progress when the research changes', async () => {
  const { controller, play } = setup();
  const original = track('a');
  const player = await play(original); player.emit({ currentTime: 22 });
  expect(controller.progressFor(original)?.position).toBe(22);
  expect(controller.progressFor({ work: { ...original.work, researchUpdatedAt: 6 } })).toBeUndefined();
  controller.dispose();
});

it('learns the duration from downloaded audio and uses it when resuming and finishing', async () => {
  const { controller, deps, players } = setup();
  deps.render.mockResolvedValue({ uri: 'file:///shimmer.mp3', sentences: [{ sentence: 'A spoken guide.', factIds: ['f1'] }] } as never);
  await controller.play(track('a'));
  const first = players.at(-1)!; first.emit({ duration: 27 }); await Promise.resolve();
  first.emit({ currentTime: 12, duration: 27, playing: true });
  await controller.play(track('b'));
  await controller.play(track('a'));
  const resumed = players.at(-1)!; resumed.emit({ duration: 27 }); await Promise.resolve();
  expect(resumed.seekTo).toHaveBeenCalledWith(12);
  resumed.emit({ currentTime: 27, duration: 27, didJustFinish: true });
  expect(controller.snapshot()).toMatchObject({ duration: 27, position: 27, playing: false });
  controller.dispose();
});


it('shows the spoken transcript while retaining the original evidence for replay', async () => {
  const { controller, play, deps } = setup();
  const original = track('a');
  await play(original);
  expect(controller.snapshot().sentences).toEqual([{ sentence: 'A spoken guide.', factIds: ['f1'] }]);
  expect(controller.snapshot().current).toEqual(original);
  controller.restart();
  await Promise.resolve(); await Promise.resolve();
  expect(deps.render).toHaveBeenLastCalledWith(original);
  controller.stop();
  expect(controller.snapshot().sentences).toBeUndefined();
});
