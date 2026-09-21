import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActionRow, NavigationRow, ValueRow } from './grouped-list';
import { GalleryIconButton } from './collection/gallery-icon-button';

jest.mock('@expo/ui');
jest.mock('@expo/ui/swift-ui');

it('keeps action identity while showing progress and blocking duplicate activation', async () => {
  const onPress = jest.fn();
  const view = await render(<ActionRow label="Export collection" busy onPress={onPress} />);
  const button = screen.getByRole('button', { name: 'Export collection' });
  expect(button).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Export collection in progress' })).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
  await view.rerender(<ActionRow label="Export collection" onPress={onPress} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Export collection' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('reserves pending values for a visual indicator rather than default or loading text', async () => {
  const view = await render(<NavigationRow label="Participation" loading onPress={jest.fn()} />);
  expect(screen.getByRole('progressbar', { name: 'Loading participation' })).toBeOnTheScreen();
  expect(screen.queryByText(/Loading/)).toBeNull();
  await view.rerender(<ValueRow label="Backend" value="Connected" loading />);
  expect(screen.queryByText('Connected')).toBeNull();
  expect(screen.getByRole('progressbar', { name: 'Loading backend' })).toBeOnTheScreen();
  await view.rerender(<ValueRow label="Backend" value="Connected" />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Connected')).toBeOnTheScreen();
});

it('shows progress inside a busy icon button while preserving its action name', async () => {
  await render(<GalleryIconButton label="Share" icon="square.and.arrow.up" busy onPress={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  expect(screen.getByRole('progressbar', { name: 'Share in progress' })).toBeOnTheScreen();
});
