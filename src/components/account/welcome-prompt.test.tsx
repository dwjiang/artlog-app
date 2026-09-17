import { render, waitFor } from '@testing-library/react-native';
import { getSetting, removeSetting } from '@/db/repos/settings';
import { WelcomePrompt } from './welcome-prompt';

const mockPush = jest.fn(), mockRouter = { push: mockPush };
let mockActive = true;
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => mockActive }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
beforeEach(async () => { jest.clearAllMocks(); mockActive = true; await removeSetting('welcome-seen'); });
it('presents once for a guest and remembers presentation across remounts', async () => {
  const first = await render(<WelcomePrompt status="signed-out" />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/welcome'));
  expect(await getSetting('welcome-seen')).toBe('true');
  await first.unmount();
  await render(<WelcomePrompt status="signed-out" />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
});
it('waits for the active Home screen and a settled session', async () => {
  mockActive = false;
  const view = await render(<WelcomePrompt status="signed-out" />);
  expect(mockPush).not.toHaveBeenCalled();
  mockActive = true;
  await view.rerender(<WelcomePrompt status="loading" />);
  expect(mockPush).not.toHaveBeenCalled();
  await view.rerender(<WelcomePrompt status="signed-out" />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/welcome'));
});
it('does not onboard an existing linked account after signing out', async () => {
  const view = await render(<WelcomePrompt status="ready" />);
  await waitFor(async () => expect(await getSetting('welcome-seen')).toBe('true'));
  await view.rerender(<WelcomePrompt status="signed-out" />);
  expect(mockPush).not.toHaveBeenCalled();
});
