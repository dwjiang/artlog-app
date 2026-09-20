import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as visits from '@/db/repos/visits';
import { anonymousOwner, switchOwner, useLocalOwner } from '@/lib/account/owner-store';
import { onCollectionChange } from '@/lib/account/sync-events';
import { VisitNotes } from './visit-notes';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]) }));
const mockDatabaseListeners = new Set<(event: { tableName: string }) => void>();
jest.mock('expo-sqlite', () => ({
  addDatabaseChangeListener: (listener: (event: { tableName: string }) => void) => {
    mockDatabaseListeners.add(listener);
    return { remove: () => mockDatabaseListeners.delete(listener) };
  },
}));

const localId = '00000000-0000-4000-8000-000000000001';
const draft = { localId, venueId: 'museum' as never, venueName: 'Museum', visitedOn: '2024-02-29', timeZone: 'America/New_York' };

function Notes() {
  const owner = useLocalOwner();
  const rows = useLiveQuery(visits.listVisits(owner), [owner]);
  const visit = rows.data.find((row) => row.owner === owner && row.localId === localId);
  return visit ? <VisitNotes visit={visit} /> : null;
}

beforeEach(async () => {
  switchOwner(anonymousOwner(), 'scope-notes');
  await visits.upsertVisit({ ...draft, reflection: null });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function notifyVisitChange() {
  // The in-memory database needs the change event normally emitted by Expo SQLite.
  await act(() => { for (const listener of mockDatabaseListeners) listener({ tableName: 'visits' }); });
}

it('starts ready to type and saves on blur without an Add, Edit, or Save action', async () => {
  const view = await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  expect(input).toHaveProp('value', '');
  expect(input).not.toHaveProp('autoFocus', true);
  expect(screen.queryByRole('button', { name: /Add a note|Edit note|Save note|Cancel/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Public|Private/ })).toBeNull();
  await fireEvent.changeText(input, '  Remember the light  ');
  await fireEvent(input, 'blur');
  await waitFor(async () => expect(await visits.getVisit(localId)).toMatchObject({ reflection: 'Remember the light' }));
  await view.unmount();
  await render(<Notes />);
  expect(await screen.findByDisplayValue('Remember the light')).toBeOnTheScreen();
});

it('autosaves after a typing pause without trimming the text under the cursor', async () => {
  await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  jest.useFakeTimers();
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, 'The light');
  await act(() => jest.advanceTimersByTime(300));
  await fireEvent.changeText(input, 'The light stayed ');
  await act(() => jest.advanceTimersByTime(300));
  expect((await visits.getVisit(localId))?.reflection).toBeNull();
  await act(() => jest.advanceTimersByTime(200));
  expect((await visits.getVisit(localId))?.reflection).toBe('The light stayed');
  await notifyVisitChange();
  expect(screen.getByLabelText('Notes')).toHaveProp('value', 'The light stayed ');
});

it('pushes a pause-saved note to sync only when the field blurs', async () => {
  const requests = jest.fn();
  const unsubscribe = onCollectionChange(requests);
  try {
    await render(<Notes />);
    const input = await screen.findByLabelText('Notes');
    jest.useFakeTimers();
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, 'The light');
    await act(() => jest.advanceTimersByTime(500));
    await fireEvent.changeText(input, 'The light stayed');
    await act(() => jest.advanceTimersByTime(500));
    expect((await visits.getVisit(localId))?.reflection).toBe('The light stayed');
    expect(requests).not.toHaveBeenCalled();
    await fireEvent(input, 'blur');
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    await fireEvent(input, 'focus');
    await fireEvent(input, 'blur');
    await act(async () => {});
    expect(requests).toHaveBeenCalledTimes(1);
  } finally { unsubscribe(); }
});

it('flushes the newest text when closing during an earlier save', async () => {
  const write = visits.patchVisit;
  let finishWrite!: () => void;
  const pending = new Promise<void>((resolve) => { finishWrite = resolve; });
  jest.spyOn(visits, 'patchVisit').mockImplementationOnce(async (...args) => { await pending; await write(...args); });
  const view = await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  await fireEvent.changeText(input, 'First draft');
  await fireEvent(input, 'blur');
  await fireEvent.changeText(input, 'Newest draft');
  await view.unmount();
  await act(async () => { finishWrite(); });
  await waitFor(async () => expect(await visits.getVisit(localId)).toMatchObject({ reflection: 'Newest draft' }));
});

it('saves when the app goes into the background', async () => {
  let changeState!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    changeState = callback; return { remove: jest.fn() };
  });
  await render(<Notes />);
  await fireEvent.changeText(await screen.findByLabelText('Notes'), 'Before backgrounding');
  await act(() => changeState('background'));
  await waitFor(async () => expect(await visits.getVisit(localId)).toMatchObject({ reflection: 'Before backgrounding' }));
});

it('removes a note when the field is cleared', async () => {
  await visits.upsertVisit({ ...draft, reflection: 'Saved memory' });
  await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  await fireEvent.changeText(input, '  \n ');
  await fireEvent(input, 'blur');
  await waitFor(async () => expect((await visits.getVisit(localId))?.reflection).toBeNull());
  expect(screen.getByPlaceholderText('What stayed with you?')).toBeOnTheScreen();
});

it('keeps a failed draft visible and retries without more typing', async () => {
  jest.spyOn(visits, 'patchVisit').mockRejectedValueOnce(new Error('Storage unavailable'));
  await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  await fireEvent.changeText(input, 'Keep this draft');
  await fireEvent(input, 'blur');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your note could not be saved. Try again.');
  expect(input).toHaveProp('value', 'Keep this draft');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry save' }));
  await waitFor(async () => expect((await visits.getVisit(localId))?.reflection).toBe('Keep this draft'));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('saves the previous owner’s draft only to their journal when switching accounts', async () => {
  await visits.upsertVisit({ ...draft, reflection: 'Other owner note' }, 'account:other');
  await render(<Notes />);
  await fireEvent.changeText(await screen.findByLabelText('Notes'), 'Original owner draft');
  await act(() => switchOwner('account:other', 'scope-other'));
  expect(await screen.findByDisplayValue('Other owner note')).toBeOnTheScreen();
  await waitFor(async () => expect((await visits.getVisit(localId, anonymousOwner()))?.reflection).toBe('Original owner draft'));
  expect((await visits.getVisit(localId, 'account:other'))?.reflection).toBe('Other owner note');
});

it('accepts synced notes when idle and keeps an unsaved local draft during a refresh', async () => {
  await render(<Notes />);
  const input = await screen.findByLabelText('Notes');
  await visits.patchVisit(localId, { reflection: 'From another device' });
  await notifyVisitChange();
  expect(input).toHaveProp('value', 'From another device');
  await fireEvent.changeText(input, 'Local draft');
  await visits.patchVisit(localId, { reflection: 'A later remote edit' });
  await notifyVisitChange();
  expect(input).toHaveProp('value', 'Local draft');
  await fireEvent(input, 'blur');
  await waitFor(async () => expect((await visits.getVisit(localId))?.reflection).toBe('Local draft'));
});
