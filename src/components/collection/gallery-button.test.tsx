import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { GalleryButton } from './gallery-button';

jest.mock('@expo/ui/swift-ui', () => ({
  ZStack: jest.requireActual('react-native').View,
  ProgressView: () => { const { ActivityIndicator } = jest.requireActual('react-native'); return <ActivityIndicator accessibilityLabel="In progress" />; },
}));

jest.mock('@expo/ui', () => jest.requireActual('../../../__mocks__/@expo/ui'));

it('keeps its label and prevents duplicate activation while announcing progress', async () => {
  const onPress = jest.fn();
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  await render(<GalleryButton label="Save artwork" onPress={onPress} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save artwork' }));
  expect(onPress).toHaveBeenCalledTimes(1);

  await screen.rerender(<GalleryButton label="Save artwork" onPress={onPress} busy />);
  const button = screen.getByRole('button', { name: 'Save artwork', disabled: true });
  expect(screen.getByText('Save artwork')).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('In progress')).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith('Save artwork. In progress.');

  await screen.rerender(<GalleryButton label="Save artwork" onPress={onPress} />);
  expect(screen.getByRole('button', { name: 'Save artwork', disabled: false })).toBeOnTheScreen();
  announce.mockRestore();
});
