import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { NoteEditor } from './note-editor';
import * as notes from '@/db/repos/notes';
import { insertSavedWork } from '@/db/repos/saved-works';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@expo/ui/swift-ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

beforeAll(async () => {
  await insertSavedWork({ localId: 'work', title: 'Painting', artist: 'Artist', savedAt: 1, cropPath: 'crop.jpg' });
});

beforeEach(async () => {
  await notes.setNote('work', 'Original note');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function editNote() {
  const view = await render(<NoteEditor savedLocalId="work" />);
  const input = await screen.findByDisplayValue('Original note');
  await fireEvent.changeText(input, 'New note');
  return { view, input };
}

it('keeps a failed draft visible and lets the user retry saving it', async () => {
  jest.spyOn(notes, 'setNote').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
  const { input } = await editNote();
  await fireEvent(input, 'blur');
  expect(await screen.findByText('Your note couldn’t be saved. Try again.')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('New note')).toBeOnTheScreen();
  expect(await notes.getNote('work')).toMatchObject({ text: 'Original note' });
  await fireEvent.press(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(async () => expect(await notes.getNote('work')).toMatchObject({ text: 'New note' }));
  expect(screen.queryByText('Your note couldn’t be saved. Try again.')).toBeNull();
});

it.each(['blur', 'close'])('retries an unchanged failed draft on %s', async (event) => {
  jest.spyOn(notes, 'setNote').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
  const { view, input } = await editNote();
  await fireEvent(input, 'blur');
  if (event === 'close') await view.unmount();
  else {
    await fireEvent(input, 'focus');
    await fireEvent(input, 'blur');
  }
  await waitFor(async () => expect(await notes.getNote('work')).toMatchObject({ text: 'New note' }));
});

it('preserves the newest edit when closing during an earlier write', async () => {
  const write = notes.setNote;
  let finishWrite!: () => void;
  const pending = new Promise<void>((resolve) => { finishWrite = resolve; });
  jest.spyOn(notes, 'setNote').mockImplementationOnce(async (...args) => { await pending; await write(...args); });
  const { view, input } = await editNote();
  await fireEvent(input, 'blur');
  await fireEvent.changeText(input, 'Newest note');
  await view.unmount();
  await act(async () => { finishWrite(); });
  await waitFor(async () => expect(await notes.getNote('work')).toMatchObject({ text: 'Newest note' }));
});
