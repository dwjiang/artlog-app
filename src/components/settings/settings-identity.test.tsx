import { fireEvent, render, screen } from '@testing-library/react-native';

import { SettingsIdentity } from './settings-identity';

const mockPush = jest.fn();
let mockStatus = 'ready';
let mockProfile: { name: string; username: string } | undefined;
jest.mock('expo-router', () => ({ router: { push: (href: string) => mockPush(href) } }));
jest.mock('@/lib/social/use-social-session', () => ({ useSocialSession: () => ({ key: 'a', status: mockStatus }) }));
jest.mock('@/lib/social/use-social-query', () => ({ useSocialQuery: () => ({ data: mockProfile }) }));

beforeEach(() => { jest.clearAllMocks(); mockStatus = 'ready'; mockProfile = undefined; });

it('opens profile editing for a public profile and profile creation when one is required', async () => {
  mockProfile = { name: 'Jamie Chen', username: 'jamie' };
  const view = await render(<SettingsIdentity />);
  expect(screen.getByText('@jamie')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit your profile' }));
  expect(mockPush).toHaveBeenLastCalledWith('/edit-profile');
  mockStatus = 'profile-required'; mockProfile = undefined;
  await view.rerender(<SettingsIdentity />);
  await fireEvent.press(screen.getByRole('button', { name: 'Create your profile' }));
  expect(mockPush).toHaveBeenLastCalledWith('/create-profile');
});

it.each([
  ['signed-out', 'Guest', /without signing in/],
  ['offline', 'Offline', /back online/],
  ['error', undefined, /couldn’t be checked/],
  ['loading', undefined, /Checking your account/],
])('describes the %s state without a tappable row', async (status, badge, detail) => {
  mockStatus = status;
  await render(<SettingsIdentity />);
  expect(screen.getByText('Your collection')).toBeOnTheScreen();
  expect(screen.getByText(detail)).toBeOnTheScreen();
  if (badge) expect(screen.getByText(badge)).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});
