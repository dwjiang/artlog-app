import { render, screen } from '@testing-library/react-native';
import { getFunctionName } from 'convex/server';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { VisitTimeline } from './visit-timeline';
const mockQuery = jest.fn();
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ status: 'ready', key: 'a' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: (...args: unknown[]) => mockQuery(...args) }));
beforeEach(() => { mockQuery.mockReset().mockReturnValue({}); });
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children }));
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: () => null }));
const visit = (localId: string, extra: Partial<VisitSummary>): VisitSummary => ({ localId, venueId: localId, venueName: 'Museum',
  visitedOn: '2024-02-29', location: '', works: [], ...extra } as VisitSummary);
it('names the country of museums that only carry a country region and pluralises artwork counts', async () => {
  const work = { localId: 'w', title: 'Water Lilies', artist: 'Claude Monet', cropPath: null } as VisitSummary['works'][number];
  await render(<VisitTimeline visits={[visit('fr', { country: 'FR', works: [work] }), visit('none', {})]} />);
  expect(screen.getByText('France · 1 artwork')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Museum, 29 Feb 2024, 1 artwork' })).toBeOnTheScreen();
  expect(screen.getByText('Location unavailable · 0 artworks')).toBeOnTheScreen();
});
it('marks shared visits from one owner-scoped query rather than one per row', async () => {
  mockQuery.mockReturnValue({ data: ['shared'] });
  await render(<VisitTimeline visits={[visit('shared', {}), visit('private', { venueName: 'Quiet Museum' })]} />);
  expect(screen.getByText('Location unavailable · 0 artworks · Shared ✓')).toBeOnTheScreen();
  expect(screen.getAllByText('Location unavailable · 0 artworks')).toHaveLength(1);
  expect(new Set(mockQuery.mock.calls.map((call) => getFunctionName(call[0])))).toEqual(new Set(['sharedVisits:listShared']));
});
