import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { SocialSession } from '@/lib/social/use-social-session';
import type { SharedVisit } from '@/lib/social/types';
import { HomeScreen } from './home-screen';
import { PeopleScreen } from './people-screen';
import { VisitScreen } from './visit-screen';
import { ArtworkScreen } from './artwork-screen';
import { VisitArtworks } from './visit-card';

const mockPush = jest.fn(), mockRefresh = jest.fn(), mockLoadMore = jest.fn(), mockPages = jest.fn(), mockQuery = jest.fn();
let mockSession: SocialSession;
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => mockSession }));
jest.mock('@/lib/social/use-social-query', () => ({ useCursorPages: (...args: unknown[]) => mockPages(...args),
  useSocialQuery: (...args: unknown[]) => mockQuery(...args) }));
jest.mock('../account/welcome-prompt', () => ({ WelcomePrompt: () => null }));
jest.mock('@/db/repos/settings', () => ({ getSetting: jest.fn(async () => undefined), setSetting: jest.fn(async () => {}) }));
jest.mock('@/components/settings/account-section', () => ({ AccountSection: () => {
  const { Text } = jest.requireActual('react-native'); return <Text>Apple sign-in</Text>;
} }));
jest.mock('expo-image', () => ({ Image: (props: object) => {
  const { View } = jest.requireActual('react-native'); return <View accessibilityRole="image" {...props} />;
} }));
jest.mock('expo-router', () => {
  const { Pressable, Text, TextInput } = jest.requireActual('react-native');
  const Toolbar = ({ children }: { children: React.ReactNode }) => children;
  Toolbar.View = ({ children }: { children: React.ReactNode }) => children;
  Toolbar.Button = function ToolbarButton({ children, onPress, accessibilityLabel }: { children: string; onPress: () => void; accessibilityLabel: string }) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}><Text>{children}</Text></Pressable>; };
  return { useLocalSearchParams: () => ({}), useRouter: () => ({ push: mockPush }), Stack: { Toolbar,
    SearchBar: ({ onChangeText }: { onChangeText: (event: { nativeEvent: { text: string } }) => void }) =>
      <TextInput accessibilityLabel="Name or username" onChangeText={(text: string) => onChangeText({ nativeEvent: { text } })} /> } };
});

const visit: SharedVisit = { audience: 'friends',
  postId: 'post-a', author: { profileId: 'alex' as never, name: 'Alex Chen', username: 'alex', publishedWallCount: 0 },
  venue: { venueId: 'museum' as never, name: 'Museum of Modern Art' }, visitedOn: '2026-09-12',
  reflection: 'I kept coming back to the blue.', publishedAt: 1, revision: 1,
  artworks: { page: [{ itemId: 'art-a' as never, artwork: { title: 'Blue afternoon', artist: 'A. Artist',
    media: { kind: 'catalog', width: 200, height: 400, url: 'https://museum.example/art.jpg',
      sourceUrl: 'https://museum.example/art', rights: 'public_domain' } } }], cursor: 'more', isDone: false },
};
const pages = (patch: object = {}) => ({ items: [], first: undefined, loading: false, refreshing: false, done: true, error: undefined,
  canLoadMore: false, loadMore: mockLoadMore, refresh: mockRefresh, ...patch });
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { key: 'account-a', token: 'private-token', profileId: 'viewer' as never, status: 'ready',
    offline: false, accountReady: true, error: undefined, refresh: mockRefresh };
  mockPages.mockReturnValue(pages());
  mockQuery.mockReturnValue({ data: undefined, refresh: mockRefresh });
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = 'https://test.convex.site';
});

it('opens visits, authors, and people from Home', async () => {
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await render(<HomeScreen />);
  expect(screen.queryByText('Newest visit first')).toBeNull();
  expect(screen.getByText('1+ artworks')).toBeOnTheScreen();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View visit' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  await fireEvent.press(screen.getByRole('button', { name: 'View Alex Chen’s visit to Museum of Modern Art' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  expect(screen.getByLabelText('September 12, 2026')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View Alex Chen’s profile' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/profile/[profileId]', params: { profileId: 'alex' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Find people' }));
  expect(mockPush).toHaveBeenLastCalledWith('/people');
  await fireEvent.press(screen.getByRole('button', { name: 'Friends' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/people', params: { filter: 'friends' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Leaderboards' }));
  expect(mockPush).toHaveBeenLastCalledWith('/leaderboards');
  expect(screen.queryByRole('button', { name: 'Your profile and settings' })).toBeNull();
});

it.each([
  ['profile-required', 'Make yourself at home.'],
  ['offline', 'You’re offline.'], ['loading', 'Getting things ready…'],
] as const)('gates private Home content while %s', async (status, expected) => {
  mockSession = { ...mockSession, status };
  mockPages.mockReturnValue(pages({ items: [visit] }));
  await render(<HomeScreen />);
  expect(screen.getByText(expected)).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
  expect(mockPages.mock.calls[0][1]).toBe('skip');
});

it('waits for finished pagination before showing empty or caught-up copy and offers retry', async () => {
  mockPages.mockReturnValue(pages({ done: false, canLoadMore: true }));
  const view = await render(<HomeScreen />);
  expect(screen.queryByText('You’re all caught up.')).toBeNull();
  expect(screen.queryByText('A new view is on its way.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'More visits' }));
  expect(mockLoadMore).toHaveBeenCalled();
  mockPages.mockReturnValue(pages({ items: [visit], done: true }));
  await view.rerender(<HomeScreen />);
  expect(screen.getByText('You’re all caught up.')).toBeOnTheScreen();
  mockPages.mockReturnValue(pages({ done: false, error: new Error('offline') }));
  await view.rerender(<HomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(mockRefresh).toHaveBeenCalled();
});

it('debounces native header search for 300 ms and skips invalid searches', async () => {
  jest.useFakeTimers();
  await render(<PeopleScreen />);
  await fireEvent.changeText(screen.getByLabelText('Name or username'), 'alex');
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === 'profiles:search').at(-1)[1]).toBe('skip');
  await act(() => jest.advanceTimersByTime(299));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === 'profiles:search').at(-1)[1]).toBe('skip');
  await act(() => jest.advanceTimersByTime(1));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === 'profiles:search').at(-1)[1]).toEqual({ query: 'alex' });
  await fireEvent.changeText(screen.getByLabelText('Name or username'), 'a'.repeat(101));
  await act(() => jest.advanceTimersByTime(300));
  expect(mockPages.mock.calls.filter((call) => getFunctionName(call[0]) === 'profiles:search').at(-1)[1]).toBe('skip');
  jest.useRealTimers();
});

it('opens read-only artwork details from a visit and handles revoked posts', async () => {
  mockPages.mockReturnValue(pages({ items: visit.artworks.page, first: visit }));
  const view = await render(<VisitScreen postId={visit.postId} />);
  await fireEvent.press(screen.getByRole('button', { name: 'View Blue afternoon' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/artwork', params: { kind: 'visit', postId: 'post-a', itemId: 'art-a' } });
  mockPages.mockReturnValue(pages({ error: new ConvexError({ code: 'not_found' }), done: false }));
  await view.rerender(<VisitScreen postId={visit.postId} />);
  expect(screen.getByText('Visit unavailable.')).toBeOnTheScreen();
  expect(screen.queryByText(visit.reflection)).toBeNull();
});

it('shows only the public wall note and never a visit’s private note', async () => {
  mockQuery.mockImplementation((query) => ({ data: getFunctionName(query) === 'walls:getArtwork'
    ? { ...visit.artworks.page[0], layout: { x: 0.1, y: 0.1, width: 0.3, layer: 0, frame: 'gilt' }, note: 'Selected public note' }
    : { ...visit.artworks.page[0], note: 'Private note' }, refresh: mockRefresh }));
  const view = await render(<ArtworkScreen kind="wall" itemId="wall-item" />);
  expect(screen.getByText('Selected public note')).toBeOnTheScreen();
  await view.rerender(<ArtworkScreen kind="visit" itemId="visit-item" postId="post-a" />);
  expect(screen.queryByText('Selected public note')).toBeNull();
  expect(screen.queryByText('Private note')).toBeNull();
});

it.each([false, true])('keeps artwork proportions, credentials, and the unavailable-image fallback (compact: %s)', async (compact) => {
  const item = { ...visit.artworks.page[0], artwork: { ...visit.artworks.page[0].artwork,
    media: { kind: 'derivative' as const, rights: 'contributor_consent' as const, width: 128, height: 256,
      reference: { kind: 'sharedVisit' as const, postId: 'post-a', itemId: 'art-a' as never } } } };
  await render(<VisitArtworks artworks={[item]} token="private-token" compact={compact} />);
  await fireEvent(screen.getByTestId('visit-artworks'), 'layout', { nativeEvent: { layout: { width: 390 } } });
  const image = screen.getByRole('image', { name: 'Blue afternoon' });
  expect(image.props.style.height / image.props.style.width).toBe(2);
  expect(image.props.contentFit).toBe('contain');
  expect(image.props.cachePolicy).toBe('none');
  expect(image.props.source.headers).toEqual({ Authorization: 'Bearer private-token' });
  await fireEvent(image, 'error');
  expect(screen.getByRole('image', { name: 'Blue afternoon: image unavailable' })).toBeOnTheScreen();
});


it('shows fewer previews rather than letting landscape photos overflow the card', async () => {
  const landscape = (itemId: string) => ({ ...visit.artworks.page[0], itemId: itemId as never, artwork: { ...visit.artworks.page[0].artwork, title: itemId,
    media: { kind: 'derivative' as const, rights: 'contributor_consent' as const, width: 400, height: 300,
      reference: { kind: 'sharedVisit' as const, postId: 'post-a', itemId: itemId as never } } } });
  await render(<VisitArtworks artworks={['one', 'two', 'three'].map(landscape)} compact />);
  await fireEvent(screen.getByTestId('visit-artworks'), 'layout', { nativeEvent: { layout: { width: 350 } } });
  expect(screen.getByRole('image', { name: 'one' })).toBeOnTheScreen();
  expect(screen.getByRole('image', { name: 'two' })).toBeOnTheScreen();
  expect(screen.queryByRole('image', { name: 'three' })).toBeNull();
  const image = screen.getByRole('image', { name: 'one' });
  expect(image.props.style.width * 2 + 8).toBeLessThanOrEqual(350);
  expect(image.props.style.height).toBeGreaterThanOrEqual(100);
});

it('loads public visits for guests and opens their details without signing in', async () => {
  mockSession = { ...mockSession, status: 'signed-out', token: null };
  mockPages.mockReturnValue(pages({ items: [{ ...visit, audience: 'public' }] }));
  await render(<HomeScreen />);
  expect(getFunctionName(mockPages.mock.calls[0][0])).toBe('sharedVisits:listPublic');
  expect(mockPages.mock.calls[0][1]).toEqual({});
  expect(screen.getByText('Public visits')).toBeOnTheScreen();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View visit' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
});

it('offers public walls while the public visit feed is empty', async () => {
  mockSession = { ...mockSession, status: 'signed-out' };
  await render(<HomeScreen />);
  expect(screen.getByText('No public visits yet.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Browse public walls' }));
  expect(mockPush).toHaveBeenCalledWith('/people');
});

it('shows the artwork count and omits an empty art stage for a reflection-only visit', async () => {
  mockPages.mockReturnValue(pages({ items: [{ ...visit, artworkCount: 6 }] }));
  const view = await render(<HomeScreen />);
  expect(screen.queryByText('+5 more')).toBeNull();
  expect(screen.getByText('6 artworks')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'View visit' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/visit/[postId]', params: { postId: visit.postId } });
  mockPages.mockReturnValue(pages({ items: [{ ...visit, artworkCount: 0, artworks: { page: [], cursor: null, isDone: true } }] }));
  await view.rerender(<HomeScreen />);
  expect(screen.queryByTestId('visit-artworks')).toBeNull();
  expect(screen.getByText(visit.reflection)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'View visit' })).toBeOnTheScreen();
});

it.each(['wall', 'visit'])('renders sourced artwork stories in %s details', async (kind) => {
  mockQuery.mockReturnValue({ data: { ...visit.artworks.page[0], layout: { frame: 'gilt' }, enrichment: {
    docent: [{ sentence: 'Painted beside the garden.', factIds: ['museum'] }],
    factSheet: [{ id: 'museum', sourceUrl: 'https://museum.example/work', sourceLabel: 'Museum source' }],
  } }, refresh: mockRefresh });
  await render(<ArtworkScreen kind={kind} itemId="art-a" postId="post-a" />);
  expect(screen.getByText('About this work')).toBeOnTheScreen();
  expect(screen.getByText('Painted beside the garden.')).toBeOnTheScreen();
  expect(screen.getByText('Museum source')).toBeOnTheScreen();
});
