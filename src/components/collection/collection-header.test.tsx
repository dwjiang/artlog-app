import { fireEvent, render, screen } from '@testing-library/react-native';
import { anonymousOwner, switchOwner } from '@/lib/account/owner-store';
import { CollectionHeader } from './collection-header';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ status: 'signed-out', key: 'guest' }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({ data: undefined }) }));

beforeEach(() => { jest.clearAllMocks(); switchOwner(anonymousOwner()); });

it('does not report zero artworks before collection counts load', async () => {
  const view = await render(<CollectionHeader loading />);
  expect(screen.getByRole('progressbar', { name: 'Loading collection counts' })).toBeOnTheScreen();
  expect(screen.queryByText('0 artworks · 0 visits')).toBeNull();
  expect(screen.getByRole('button', { name: 'Settings' })).toBeOnTheScreen();
  await view.rerender(<CollectionHeader artworkCount={3} visitCount={1} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('3 artworks · 1 visit')).toBeOnTheScreen();
});

it('identifies the local collection without making its title a sign-in action', async () => {
  await render(<CollectionHeader />);
  expect(screen.getByText('Your collection')).toBeOnTheScreen();
  expect(screen.getByText('Saved on this iPhone')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Edit your profile' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  expect(mockPush).toHaveBeenCalledWith('/settings');
});

it('asks for sign-in only when the guest chooses to share a wall', async () => {
  await render(<CollectionHeader />);
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Share your wall' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'wall' } });
});
