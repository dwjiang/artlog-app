import { fireEvent, render, screen } from '@testing-library/react-native';
import { getSetting, removeSetting, setSetting } from '@/db/repos/settings';
import { SignInPromo } from './sign-in-promo';
const mockPush = jest.fn();
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
beforeEach(async () => { jest.clearAllMocks(); await removeSetting('sign-in-promo-dismissed'); });
it('opens the shared sheet and persists Not now across remounts', async () => {
  const first = await render(<SignInPromo />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'friends' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByText('Art is better together.')).toBeNull();
  expect(await getSetting('sign-in-promo-dismissed')).toBe('true');
  await first.unmount();
  await render(<SignInPromo />);
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
});
it('omits the card when its dismissal is already saved', async () => {
  await setSetting('sign-in-promo-dismissed', 'true');
  await render(<SignInPromo />);
  expect(screen.queryByText('Art is better together.')).toBeNull();
});
