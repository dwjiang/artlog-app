import { render, screen } from '@testing-library/react-native';

import { DevTimings, formatCaptureTimings } from './dev-timings';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

it('lists the total and each recorded stage in milliseconds', async () => {
  const timings = { warp: 273.4, triage: 8.6, embed: 480.2, orb: 11.7, identify: 38.1, total: 812.0 };
  expect(formatCaptureTimings(timings)).toBe('Capture 812 ms · warp 273 · triage 9 · embed 480 · orb 12 · identify 38');
  expect(formatCaptureTimings({ warp: 300, enqueue: 4.4, total: 304.4 })).toBe('Capture 304 ms · warp 300 · enqueue 4');
  await render(<DevTimings timings={timings} />);
  expect(screen.getByText(/^Capture 812 ms/)).toBeOnTheScreen();
});

it('renders nothing before the first capture', async () => {
  const empty = await render(<DevTimings />);
  expect(empty.toJSON()).toBeNull();
});
