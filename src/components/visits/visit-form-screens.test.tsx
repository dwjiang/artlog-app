import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { insertSavedWork } from '@/db/repos/saved-works';
import { selectArtworkEncounters } from '@/db/repos/artwork-album';
import { getVisit, listVisits } from '@/db/repos/visits';
import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { pickerDate } from '@/lib/journal/visit-date';
import { VisitCreateScreen, VisitReflectionScreen } from './visit-form-screens';
const mockBack = jest.fn(), mockDismissTo = jest.fn();
let mockSavedId: string | undefined;
let mockVisitId = '00000000-0000-4000-8000-000000000001';
const mockVenue = { id: 'museum', name: 'Museum of Art', city: 'New York', lat: 40.78, lng: -73.96, country: 'US', region: 'new-york' };
const mockIsland = { id: 'island', name: 'Island Museum', lat: -19.05, lng: -169.92, region: 'country:NU' };
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/lib/venue/search-venues', () => ({ MUSEUM_SEARCH_LIMIT: 30, searchVenues: async () => [mockVenue, mockIsland] }));
jest.mock('@/lib/venue/venue-db', () => ({ venueMetadataForIds: async () => [mockVenue], onVenueMetadataChange: () => () => {} }));
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));
jest.mock('expo-router', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return { router: { back: () => mockBack(), dismissTo: (...args: unknown[]) => mockDismissTo(...args) }, useLocalSearchParams: () => ({ visitId: mockVisitId, savedId: mockSavedId }), Stack: {
    Toolbar: Object.assign(View, { Button: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) =>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}><Text>{children}</Text></Pressable> }),
  } };
});
beforeEach(() => { mockSavedId = undefined; mockBack.mockClear(); mockDismissTo.mockClear(); switchOwner(anonymousOwner(), 'scope-form'); });
afterEach(() => jest.restoreAllMocks());
async function fill() {
  await fireEvent.changeText(screen.getByLabelText('Search museums'), 'museum');
  await fireEvent.press(await screen.findByRole('button', { name: 'Museum of Art, New York, United States' }));
  await fireEvent.changeText(screen.getByLabelText('Visit date'), '2024-02-29T12:00:00');
}
it('creates repeat visits with fresh UUIDs, no artworks, a museum timezone, and a private reflection', async () => {
  const first = await render(<VisitCreateScreen />);
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await fill(); await fireEvent.changeText(screen.getByLabelText('Private reflection'), 'Private memory');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  const firstVisit = (await listVisits())[0]; mockVisitId = firstVisit.localId;
  expect(firstVisit).toMatchObject({ visitedOn: '2024-02-29', timeZone: 'America/New_York', reflection: 'Private memory' });
  await first.unmount();
  await render(<VisitCreateScreen />); await fill(); await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  const repeats = await listVisits();
  expect(repeats).toHaveLength(2); expect(new Set(repeats.map((row) => row.localId)).size).toBe(2);
});
it('rejects future dates and clears form drafts when the owner changes', async () => {
  await render(<VisitCreateScreen />); await fill();
  await fireEvent.changeText(screen.getByLabelText('Visit date'), '2099-01-01T12:00:00');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Private reflection'), 'Secret');
  await act(() => switchOwner('account:other', 'scope-other'));
  expect(screen.getByLabelText('Private reflection')).toHaveProp('value', '');
  expect(screen.getByLabelText('Search museums')).toBeOnTheScreen();
});
it('moves the default date back to the museum day when the device is already on the next day', async () => {
  // 10:00 UTC is the 16th everywhere east of UTC-10 but still the 15th on Niue (UTC-11).
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-16T10:00:00Z'));
  await render(<VisitCreateScreen />);
  await fireEvent.changeText(screen.getByLabelText('Search museums'), 'island');
  await fireEvent.press(await screen.findByRole('button', { name: 'Island Museum, Niue' }));
  expect(screen.getByLabelText('Visit date')).toHaveProp('value', pickerDate('2026-09-15').toISOString());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});
it('persists edited private reflections and restores them after reopening', async () => {
  const view = await render(<VisitReflectionScreen />);
  await waitFor(() => expect(screen.getByLabelText('Private reflection')).toHaveProp('value', 'Private memory'));
  await fireEvent.changeText(screen.getByLabelText('Private reflection'), 'Remember the light');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect((await getVisit(mockVisitId))?.reflection).toBe('Remember the light');
  await view.rerender(<View />); await view.rerender(<VisitReflectionScreen />);
  await waitFor(() => expect(screen.getByLabelText('Private reflection')).toHaveProp('value', 'Remember the light'));
});

it('creates a linked visit and returns to that artwork in its new visit context', async () => {
  mockSavedId = 'linked-work';
  await insertSavedWork({ localId: mockSavedId, title: 'Garden', artist: 'Artist', savedAt: 1 });
  await render(<VisitCreateScreen />); await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mockDismissTo).toHaveBeenCalled());
  const { params } = mockDismissTo.mock.calls[0][0];
  expect(params.savedId).toBe(mockSavedId);
  expect(await getVisit(params.visitId)).toMatchObject({ venueName: 'Museum of Art' });
  expect(selectArtworkEncounters().all()).toContainEqual(expect.objectContaining({ savedLocalId: mockSavedId, visitLocalId: params.visitId, deletedAt: null }));
  expect(mockBack).not.toHaveBeenCalled();
});
it('cancels a pending linked visit without creating a visit or encounter', async () => {
  mockSavedId = 'cancel-work';
  await insertSavedWork({ localId: mockSavedId, title: 'Garden', artist: 'Artist', savedAt: 1 });
  const before = (await listVisits()).length;
  await render(<VisitCreateScreen />); await fill();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(await listVisits()).toHaveLength(before);
  expect(selectArtworkEncounters().all().some((entry) => entry.savedLocalId === mockSavedId)).toBe(false);
});
