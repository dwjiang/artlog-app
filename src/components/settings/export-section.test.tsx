import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { ExportSection } from './export-section';
import { insertSavedWork, softDeleteSavedWork } from '@/db/repos/saved-works';
import { setNote } from '@/db/repos/notes';

const mockWrite = jest.fn();
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((parent: string, name: string) => ({ uri: `${parent}/${name}`, name, write: mockWrite })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockWrite.mockReset();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
});

it('writes local collection metadata and shares a JSON file, including notes but excluding deleted works', async () => {
  await insertSavedWork({ localId: 'kept', title: 'Water Lilies', artist: 'Monet', savedAt: 1, photoPath: 'photos/private.jpg' });
  await setNote('kept', 'Reflections');
  await insertSavedWork({ localId: 'removed', title: 'Removed', artist: 'Monet', savedAt: 2 });
  await softDeleteSavedWork('removed');
  await render(<ExportSection />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  const data = JSON.parse(mockWrite.mock.calls[0][0]);
  expect(data.works).toEqual([expect.objectContaining({ title: 'Water Lilies', note: 'Reflections' })]);
  expect(mockWrite.mock.calls[0][0]).not.toContain('photos/');
  expect(File).toHaveBeenCalledWith('file:///cache', expect.stringMatching(/^artlog-export-.*\.json$/));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(screen.getByText('Export ready.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Share file' }));
  expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/artlog-export-.*\.json$/),
    expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }));
});

it('keeps export disabled while the share sheet is open and enables it after dismissal', async () => {
  let finish!: () => void;
  jest.mocked(Sharing.shareAsync).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<ExportSection />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Share file' }));
  expect(screen.getByRole('button', { name: 'Share file' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Share file' })).toBeEnabled();
});

it('shows a retryable error if the file cannot be written', async () => {
  mockWrite.mockImplementationOnce(() => { throw new Error('disk full'); });
  await render(<ExportSection />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  expect(screen.getByText(/Couldn't export your collection/)).toBeOnTheScreen();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Share file' }));
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});

it('does not write a file if sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await render(<ExportSection />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  expect(screen.getByText(/Couldn't export your collection/)).toBeOnTheScreen();
  expect(mockWrite).not.toHaveBeenCalled();
});

it('drops an export prepared for a previous account before it can be shared', async () => {
  await render(<ExportSection />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection as JSON' }));
  expect(screen.getByRole('button', { name: 'Share file' })).toBeOnTheScreen();
  await act(() => switchOwner('account:other', 'other'));
  expect(screen.queryByRole('button', { name: 'Share file' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Export collection as JSON' })).toBeOnTheScreen();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await act(() => switchOwner(anonymousOwner()));
});
