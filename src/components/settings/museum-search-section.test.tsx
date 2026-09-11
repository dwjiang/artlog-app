import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';

import { MUSEUM_SEARCH_SETTING } from './museum-search-section';
import { SettingsScreen } from './settings-screen';
import { getMuseumSearchConsent, setMuseumSearchConsent } from '@/lib/settings/museum-search';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => true }));
jest.mock('./dev-tools', () => ({ DevTools: () => null }));
jest.mock('convex/react', () => ({ useQuery: () => undefined, useConvexAuth: () => ({ isAuthenticated: false }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: ReactNode }) => children }));
jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    BottomSheet: ({ isPresented, children }: { isPresented: boolean; children: ReactNode }) => isPresented ? <View>{children}</View> : null,
    Switch: ({ label, value, onValueChange, disabled }: ComponentProps<typeof import('@expo/ui').Switch>) => (
      <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
        disabled={disabled} onPress={() => onValueChange(!value)}><Text>{label}</Text></Pressable>
    ),
    Button: ({ label, onPress, disabled }: ComponentProps<typeof import('@expo/ui').Button>) => (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

beforeEach(async () => { await setMuseumSearchConsent('unset'); });

it('mounts the privacy control in Settings and requires consent before enabling it', async () => {
  await render(<SettingsScreen />);
  const toggle = await screen.findByRole('switch', { name: MUSEUM_SEARCH_SETTING });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).not.toBeChecked();
  await fireEvent.press(toggle);
  expect(await screen.findByText("Search this museum's collection?")).toBeOnTheScreen();
  expect(await getMuseumSearchConsent()).toBe('unset');
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
  expect(await getMuseumSearchConsent()).toBe('granted');
});

it('persists off as declined through a remount and keeps cancellation off', async () => {
  await setMuseumSearchConsent('granted');
  const view = await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  expect(await getMuseumSearchConsent()).toBe('declined');
  await view.unmount();
  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  expect(screen.getByRole('switch')).not.toBeChecked();
  await fireEvent.press(screen.getByRole('switch'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
  expect(await getMuseumSearchConsent()).toBe('declined');
  expect(screen.getByRole('switch')).not.toBeChecked();
  await fireEvent.press(screen.getByRole('switch'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
});
