import { fireEvent, render, screen } from '@testing-library/react-native';
import { getFunctionName as mockGetFunctionName } from 'convex/server';
import { ProfileScreen } from './profile-screen';
const mockPages = jest.fn();
let mockRelationship: { state: string; blocked: boolean } = { state: 'none', blocked: false };
const mockPerson = { profileId: 'friend' as never, username: 'friend', name: 'Jamie Chen', publishedWallCount: 0 };
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: jest.requireActual('react-native').View }));
jest.mock('../collection/wall-gallery', () => ({ WallGallery: () => null }));
jest.mock('./friendship-controls', () => ({ FriendshipControls: () => null }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ key: 'a', status: 'ready', profileId: 'owner', offline: false }) }));
jest.mock('@/lib/social/use-social-query', () => ({
  useSocialQuery: (query: Parameters<typeof mockGetFunctionName>[0]) => ({ data: mockGetFunctionName(query) === 'profiles:getPublic' ? mockPerson
    : mockGetFunctionName(query) === 'friendships:getState' ? mockRelationship : { color: '#45524B', items: [] } }),
  useCursorPages: (...args: unknown[]) => { mockPages(...args); return { items: [], done: true, loading: false }; },
}));
beforeEach(() => { jest.clearAllMocks(); mockRelationship = { state: 'none', blocked: false }; });
it('does not request private visits for strangers or a visitor preview', async () => {
  const view = await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Visits' }));
  expect(screen.getByText('Visits are shared with friends.')).toBeOnTheScreen();
  expect(mockPages.mock.calls.at(-1)[1]).toBe('skip');
  mockRelationship = { state: 'accepted', blocked: false };
  await view.rerender(<ProfileScreen profileId="friend" preview />);
  expect(mockPages.mock.calls.at(-1)[1]).toBe('skip');
});
it('requests only the selected friend’s shared visits and stops after a block', async () => {
  mockRelationship = { state: 'accepted', blocked: false };
  const view = await render(<ProfileScreen profileId="friend" />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Visits' }));
  expect(mockPages.mock.calls.at(-1)[1]).toEqual({ profileId: 'friend' });
  expect(screen.getByText('No shared visits yet.')).toBeOnTheScreen();
  mockRelationship = { state: 'accepted', blocked: true };
  await view.rerender(<ProfileScreen profileId="friend" />);
  expect(mockPages.mock.calls.at(-1)[1]).toBe('skip');
});
