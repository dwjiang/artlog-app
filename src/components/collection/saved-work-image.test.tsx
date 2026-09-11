import { render, screen } from '@testing-library/react-native';

import { SavedWorkImage } from './saved-work-image';

jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///${path}` }));

it('explains the missing photo for an imported work', async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" style={{ width: 100, height: 100 }} />);
  expect(screen.getByText('Photo on another device')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Your photo of Water Lilies')).toBeNull();
});
