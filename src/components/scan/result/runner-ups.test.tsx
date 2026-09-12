import { fireEvent, render, screen } from '@testing-library/react-native';

import { RunnerUps } from './runner-ups';
import { bridge, haystacks } from './__fixtures__/scan';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

it('lists title, artist and institution per row and reports the tapped candidate', async () => {
  const onPick = jest.fn();
  await render(<RunnerUps candidates={[bridge, haystacks]} onPick={onPick} />);
  expect(screen.getByText('The Japanese Footbridge')).toBeOnTheScreen();
  expect(screen.getByText('Claude Monet · National Gallery of Art')).toBeOnTheScreen();
  expect(screen.getByText('Claude Monet · Art Institute of Chicago')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Haystacks, Claude Monet' }));
  expect(onPick).toHaveBeenCalledWith(haystacks);
});

it('shows a museum thumbnail only when the server hotlinked one', async () => {
  await render(<RunnerUps candidates={[bridge, haystacks]} onPick={jest.fn()} />);
  expect(screen.getByLabelText('Museum image of The Japanese Footbridge').props.source).toEqual([{ uri: 'https://images.example/bridge.jpg' }]);
  expect(screen.queryByLabelText('Museum image of Haystacks')).toBeNull();
});
