import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { MUSEUM_SEARCH_SETTING } from './museum-search-section';
import { runMuseumSearch } from '@/lib/museum-search/flow';
import { SettingsScreen } from './settings-screen';
import { getMuseumSearchConsent, setMuseumSearchConsent } from '@/lib/settings/museum-search';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => true }));
jest.mock('./dev-tools', () => ({ DevTools: () => null }));
jest.mock('@/lib/account/use-account', () => ({
  useAccount: () => ({ account: null, available: false, busy: false, ready: false }),
}));
jest.mock('convex/react', () => ({ useQuery: () => undefined, useConvexAuth: () => ({ isAuthenticated: false }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: ReactNode }) => children }));
jest.mock('@expo/ui');
jest.mock('@/lib/use-device-ready', () => ({ useDeviceReady: () => false }));

beforeEach(async () => { await setMuseumSearchConsent('unset'); });

it('mounts the privacy control in Settings and requires consent before enabling it', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByRole('header', { name: 'Account' })).toBeOnTheScreen();
  const toggle = await screen.findByRole('switch', { name: MUSEUM_SEARCH_SETTING });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();
  await fireEvent.press(toggle);
  expect(await screen.findByText("Search this museum's collection?")).toBeOnTheScreen();
  expect(await getMuseumSearchConsent()).toBe('unset');
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
  expect(await getMuseumSearchConsent()).toBe('granted');
});

it('persists off as declined through a remount and keeps cancellation off', async () => {
  await setMuseumSearchConsent('granted');
  const view = await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
  await fireEvent.press(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING }));
  await waitFor(() => expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked());
  expect(await getMuseumSearchConsent()).toBe('declined');
  await view.unmount();
  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).toBeEnabled());
  expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  await fireEvent.press(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
  expect(await getMuseumSearchConsent()).toBe('declined');
  expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).not.toBeChecked();
  await fireEvent.press(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING })).toBeChecked());
});

it('prevents any photo preparation or upload after revoking consent in Settings and returning to a scan', async () => {
  await setMuseumSearchConsent('granted');
  const view = await render(<SettingsScreen />);
  const toggle = screen.getByRole('switch', { name: MUSEUM_SEARCH_SETTING });
  await waitFor(() => expect(toggle).toBeChecked());
  await fireEvent.press(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  await view.unmount();
  const prepareCrop = jest.fn();
  const searchMuseumSite = jest.fn();
  expect(await runMuseumSearch({
    scanId: 'scan-1' as import('../../../convex/_generated/dataModel').Id<'scans'>,
    localId: 'capture-1', inputSize: 512, canContinue: () => true,
    getCapture: jest.fn(), prepareCrop,
    api: { searchExhibitions: jest.fn(), searchMuseumSite, confirmSearchCandidate: jest.fn() },
    images: { download: jest.fn(), letterbox: jest.fn(), embed: jest.fn(), extractOrb: jest.fn(), remove: jest.fn() },
  })).toEqual({ stage: 'cancelled' });
  expect(prepareCrop).not.toHaveBeenCalled();
  expect(searchMuseumSite).not.toHaveBeenCalled();
});
