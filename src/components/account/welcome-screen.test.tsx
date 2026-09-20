import { fireEvent, render, screen } from '@testing-library/react-native';
import { WelcomeScreen } from './welcome-screen';

const mockBack = jest.fn(), mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

beforeEach(() => jest.clearAllMocks());

it('lets a new visitor skip sign-in and start exploring', async () => {
  await render(<WelcomeScreen />);
  expect(screen.getByRole('header', { name: 'Welcome to Artlog' })).toBeOnTheScreen();
  expect(screen.getByText('Remember the art that stays with you.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Explore without an account' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('opens optional sign-in without leaving another welcome screen underneath it', async () => {
  await render(<WelcomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { context: 'account' } });
});
