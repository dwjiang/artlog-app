import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RETRY_ROW } from './queue-row';
import { QUEUE_EMPTY, QUEUE_FOOTER, QueueSheet, queueTitle } from './queue-sheet';
import type { PendingScan } from '@/db/schema';

const mockDismiss = jest.fn();
const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockRetry = jest.fn();
let mockItems: PendingScan[] = [];
let mockLoading = false;
let mockError: Error | undefined;

jest.mock('expo-router', () => ({ useRouter: () => ({ dismiss: mockDismiss, push: mockPush, navigate: mockNavigate }) }));
jest.mock('@/components/collection/gallery-button');
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('@/lib/queue/queue', () => ({ retryPendingScan: (localId: string) => mockRetry(localId) }));
jest.mock('@/lib/queue/use-queue', () => ({
  useQueue: () => ({ pending: mockItems.filter((row) => row.status !== 'failed').length, items: mockItems, loading: mockLoading, error: mockError }),
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
  mockLoading = false;
  mockError = undefined;
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
  await fireEvent.press(screen.getByRole('button', { name: 'Scan artwork' }));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/(scan)/scan');
  expect(mockPush).not.toHaveBeenCalled();
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

it('waits for the local query before showing an empty queue', async () => {
  mockItems = [];
  mockLoading = true;
  await render(<QueueSheet />);
  expect(screen.getByText('Loading scans…')).toBeOnTheScreen();
  expect(screen.queryByText(QUEUE_EMPTY)).toBeNull();
  expect(screen.queryByText('Nothing is waiting')).toBeNull();
});

it('explains a failed query instead of showing an empty queue', async () => {
  mockItems = [];
  mockError = new Error('Database unavailable');
  await render(<QueueSheet />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t load the scan queue\./);
  expect(screen.queryByText(QUEUE_EMPTY)).toBeNull();
});

it('blocks duplicate retries and preserves the photo when a retry fails', async () => {
  mockItems = [row('bad', 'failed', 1)];
  let reject!: (error: Error) => void;
  mockRetry.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await render(<QueueSheet />);
  await fireEvent.press(screen.getByRole('button', { name: RETRY_ROW }));
  const pending = screen.getByRole('button', { name: 'Retrying scan…' });
  expect(pending).toBeBusy();
  expect(pending).toBeDisabled();
  await fireEvent.press(pending);
  expect(mockRetry).toHaveBeenCalledTimes(1);
  await act(() => reject(new Error('Unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent(/Your photo is still here\./);
  expect(screen.getByRole('button', { name: RETRY_ROW })).toBeEnabled();
});
