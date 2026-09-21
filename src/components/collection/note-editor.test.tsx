import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { NoteEditor } from './note-editor';
import * as notes from '@/db/repos/notes';
import { insertSavedWork } from '@/db/repos/saved-works';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@expo/ui/swift-ui', () => jest.requireActual('../../../__mocks__/@expo/ui/swift-ui'));

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
  await fireEvent.press(await screen.findByRole('button', { name: 'Edit note' }));
  const input = await screen.findByDisplayValue('Original note');
  await fireEvent.changeText(input, 'New note');
  return { view, input };
}

it('keeps a failed draft visible and lets the user retry saving it', async () => {
  jest.spyOn(notes, 'setNote').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
  const { input } = await editNote();
  await fireEvent(input, 'blur');
  expect(await screen.findByText('Couldn’t save. Your draft is still here.')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('New note')).toBeOnTheScreen();
  expect(await notes.getNote('work')).toMatchObject({ text: 'Original note' });
  await fireEvent.press(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(async () => expect(await notes.getNote('work')).toMatchObject({ text: 'New note' }));
  expect(screen.queryByText('Couldn’t save. Your draft is still here.')).toBeNull();
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

it('explains the note limit when reached and saves a note at the limit', async () => {
  const { input } = await editNote();
  const text = 'a'.repeat(20_000);
  await fireEvent.changeText(input, text);
  expect(screen.getByText('Notes can be up to 20,000 characters.')).toBeOnTheScreen();
  await fireEvent(input, 'blur');
  await waitFor(async () => expect(await notes.getNote('work')).toMatchObject({ text }));
  await fireEvent.changeText(input, 'Shorter note');
  expect(screen.queryByText('Notes can be up to 20,000 characters.')).toBeNull();
});

it('distinguishes a public wall note from a private note', async () => {
  const view = await render(<NoteEditor savedLocalId="work" sharedOnWall />);
  expect(await screen.findByText('Shared on your public wall')).toBeOnTheScreen();
  expect(screen.queryByText('Only you')).toBeNull();
  await view.rerender(<NoteEditor savedLocalId="work" sharedOnWall={false} />);
  expect(screen.getByText('Only you')).toBeOnTheScreen();
});

it('opens Notes when an existing artwork screen receives a note-edit request', async () => {
  const view = await render(<NoteEditor savedLocalId="work" />);
  expect(await screen.findByRole('button', { name: 'Edit note' })).toBeOnTheScreen();
  expect(screen.queryByLabelText('Notes')).toBeNull();
  await view.rerender(<NoteEditor savedLocalId="work" initiallyEditing />);
  expect(await screen.findByDisplayValue('Original note')).toBeOnTheScreen();
});
