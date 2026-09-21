import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SearchConsentSheet } from './search-consent-sheet';
import { setMuseumSearchConsent } from '@/lib/settings/museum-search';

jest.mock('@/lib/settings/museum-search', () => ({ setMuseumSearchConsent: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it('shows the exact consent copy and persists the grant before starting any search', async () => {
  let finish!: () => void;
  jest.mocked(setMuseumSearchConsent).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const onGranted = jest.fn();
  await render(<SearchConsentSheet open onGranted={onGranted} onDismiss={jest.fn()} />);
  expect(screen.getByText("Look in the museum’s collection?")).toBeOnTheScreen();
  expect(screen.getByText("We'll search the museum's current exhibitions and compare its images with your photo on this phone. Your photo stays on the phone; the search sends only the museum's name. You can turn this off in Settings.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Search this museum' }));
  expect(setMuseumSearchConsent).toHaveBeenCalledWith('granted');
  expect(onGranted).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(onGranted).toHaveBeenCalledTimes(1);
});

it('dismisses Not now without changing consent or starting a search', async () => {
  const onGranted = jest.fn();
  const onDismiss = jest.fn();
  await render(<SearchConsentSheet open onGranted={onGranted} onDismiss={onDismiss} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(setMuseumSearchConsent).not.toHaveBeenCalled();
  expect(onGranted).not.toHaveBeenCalled();
});

it('keeps the sheet open without uploading when persistence fails', async () => {
  jest.mocked(setMuseumSearchConsent).mockRejectedValue(new Error('disk full'));
  const onGranted = jest.fn();
  await render(<SearchConsentSheet open onGranted={onGranted} onDismiss={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Search this museum' }));
  await waitFor(() => expect(screen.getByText("Couldn't save your choice. Try again.")).toBeOnTheScreen());
  expect(onGranted).not.toHaveBeenCalled();
});
