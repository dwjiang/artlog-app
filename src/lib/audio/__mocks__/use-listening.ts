export function useListening() {
  return {
    current: undefined,
    queue: [],
    history: [],
    phase: "idle",
    playing: false,
    position: 0,
    duration: 0,
    rate: 1,
    controller: {
      progressFor: () => undefined,
      play: jest.fn(),
      toggle: jest.fn(),
      enqueue: jest.fn(),
    },
  };
}
export function useHasListeningTrack() {
  return false;
}
