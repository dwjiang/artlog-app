import { fireEvent, render, screen } from '@testing-library/react-native';
import { PublicNotesScreen } from './public-notes-screen';
const mockSetDraft = jest.fn(), mockPublish = jest.fn();
const mockWall = {
  signedIn: true, loading: false, acknowledged: { items: [
    { itemId: 'a', artwork: { artist: 'Artist A', title: 'One' }, privateNote: 'A selected thought', noteEligible: true, noteVisible: true },
    { itemId: 'b', artwork: { artist: 'Artist B', title: 'Two' }, privateNote: 'An unselected secret', noteEligible: true, noteVisible: false },
  ] }, noteDraft: [], repository: { setNoteDraft: mockSetDraft, publishNotes: mockPublish }, setError: jest.fn(),
};
jest.mock('@/lib/wall/use-collection-wall', () => ({ useCollectionWall: () => mockWall }));
it('previews only the selected public notes and changes visibility only after saving', async () => {
  await render(<PublicNotesScreen />);
  expect(screen.getByText('An unselected secret')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByText('A selected thought')).toBeOnTheScreen();
  expect(screen.queryByText('An unselected secret')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to selection' }));
  await fireEvent.press(screen.getAllByRole('switch', { name: 'Show note on public wall' })[1]);
  expect(mockSetDraft).toHaveBeenCalledWith([{ itemId: 'b', visible: true }]);
  expect(mockPublish).not.toHaveBeenCalled();
});
