export function useListening() {
  return { current: undefined, queue: [], phase: 'idle', playing: false, position: 0, duration: 0, pauseBetween: true, rate: 1, volume: 1,
    controller: { progressFor: () => undefined, play: jest.fn(), toggle: jest.fn(), enqueue: jest.fn() } };
}
export function useHasListeningTrack() { return false; }
