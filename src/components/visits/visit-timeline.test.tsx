import { render, screen } from '@testing-library/react-native';
import type { VisitSummary } from '@/lib/journal/visit-summaries';
import { VisitTimeline } from './visit-timeline';
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
