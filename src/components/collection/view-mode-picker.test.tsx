import { fireEvent, render, screen } from '@testing-library/react-native';
import { ViewModePicker } from './view-mode-picker';

jest.mock('@expo/ui', () => jest.requireActual('../../../__mocks__/@expo/ui'));

it('switches between the wall and visits using the visible section controls', async () => {
  const onChange = jest.fn();
  await render(<ViewModePicker mode="wall" onChange={onChange} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Visits' }));
  expect(onChange).toHaveBeenCalledWith('visits');
  expect(screen.queryByRole('button', { name: 'Grid' })).toBeNull();
});

it('offers the archive views inside All artworks', async () => {
  const onChange = jest.fn();
  await render(<ViewModePicker mode="grid" onChange={onChange} />);
  await fireEvent.press(screen.getByRole('button', { name: 'A–Z' }));
  expect(onChange).toHaveBeenCalledWith('az');
  expect(screen.queryByRole('button', { name: 'Visits' })).toBeNull();
});

it('keeps the current section locked while editing the wall', async () => {
  const onChange = jest.fn();
  await render(<ViewModePicker mode="wall" onChange={onChange} disabled />);
  expect(screen.getByRole('button', { name: 'Visits' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Visits' }));
  expect(onChange).not.toHaveBeenCalled();
});
