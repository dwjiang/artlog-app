import { render, screen } from '@testing-library/react-native';
import type { SavedWork } from '@/db/schema';
import { ArtworkPreviews } from './visit-ui';
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title }: { title: string }) => {
  const { View } = jest.requireActual('react-native'); return <View accessible accessibilityRole="image" accessibilityLabel={title} />;
} }));
it('shows each artwork once across repeat visits before applying the preview limit', async () => {
  const work = { owner: 'me', localId: 'garden', title: 'Garden' } as SavedWork;
  await render(<ArtworkPreviews works={[work, work, { ...work, localId: 'river', title: 'River' }]} limit={2} />);
  expect(screen.getAllByRole('image', { name: 'Garden' })).toHaveLength(1);
  expect(screen.getByRole('image', { name: 'River' })).toBeOnTheScreen();
});
