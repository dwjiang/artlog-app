import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as settings from '@/db/repos/settings';
import { VisitPreference } from './visit-preference';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));

afterEach(() => jest.restoreAllMocks());

const read = settings.getSetting, write = settings.setSetting;

/** Holds the spied call until the returned release runs, then forwards it to the real read or write. */
function hold<A extends unknown[], R>(spy: jest.SpyInstance<Promise<R>, A>, original: (...args: A) => Promise<R>) {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  spy.mockImplementationOnce(async (...args) => { await pending; return original(...args); });
  return () => act(() => release());
}

it('shows a ghost only for the initial read and keeps the switch mounted while a change saves', async () => {
  const releaseRead = hold(jest.spyOn(settings, 'getSetting'), read);
  await render(<VisitPreference />);
  expect(screen.getByRole('progressbar', { name: 'Loading remember visit view' })).toBeOnTheScreen();
  expect(screen.queryByRole('switch')).toBeNull();
  await releaseRead();
  const toggle = await screen.findByRole('switch', { name: 'Remember visit view' });
  expect(toggle).toBeChecked();
  const releaseWrite = hold(jest.spyOn(settings, 'setSetting'), write);
  await fireEvent.press(toggle);
  expect(screen.getByRole('switch', { name: 'Remember visit view' })).toBeDisabled();
  expect(screen.queryByRole('progressbar')).toBeNull();
  await releaseWrite();
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Remember visit view' })).toBeEnabled());
  expect(screen.getByRole('switch', { name: 'Remember visit view' })).not.toBeChecked();
  expect(await settings.getSetting('remember-visit-view:device:test-installation')).toBe('false');
});
