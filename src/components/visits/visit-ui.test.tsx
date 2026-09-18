import { render, screen } from '@testing-library/react-native';
import type { SavedWork } from '@/db/schema';
import { ArtworkPreviews } from './visit-ui';
jest.mock('../collection/saved-work-image', () => ({ SavedWorkImage: ({ title, syncing }: { title: string; syncing?: boolean }) => {
  const { View } = jest.requireActual('react-native'); return <View accessible accessibilityRole="image" accessibilityLabel={title} accessibilityState={{ busy: !!syncing }} />;
} }));
it('shows each artwork once across repeat visits before applying the preview limit', async () => {
  const work = { owner: 'me', localId: 'garden', title: 'Garden' } as SavedWork;
  await render(<ArtworkPreviews works={[work, work, { ...work, localId: 'river', title: 'River' }]} limit={2} />);
  expect(screen.getAllByRole('image', { name: 'Garden' })).toHaveLength(1);
  expect(screen.getByRole('image', { name: 'River' })).toBeOnTheScreen();
});

it('reports a crop the account holds but this phone has not downloaded as syncing', async () => {
  const work = { owner: 'me', localId: 'garden', title: 'Garden', cropPath: null } as SavedWork;
  await render(<ArtworkPreviews works={[{ ...work, cropStorageId: 'cloud-crop' as SavedWork['cropStorageId'] }, { ...work, localId: 'river', title: 'River' }]} />);
  expect(screen.getByRole('image', { name: 'Garden' })).toBeBusy();
  expect(screen.getByRole('image', { name: 'River' })).not.toBeBusy();
});
