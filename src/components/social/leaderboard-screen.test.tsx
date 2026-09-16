import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { Id } from '../../../convex/_generated/dataModel';
import type { SocialSession } from '@/lib/social/use-social-session';
import { LeaderboardScreen } from './leaderboard-screen';

const mockPush = jest.fn(), mockChange = jest.fn(), mockRefresh = jest.fn(), mockQuery = jest.fn();
const mockSession = { status: 'signed-out' as SocialSession['status'], key: 'guest', profileId: undefined as Id<'profiles'> | undefined };
let mockVisibility = 'off';
let mockRows = [{ profile: { profileId: 'global-person', name: 'Ada', username: 'ada', publishedWallCount: 2 }, rank: 1, score: 4 }];
const mockSettings = new Map<string, string>();

jest.mock('@expo/ui');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/ui/swift-ui', () => {
  const React = jest.requireActual('react'), { Pressable, Text, View } = jest.requireActual('react-native');
  return { ...jest.requireMock('@expo/ui'),
    Menu: ({ label, children }: { label: ReactNode; children: ReactNode }) => <View>{label}{children}</View>,
    Picker: ({ children, onSelectionChange }: { children: ReactNode; onSelectionChange: (value: string) => void }) => <View>{React.Children.map(children, (child: { props: { children: string; modifiers: { $type: string; tag?: string }[] } }) =>
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${child.props.children}`} onPress={() => onSelectionChange(child.props.modifiers.find((modifier) => modifier.$type === 'tag')?.tag ?? '')}><Text>{child.props.children}</Text></Pressable>)}</View>,
  };
});
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) },
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: () => null, Toolbar: Object.assign(() => null, { Button: () => null }) },
}));
jest.mock('@/db/repos/settings', () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => { mockSettings.set(key, value); },
}));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => mockSession }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: (query: unknown, args: unknown) => {
  const name = jest.requireActual('convex/server').getFunctionName(query);
  mockQuery(name, args);
  return { data: args === 'skip' ? undefined : name === 'leaderboards:preference' ? mockVisibility : { visibility: mockVisibility, rows: mockRows }, loading: false, refresh: mockRefresh };
} }));
jest.mock('convex/react', () => ({ useMutation: () => mockChange }));
jest.mock('../settings/account-section', () => ({ AccountSection: () => null }));

beforeEach(() => {
  jest.clearAllMocks(); mockSettings.clear(); mockChange.mockResolvedValue(null);
  mockSession.status = 'signed-out'; mockSession.key = 'guest'; mockSession.profileId = undefined;
  mockVisibility = 'off';
  mockRows = [{ profile: { profileId: 'global-person', name: 'Ada', username: 'ada', publishedWallCount: 2 }, rank: 1, score: 4 }];
});

it('lets a guest move from the Friends prompt to Global rankings and open a public profile', async () => {
  await render(<LeaderboardScreen />);
  expect(screen.getByText('Your friends, when you’re ready.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Browse Global' }));
  expect(mockQuery).toHaveBeenCalledWith('leaderboards:list', { audience: 'global', metric: 'visits', period: 'month' });
  const row = screen.getByRole('button', { name: 'Rank 1, Ada, 4 visits. Open public profile.' });
  await fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/profile/[profileId]', params: { profileId: 'global-person' } });
  expect(screen.getByRole('button', { name: 'Join' })).toBeOnTheScreen();
});

it('changes category and period independently using the dropdowns', async () => {
  mockSession.status = 'ready';
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose Helpful contributions' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose All time' }));
  expect(mockQuery).toHaveBeenCalledWith('leaderboards:list', { audience: 'friends', metric: 'contributions', period: 'all' });
  expect(mockSettings.get('leaderboard-choice')).toBe('{"audience":"friends","metric":"contributions","period":"all"}');
});

it('explains ranking rules and offers participation management from that view', async () => {
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'How rankings work' }));
  expect(screen.getByRole('header', { name: 'Periods and ties' })).toBeOnTheScreen();
  expect(screen.getByText(/1, 2, 2, 4/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Manage participation' }));
  expect(screen.getByRole('header', { name: 'Participation' })).toBeOnTheScreen();
  expect(screen.getByText('Totals only. Not your visit history.')).toBeOnTheScreen();
});

it('keeps Manage available with a ranking and only changes participation after Save', async () => {
  mockSession.status = 'ready'; mockSession.profileId = 'global-person' as Id<'profiles'>; mockVisibility = 'global';
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Manage' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Friends only' }));
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Manage' }));
  expect(screen.getByRole('button', { name: 'Friends & Global' })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: 'Off' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save participation' }));
  expect(mockChange).toHaveBeenCalledWith({ visibility: 'off' });
  await waitFor(() => expect(screen.queryByRole('header', { name: 'Participation' })).toBeNull());
});

it('keeps a failed participation change available for retry', async () => {
  mockSession.status = 'ready'; mockChange.mockRejectedValueOnce(new Error('offline'));
  await render(<LeaderboardScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Join' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Friends & Global' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save participation' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save participation. Try again.');
  await fireEvent.press(screen.getByRole('button', { name: 'Save participation' }));
  expect(mockChange).toHaveBeenLastCalledWith({ visibility: 'global' });
});
