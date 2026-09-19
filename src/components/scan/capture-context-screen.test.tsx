import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CaptureContextScreen } from './capture-context-screen';
import type { PhotoSessionDraft } from '@/lib/capture/photo-draft';

const mockBack = jest.fn();
const mockSetVisit = jest.fn();
const mockGetSetting = jest.fn();
let mockParams: { draftId?: string; visitId?: string } = {};
let mockSession: PhotoSessionDraft = { photos: [] };
let mockQuery = { data: [] as { localId: string; owner: string; venueName: string; visitedOn: string }[], updatedAt: undefined as Date | undefined, error: undefined as Error | undefined };

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, Stack: { Screen: () => null }, router: { back: () => mockBack(), push: jest.fn() } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: () => mockQuery }));
jest.mock('@/db/repos/visits', () => ({ listVisits: jest.fn() }));
jest.mock('@/db/repos/settings', () => ({ getSetting: () => mockGetSetting() }));
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'owner', captureOwner: () => ({ isOwnerCurrent: () => true }) }));
jest.mock('@/lib/capture/photo-draft', () => ({ readPhotoSession: () => mockSession, updatePhotoSession: jest.fn() }));
jest.mock('@/lib/capture/visit-context', () => ({ captureVisitKey: () => 'captureVisit:owner', setCaptureVisit: (...args: unknown[]) => mockSetVisit(...args) }));
jest.mock('@/components/collection/gallery-button');

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession = { photos: [] };
  mockGetSetting.mockResolvedValue('none');
  mockSetVisit.mockResolvedValue(undefined);
  mockQuery = { data: [], updatedAt: undefined, error: undefined };
});

it('marks a fresh result’s captured visit before an Add photos session exists', async () => {
  mockParams = { draftId: 'capture.jpg', visitId: 'captured-visit' };
  mockQuery = { data: [{ localId: 'captured-visit', owner: 'owner', venueName: 'Museum', visitedOn: '2024-02-29' }], updatedAt: new Date(), error: undefined };
  await render(<CaptureContextScreen />);
  expect(await screen.findByRole('button', { name: /Museum/, selected: true })).toBeOnTheScreen();
});

it('marks no visit for an unassigned fresh result and honors an explicit draft override', async () => {
  mockParams = { draftId: 'capture.jpg' };
  const view = await render(<CaptureContextScreen />);
  expect(await screen.findByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
  mockParams = { draftId: 'different-capture.jpg', visitId: 'captured-visit' };
  mockSession = { photos: [], visitLocalId: null };
  await view.rerender(<CaptureContextScreen />);
  expect(await screen.findByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
});

it('distinguishes loading visits from an empty collection', async () => {
  const view = await render(<CaptureContextScreen />);
  expect(screen.getByLabelText('Loading visits…')).toBeOnTheScreen();
  expect(screen.queryByText('No visits yet. Create a visit, or save this artwork without one.')).toBeNull();
  mockQuery = { ...mockQuery, updatedAt: new Date() };
  await view.rerender(<CaptureContextScreen />);
  expect(screen.getByText('No visits yet. Create a visit, or save this artwork without one.')).toBeOnTheScreen();
});

it('marks the current choice and prevents duplicate selection while saving', async () => {
  let finish!: () => void;
  mockSetVisit.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  await render(<CaptureContextScreen />);
  expect(await screen.findByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Current museum visit' }));
  expect(screen.getByRole('button', { name: 'Current museum visit' })).toBeBusy();
  await fireEvent.press(screen.getByRole('button', { name: 'No visit · Save artwork only' }));
  expect(mockSetVisit).toHaveBeenCalledTimes(1);
  await act(() => finish());
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('preserves the current choice when saving the new choice fails', async () => {
  mockSetVisit.mockRejectedValueOnce(new Error('Write failed'));
  await render(<CaptureContextScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Current museum visit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Your previous selection is unchanged\./);
  expect(screen.getByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
});

it('shows a query failure without claiming there are no visits', async () => {
  mockQuery.error = new Error('Read failed');
  await render(<CaptureContextScreen />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t load your visits\./);
  expect(screen.queryByText('No visits yet. Create a visit, or save this artwork without one.')).toBeNull();
});
