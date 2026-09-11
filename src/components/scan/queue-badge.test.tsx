import { fireEvent, render, screen } from '@testing-library/react-native';

import { QueueBadge } from './queue-badge';
import type { PendingScanStatus } from '@/db/schema';

const mockPush = jest.fn();
let mockStatuses: PendingScanStatus[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/queue/use-queue', () => ({ useQueue: () => ({
  pending: mockStatuses.filter((status) => status === 'queued' || status === 'identifying').length,
  items: mockStatuses.map((status) => ({ status })),
}) }));

beforeEach(() => mockPush.mockReset());

it('stays hidden while nothing waits for signal', async () => {
  mockStatuses = [];
  const badge = await render(<QueueBadge />);
  expect(badge.toJSON()).toBeNull();
});

it('counts every capture in the queue and opens it on tap', async () => {
  mockStatuses = ['queued', 'failed', 'identified'];
  await render(<QueueBadge />);
  expect(screen.getByText('3')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '3 scans in queue' }));
  expect(mockPush).toHaveBeenCalledWith('/queue');
});

it.each(['queued', 'failed', 'identified'] as const)('keeps a lone %s scan reachable', async (status) => {
  mockStatuses = [status];
  await render(<QueueBadge />);
  await fireEvent.press(screen.getByRole('button', { name: '1 scan in queue' }));
  expect(mockPush).toHaveBeenCalledWith('/queue');
});
