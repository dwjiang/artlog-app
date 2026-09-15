import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { CONSENT_BODY, CONSENT_TITLE, ConsentSheet } from './consent-sheet';

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text></Pressable>
    ),
    BottomSheet: ({ isPresented, children }: { isPresented: boolean; children: ReactNode }) => isPresented ? <View>{children}</View> : null,
  };
});

const handlers = { onShare: jest.fn(), onDismiss: jest.fn() };
beforeEach(() => jest.clearAllMocks());

it('states exactly what leaves the phone before sharing', async () => {
  await render(<ConsentSheet open {...handlers} />);
  expect(screen.getByText('Share this work with other visitors?')).toBeOnTheScreen();
  expect(screen.getByText(
    'What leaves your phone: a numeric fingerprint of your photo (not the photo), the details read from the label, and a small crop ' +
    'of your own photo of the painting. The crop becomes the thumbnail other visitors see for this work. Only this small crop is shared with the index. ' +
    'Your saved collection photos stay private. You can withdraw a contribution from Settings.',
  )).toBeOnTheScreen();
  expect(CONSENT_TITLE).toBe('Share this work with other visitors?');
  expect(CONSENT_BODY).toContain('Your saved collection photos stay private.');
  await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
  expect(handlers.onShare).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
});

it('renders nothing while closed', async () => {
  expect((await render(<ConsentSheet open={false} {...handlers} />)).toJSON()).toBeNull();
});
