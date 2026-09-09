import { render, screen } from '@testing-library/react-native';

import { ThemedText } from './themed-text';

describe('ThemedText', () => {
  it('renders its children as visible text', async () => {
    await render(<ThemedText>Hello museum</ThemedText>);
    expect(screen.getByText('Hello museum')).toBeOnTheScreen();
  });
});
