import { act, render, screen } from '@testing-library/react-native';
import type { SharedValue } from 'react-native-reanimated';

import { GuidanceLabel, SEARCHING_HINT_MS, ViewfinderOverlay, guidanceMessages, searchingHint } from './viewfinder-overlay';
import type { Guidance } from '@/lib/capture/rectangle';
import type { LiveQuad } from '@/lib/capture/use-rect-detector';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const shared = <T,>(value: T) => ({ value, get: () => value, set: jest.fn() });
  return {
    __esModule: true,
    default: { View },
    useSharedValue: shared,
    useDerivedValue: <T,>(compute: () => T) => shared(compute()),
    useAnimatedStyle: <T,>(compute: () => T) => compute(),
    withTiming: <T,>(value: T) => value,
  };
});
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

const live: LiveQuad = { quad: [[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]], frameWidth: 768, frameHeight: 1024 };
const liveQuad = { value: live, get: () => live, set: jest.fn() } as unknown as SharedValue<LiveQuad>;

afterEach(() => jest.useRealTimers());

it.each([
  ['searching', 'Point at a painting'],
  ['move-closer', 'Move closer'],
  ['fit-whole-painting', 'Get the whole painting in frame'],
  ['straighten', 'Straighten up'],
  ['hold-still', 'Hold still'],
] as [Guidance, string][])('tells the user what to change while %s', async (guidance, message) => {
  await render(<GuidanceLabel guidance={guidance} />);
  expect(screen.getByText(message)).toBeOnTheScreen();
  expect(screen.queryByText(searchingHint)).toBeNull();
});

it('shows no instruction once the painting is ready', async () => {
  expect(guidanceMessages.ready).toBeNull();
  await render(<GuidanceLabel guidance="ready" />);
  expect(screen.queryByText(/./)).toBeNull();
});

it('adds a framing hint after three seconds without a painting and drops it once one is found', async () => {
  jest.useFakeTimers();
  const label = await render(<GuidanceLabel guidance="searching" />);
  await act(() => jest.advanceTimersByTime(SEARCHING_HINT_MS - 1));
  expect(screen.queryByText(searchingHint)).toBeNull();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.getByText(searchingHint)).toBeOnTheScreen();
  await label.rerender(<GuidanceLabel guidance="hold-still" />);
  expect(screen.queryByText(searchingHint)).toBeNull();
  await label.rerender(<GuidanceLabel guidance="searching" />);
  await act(() => jest.advanceTimersByTime(SEARCHING_HINT_MS - 1));
  expect(screen.queryByText(searchingHint)).toBeNull();
});

it('draws the painting outline over the preview', async () => {
  await render(<ViewfinderOverlay liveQuad={liveQuad} guidance="ready" />);
  expect(screen.getByLabelText('Painting outline')).toBeOnTheScreen();
});
