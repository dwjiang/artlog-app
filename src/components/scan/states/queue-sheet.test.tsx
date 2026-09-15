import { fireEvent, render, screen } from '@testing-library/react-native';

import { RETRY_ROW } from './queue-row';
import { QUEUE_EMPTY, QUEUE_FOOTER, QueueSheet, queueTitle } from './queue-sheet';
import type { PendingScan } from '@/db/schema';

const mockDismiss = jest.fn();
const mockPush = jest.fn();
const mockRetry = jest.fn();
let mockItems: PendingScan[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ dismiss: mockDismiss, push: mockPush }) }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/queue/queue', () => ({ retryPendingScan: (localId: string) => mockRetry(localId) }));
jest.mock('@/lib/queue/use-queue', () => ({
  useQueue: () => ({ pending: mockItems.filter((row) => row.status !== 'failed').length, items: mockItems }),
}));

const now = Date.now();
function row(localId: string, status: PendingScan['status'], minutesAgo: number): PendingScan {
  return {
    owner: 'device:test-installation', localId, photoPath: `photos/${localId}.jpg`, cropPath: `crops/${localId}.jpg`, vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', venueId: null, visitId: null, visitLocalId: null, capturedAt: now - minutesAgo * 60_000, labelPhotoPath: null, qrUrl: null,
    status, attemptModelVersion: 'm', attempts: 0, lastError: status === 'failed' ? 'bad_features' : null, scanId: null, reviewedAt: null, createdAt: now,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRetry.mockResolvedValue(undefined);
});

it('lists the waiting scans with their status, closes itself and opens the tapped card', async () => {
  mockItems = [row('old', 'queued', 40), row('mid', 'identifying', 3), row('bad', 'failed', 1)];
  await render(<QueueSheet />);
  expect(screen.getByText('3 scans in queue')).toBeOnTheScreen();
  expect(screen.getByText('Waiting for signal')).toBeOnTheScreen();
  expect(screen.getByText('Identifying…')).toBeOnTheScreen();
  expect(screen.getByText(RETRY_ROW)).toBeOnTheScreen();
  expect(screen.getByText(QUEUE_FOOTER)).toBeOnTheScreen();
  expect(screen.queryByText(QUEUE_EMPTY)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan from 40 min ago, Waiting for signal' }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId: 'local-old' } });
});

it('retries a failed scan through the queue', async () => {
  mockItems = [row('bad', 'failed', 1)];
  await render(<QueueSheet />);
  expect(screen.getByText('1 scan in queue')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: RETRY_ROW }));
  expect(mockRetry).toHaveBeenCalledWith('bad');
  expect(mockPush).not.toHaveBeenCalled();
});

it('says so once nothing is waiting', async () => {
  mockItems = [];
  await render(<QueueSheet />);
  expect(screen.getByText('Nothing is waiting')).toBeOnTheScreen();
  expect(screen.getByText(QUEUE_EMPTY)).toBeOnTheScreen();
  expect(screen.getByText(QUEUE_FOOTER)).toBeOnTheScreen();
});

it.each([
  [0, 'Nothing is waiting'],
  [1, '1 scan in queue'],
  [3, '3 scans in queue'],
])('titles %i rows as "%s"', (total, title) => {
  expect(queueTitle(total)).toBe(title);
});

it('keeps a completed result available to open when nothing is waiting', async () => {
  mockItems = [{ ...row('ready', 'identified', 2), scanId: 'scan-ready' as never }];
  await render(<QueueSheet />);
  expect(screen.getByText('1 scan in queue')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan from 2 min ago, Ready to review' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[scanId]', params: { scanId: 'local-ready' } });
});
