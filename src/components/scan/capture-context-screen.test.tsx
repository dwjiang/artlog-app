import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { CaptureContextScreen } from './capture-context-screen';
import { Gallery } from '@/constants/theme';
import type { PhotoSessionDraft } from '@/lib/capture/photo-draft';

const mockBack = jest.fn();
const mockUpdateSession = jest.fn();
let mockParams: { draftId?: string; visitId?: string } = {};
let mockSession: PhotoSessionDraft = { photos: [] };
let mockOpenVisit: { localId: string } | undefined;
let mockQuery = { data: [] as { localId: string; owner: string; venueName: string; visitedOn: string }[], updatedAt: undefined as Date | undefined, error: undefined as Error | undefined };

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, Stack: { Screen: () => null }, router: { back: () => mockBack(), push: jest.fn() } }));
jest.mock('drizzle-orm/expo-sqlite', () => ({ useLiveQuery: () => mockQuery }));
jest.mock('@/db/repos/visits', () => ({ listVisits: jest.fn() }));
jest.mock('@/lib/account/owner-store', () => ({ useLocalOwner: () => 'owner' }));
jest.mock('@/lib/venue/use-venue', () => ({ useVenue: () => ({ visit: mockOpenVisit }) }));
jest.mock('@/lib/capture/photo-draft', () => ({ readPhotoSession: () => mockSession, updatePhotoSession: (...args: unknown[]) => mockUpdateSession(...args) }));
jest.mock('@/components/collection/gallery-button');

const museum = { localId: 'captured-visit', owner: 'owner', venueName: 'Museum', visitedOn: '2024-02-29' };
const other = { localId: 'other-visit', owner: 'owner', venueName: 'Other museum', visitedOn: '2024-03-01' };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { draftId: 'capture.jpg' };
  mockSession = { photos: [] };
  mockOpenVisit = undefined;
  mockQuery = { data: [], updatedAt: undefined, error: undefined };
});

it('marks the capture’s own visit until the draft overrides it', async () => {
  mockParams = { draftId: 'capture.jpg', visitId: 'captured-visit' };
  mockQuery = { data: [museum, other], updatedAt: new Date(), error: undefined };
  const view = await render(<CaptureContextScreen />);
  expect(screen.getByRole('button', { name: 'Museum · 29 Feb 2024', selected: true })).toBeOnTheScreen();
  mockSession = { photos: [], visitLocalId: null };
  mockParams = { draftId: 'other.jpg', visitId: 'captured-visit' };
  await view.rerender(<CaptureContextScreen />);
  expect(screen.getByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
});

it('writes the choice to the draft only and closes', async () => {
  mockQuery = { data: [museum, other], updatedAt: new Date(), error: undefined };
  await render(<CaptureContextScreen />);
  expect(screen.getByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Other museum · 1 Mar 2024' }));
  expect(mockUpdateSession).toHaveBeenCalledWith('owner', 'capture.jpg', { visitLocalId: 'other-visit' });
  expect(mockBack).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'No visit · Save artwork only' }));
  expect(mockUpdateSession).toHaveBeenLastCalledWith('owner', 'capture.jpg', { visitLocalId: null });
});

it.each([
  ['No visit · Save artwork only', undefined],
  ['Museum · 29 Feb 2024', 'captured-visit'],
])('draws an even border around the selected "%s" option', async (name, visitId) => {
  mockParams = { draftId: 'capture.jpg', visitId };
  mockQuery = { data: [museum, other], updatedAt: new Date(), error: undefined };
  await render(<CaptureContextScreen />);
  const style = StyleSheet.flatten(screen.getByRole('button', { name, selected: true }).props.style);
  for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
    expect(style[`border${edge}Width`] ?? style.borderWidth).toBe(1);
    expect(style[`border${edge}Color`] ?? style.borderColor).toBe(Gallery.ink);
  }
  expect(screen.getByRole('button', { name: 'Other museum · 1 Mar 2024' }))
    .toHaveStyle({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator });
});

it('names the open visit as the one happening now', async () => {
  mockOpenVisit = { localId: 'captured-visit' };
  mockQuery = { data: [museum], updatedAt: new Date(), error: undefined };
  await render(<CaptureContextScreen />);
  expect(screen.getByRole('button', { name: 'Museum · Visiting now' })).toBeOnTheScreen();
});

it('distinguishes loading visits from an empty collection', async () => {
  const view = await render(<CaptureContextScreen />);
  expect(screen.getByLabelText('Loading visits…')).toBeOnTheScreen();
  expect(screen.queryByText('Keep the day, too.')).toBeNull();
  mockQuery = { ...mockQuery, updatedAt: new Date() };
  await view.rerender(<CaptureContextScreen />);
  expect(screen.getByText('Keep the day, too.')).toBeOnTheScreen();
});

it('preserves the current choice when saving the new choice fails', async () => {
  mockQuery = { data: [museum], updatedAt: new Date(), error: undefined };
  mockUpdateSession.mockImplementationOnce(() => { throw new Error('Write failed'); });
  await render(<CaptureContextScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Museum · 29 Feb 2024' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Your previous selection is unchanged\./);
  expect(screen.getByRole('button', { name: 'No visit · Save artwork only', selected: true })).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
});

it('shows a query failure without claiming there are no visits, and still offers a new visit', async () => {
  mockQuery.error = new Error('Read failed');
  await render(<CaptureContextScreen />);
  expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t load your visits\./);
  expect(screen.queryByText('Keep the day, too.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create a visit' })).toBeOnTheScreen();
});
