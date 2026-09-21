import { fireEvent, render, screen } from '@testing-library/react-native';

import { NotRightSheet } from './not-right-sheet';
import { bridge, haystacks } from './__fixtures__/scan';


const handlers = { onDismiss: jest.fn(), onPick: jest.fn(), onLabel: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it('shows the runner-ups first and the label as the way out', async () => {
  await render(<NotRightSheet open runnerUps={[bridge, haystacks]} {...handlers} />);
  expect(screen.getByText('Maybe one of these?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'The Japanese Footbridge, Claude Monet, 31% confidence' }));
  expect(handlers.onPick).toHaveBeenCalledWith(bridge);
  await fireEvent.press(screen.getByRole('button', { name: 'None of these — point at the label' }));
  expect(handlers.onLabel).toHaveBeenCalledTimes(1);
});

it('goes straight to the label without runner-ups and surfaces a notice', async () => {
  await render(<NotRightSheet open runnerUps={[]} notice="This device can’t send feedback yet." {...handlers} />);
  expect(screen.getByText('Not in our index yet')).toBeOnTheScreen();
  expect(screen.getByText('This device can’t send feedback yet.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Point at the label' })).toBeOnTheScreen();
});

it('renders nothing while closed', async () => {
  expect((await render(<NotRightSheet open={false} runnerUps={[bridge]} {...handlers} />)).toJSON()).toBeNull();
});
