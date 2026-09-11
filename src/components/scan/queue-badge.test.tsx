import { render, screen } from '@testing-library/react-native';

import { QueueBadge } from './queue-badge';

let mockPending = 0;

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/queue/use-queue', () => ({ useQueue: () => ({ pending: mockPending, items: [] }) }));

it('stays hidden while nothing waits for signal', async () => {
  mockPending = 0;
  const badge = await render(<QueueBadge />);
  expect(badge.toJSON()).toBeNull();
});

it('counts the captures waiting for signal', async () => {
  mockPending = 2;
  await render(<QueueBadge />);
  expect(screen.getByLabelText('2 scans waiting for signal')).toBeOnTheScreen();
  expect(screen.getByText('2')).toBeOnTheScreen();
});

it('reads naturally for a single capture', async () => {
  mockPending = 1;
  await render(<QueueBadge />);
  expect(screen.getByLabelText('1 scan waiting for signal')).toBeOnTheScreen();
});
