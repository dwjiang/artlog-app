import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { APP_STORE_URL, UPDATE_BUTTON, UPDATE_LINE, UPDATE_TITLE, UnsupportedCard } from './unsupported-card';

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

const handlers = { onSave: jest.fn(), onViewSaved: jest.fn() };
let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

it('asks for the update, opens TestFlight while no store URL is configured, and saves anyway with a title', async () => {
  expect(APP_STORE_URL).toBe('itms-beta://');
  await render(<UnsupportedCard saving={false} {...handlers} />);
  expect(screen.getByText(UPDATE_TITLE)).toBeOnTheScreen();
  expect(screen.getByText(UPDATE_LINE)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: UPDATE_BUTTON }));
  expect(openURL).toHaveBeenCalledWith('itms-beta://');
  expect(screen.getByRole('button', { name: /^Save (to collection|photo for later)$/ })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Add details (optional)' }));
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Blue room');
  await fireEvent.press(screen.getByRole('button', { name: /^Save (to collection|photo for later)$/ }));
  expect(handlers.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Blue room' }));
});

it('says so when the store cannot be opened', async () => {
  openURL.mockRejectedValue(new Error('No handler'));
  await render(<UnsupportedCard saving={false} {...handlers} />);
  await fireEvent.press(screen.getByRole('button', { name: UPDATE_BUTTON }));
  expect(await screen.findByText('Couldn’t open the App Store.')).toBeOnTheScreen();
});
