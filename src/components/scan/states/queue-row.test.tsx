import { fireEvent, render, screen } from '@testing-library/react-native';

import { QueueRow, RETRY_ROW, queueStatusText } from './queue-row';
import type { PendingScan } from '@/db/schema';

jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));

jest.mock('@/lib/capture/photo-draft', () => ({ readPhotoSession: () => ({ photos: [] }) }));

const now = new Date(2026, 8, 11, 12, 0, 0).getTime();
const row: PendingScan = {
  owner: 'device:test-installation', localId: 'cap-1', photoPath: 'photos/cap-1.jpg', cropPath: 'crops/cap-1.jpg', vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
  modelVersion: 'm', venueId: null, visitId: null, visitLocalId: null, capturedAt: now - 5 * 60_000, labelPhotoPath: null, qrUrl: null,
  status: 'queued', attemptModelVersion: 'm', attempts: 0, lastError: null, scanId: null, createdAt: now,
};
const handlers = { onOpen: jest.fn(), onRetry: jest.fn(), onDiscard: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it.each([
  ['queued', 'Waiting for signal'],
  ['identifying', 'Identifying…'],
  ['failed', 'Couldn’t identify'],
  ['identified', 'Ready to save'],
] as const)('describes a %s row', async (status, text) => {
  expect(queueStatusText(status)).toBe(text);
  await render(<QueueRow item={{ ...row, status }} now={now} {...handlers} />);
  expect(screen.getByText(text)).toBeOnTheScreen();
  expect(screen.getByText('5 min ago · 1 photo')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Label attached')).toBeNull();
});

it('opens the card from the row and shows the crop', async () => {
  await render(<QueueRow item={row} now={now} {...handlers} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Scan from 5 min ago, Waiting for signal' }));
  expect(handlers.onOpen).toHaveBeenCalledWith(row);
  expect(handlers.onRetry).not.toHaveBeenCalled();
});

it('opens a failed row and retries only from its menu action', async () => {
  const failed = { ...row, status: 'failed' as const, lastError: 'bad_features' };
  await render(<QueueRow item={failed} now={now} {...handlers} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Scan from 5 min ago, Couldn’t identify' }));
  expect(handlers.onOpen).toHaveBeenCalledWith(failed);
  expect(handlers.onRetry).not.toHaveBeenCalled();
  handlers.onOpen.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: RETRY_ROW }));
  expect(handlers.onRetry).toHaveBeenCalledWith(failed);
  expect(handlers.onOpen).not.toHaveBeenCalled();
});

it.each([
  ['a label photo', { labelPhotoPath: 'labels/cap-1.jpg' }],
  ['a decoded QR code', { qrUrl: 'https://museum.example/object/1' }],
])('marks a row that carries %s', async (_what, label) => {
  await render(<QueueRow item={{ ...row, ...label }} now={now} {...handlers} />);
  expect(screen.getByLabelText('Label attached')).toBeOnTheScreen();
});
