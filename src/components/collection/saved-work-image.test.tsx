import { render, screen } from '@testing-library/react-native';

import { SavedWorkImage } from './saved-work-image';

jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///${path}` }));

it('shows a pending photo while an imported work downloads', async () => {
  await render(<SavedWorkImage path={null} title="Water Lilies" style={{ width: 100, height: 100 }} />);
  expect(screen.getByText('Photo syncing…')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Your photo of Water Lilies')).toBeNull();
});
