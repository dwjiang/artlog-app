import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CollectionArtworks } from './collection-artworks';

jest.mock('expo-router', () => ({ useFocusEffect: () => {}, router: { push: jest.fn() } }));
jest.mock('@/lib/wall/use-collection-wall', () => ({ useCollectionWall: () => ({ signedIn: false }) }));

it('keeps the collection shell while loading and distinguishes a loaded empty collection', async () => {
  const view = await render(<CollectionArtworks works={[]} loading error={undefined} search="" header={<Text>Your collection</Text>} />);
  expect(screen.getByText('Your collection')).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'Opening collection…' })).toBeOnTheScreen();
  expect(screen.queryByText('0 ARTWORKS · BY ARTIST')).toBeNull();
  expect(screen.queryByText('Your collection begins here.')).toBeNull();
  await view.rerender(<CollectionArtworks works={[]} loading={false} error={undefined} search="" />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Your collection begins here.')).toBeOnTheScreen();
});

it('replaces ghosts with retry even when a failed query still reports loading', async () => {
  const retry = jest.fn();
  await render(<CollectionArtworks works={[]} loading error={new Error('Read failed')} search="" onRetry={retry} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Couldn’t load your collection.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
