import { fireEvent, render, screen } from '@testing-library/react-native';

import { IDENTIFYING_TITLE, LABEL_NOW, WAITING_LINE, WAITING_TITLE, WaitingForSignalCard } from './waiting-for-signal-card';

jest.mock('@/components/collection/gallery-button');
jest.mock('@expo/ui', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    TextInput: ({ defaultValue, placeholder, editable, onChangeText }: { defaultValue?: string; placeholder?: string; editable?: boolean; onChangeText?: (value: string) => void }) => (
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} defaultValue={defaultValue} editable={editable} onChangeText={onChangeText} />
    ),
  };
});

const handlers = { onLabel: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it('says it is waiting for signal and asks for the label now', async () => {
  await render(<WaitingForSignalCard status="queued" {...handlers} />);
  expect(screen.getByText(WAITING_TITLE)).toBeOnTheScreen();
  expect(screen.getByText(WAITING_LINE)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: LABEL_NOW }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);

});

it('reads as identifying while the scan is in flight and keeps the label handy', async () => {
  await render(<WaitingForSignalCard status="identifying" {...handlers} />);
  expect(screen.getByText(IDENTIFYING_TITLE)).toBeOnTheScreen();
  expect(screen.queryByText(WAITING_TITLE)).toBeNull();
  expect(screen.getByRole('button', { name: LABEL_NOW })).toBeOnTheScreen();
});
