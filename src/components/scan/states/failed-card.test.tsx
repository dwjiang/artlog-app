import { fireEvent, render, screen } from '@testing-library/react-native';

import { FailedCard, RETRY_BUTTON } from './failed-card';
import { FAILED_TITLE } from '@/lib/result/failure-copy';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

it('explains a server code in plain words and offers a retry for a scan still on this phone', async () => {
  const onRetry = jest.fn();
  await render(<FailedCard error="bad_features" onRetry={onRetry} />);
  expect(screen.getByText(FAILED_TITLE)).toBeOnTheScreen();
  expect(screen.getByText('The photo couldn’t be read. Try scanning the painting again.')).toBeOnTheScreen();
  expect(screen.queryByText('bad_features')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: RETRY_BUTTON }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('offers no retry for a scan the server already answered', async () => {
  await render(<FailedCard error="scan_not_found" />);
  expect(screen.getByText('The server no longer has this scan.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: RETRY_BUTTON })).toBeNull();
});
