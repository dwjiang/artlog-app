import { fireEvent, render, screen } from '@testing-library/react-native';

import { LABEL_BUTTON, SaveBar } from './save-bar';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

const handlers = { onSave: jest.fn(), onLabel: jest.fn(), onViewSaved: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it('offers the label only when a handler is given', async () => {
  const view = await render(<SaveBar canSave saving={false} onSave={handlers.onSave} onViewSaved={handlers.onViewSaved} />);
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  await view.rerender(<SaveBar canSave={false} saving={false} {...handlers} />);
  await fireEvent.press(screen.getByRole('button', { name: LABEL_BUTTON }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
});

it('needs a title before saving and swaps to the collection link once saved', async () => {
  const view = await render(<SaveBar canSave={false} saving={false} {...handlers} />);
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeDisabled();
  expect(screen.getByText('Add a title to save this work.')).toBeOnTheScreen();
  await view.rerender(<SaveBar canSave saving={false} savedId="saved-1" {...handlers} />);
  expect(screen.queryByRole('button', { name: 'Save to collection' })).toBeNull();
  expect(screen.queryByText(LABEL_BUTTON)).toBeNull();
  await fireEvent.press(screen.getByRole('link', { name: 'Saved · View in collection' }));
  expect(handlers.onViewSaved).toHaveBeenCalledTimes(1);
});

it('takes another verb for cards that save without a result', async () => {
  await render(<SaveBar saveLabel="Save anyway" canSave saving={false} onSave={handlers.onSave} onViewSaved={handlers.onViewSaved} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save anyway' }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
});
