import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { CollectionVisits } from './collection-visits';
let mockMode: 'list' | 'globe' | undefined = 'list';
jest.mock('@expo/ui', () => jest.requireActual('../../../__mocks__/@expo/ui'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Link: ({ children }: { children: unknown }) => children }));
jest.mock('./visit-globe', () => ({ VisitGlobe: () => { const { Text } = jest.requireActual('react-native'); return <Text>Globe canvas</Text>; } }));
jest.mock('@/lib/journal/use-visit-view', () => ({ useVisitView: () => ({ mode: mockMode, changeMode: jest.fn() }) }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
const visit = { localId: 'v', venueId: 'm', venueName: 'Museum', visitedOn: '2024-02-29', location: 'Paris', works: [] } as unknown as VisitSummary;
const props = { owner: 'a', visits: [visit], header: <View />, loading: false, clearSearch: jest.fn(), onSearchChange: jest.fn() };
beforeEach(() => { mockMode = 'list'; });
it('keeps the search field mounted through too-short, unmatched and matched queries', async () => {
  const view = await render(<CollectionVisits {...props} search="" />);
  const field = screen.getByLabelText('Search your visits');
  for (const search of ['m', 'zzz', 'mu']) {
    await view.rerender(<CollectionVisits {...props} search={search} />);
    expect(screen.getByLabelText('Search your visits')).toBe(field);
  }
  expect(screen.getByText('Museum')).toBeOnTheScreen();
});
it('shows loading instead of the globe until the view preference is read', async () => {
  mockMode = undefined;
  await render(<CollectionVisits {...props} search="" />);
  expect(screen.getByText('Loading your visits…')).toBeOnTheScreen();
  expect(screen.queryByText('Globe canvas')).toBeNull();
  expect(screen.getByRole('button', { name: 'Globe' })).toBeDisabled();
});
