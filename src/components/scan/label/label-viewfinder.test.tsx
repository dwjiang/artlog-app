import { render, screen } from '@testing-library/react-native';

import { LABEL_HINT, LabelViewfinder } from './label-viewfinder';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

it('shows the label guide with the framing hint', async () => {
  await render(<LabelViewfinder />);
  expect(screen.getByLabelText('Label guide')).toBeOnTheScreen();
  expect(screen.getByText(LABEL_HINT)).toBeOnTheScreen();
  expect(LABEL_HINT).toBe('Fill the frame with the label, flat and in focus');
});
