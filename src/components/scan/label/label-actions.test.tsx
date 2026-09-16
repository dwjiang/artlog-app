import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Id } from '../../../../convex/_generated/dataModel';

import { CONTRIBUTION_MESSAGES, contributionMessage } from './contribute-result';
import { LabelActions, SHARE_BUTTON } from './label-actions';

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});

jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => true }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../../db/test-db').createTestDatabase() }));

const handlers = { onSave: jest.fn(), onShare: jest.fn(), onViewSaved: jest.fn() };
const contributionId = 'contrib-1' as Id<'contributions'>;
beforeEach(() => jest.clearAllMocks());

it('offers saving and sharing, each gated on its required fields', async () => {
  const view = await render(<LabelActions canSave canShare={false} saving={false} sharing={false} {...handlers} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save to collection' }));
  expect(handlers.onSave).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: SHARE_BUTTON })).toBeDisabled();
  expect(screen.getByText('A title and an artist are needed to share.')).toBeOnTheScreen();
  await view.rerender(<LabelActions canSave={false} canShare saving={false} sharing={false} {...handlers} />);
  expect(screen.getByRole('button', { name: 'Save to collection' })).toBeDisabled();
  expect(screen.getByText('Add a title to save this work.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: SHARE_BUTTON }));
  expect(handlers.onShare).toHaveBeenCalledTimes(1);
});

it('replaces the buttons with the saved link and the contribution outcome', async () => {
  await render(
    <LabelActions canSave canShare saving={false} sharing={false} savedId="saved-1" shared={{ contributionId, status: 'tentative' }} shareError="stale" {...handlers} />,
  );
  expect(screen.queryByRole('button', { name: 'Save to collection' })).toBeNull();
  expect(screen.queryByRole('button', { name: SHARE_BUTTON })).toBeNull();
  expect(screen.queryByText('stale')).toBeNull();
  expect(screen.getByText('Shared as a tentative match for other visitors at this museum.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('link', { name: 'Saved · View in collection' }));
  expect(handlers.onViewSaved).toHaveBeenCalledTimes(1);
});

it('words every contribution outcome', () => {
  expect(contributionMessage({ contributionId, status: 'rejected', reason: 'duplicate' })).toBe(CONTRIBUTION_MESSAGES.duplicate);
  expect(contributionMessage({ contributionId, status: 'rejected' })).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(contributionMessage({ contributionId, status: 'rejected', reason: 'device_reverted' })).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(contributionMessage({ contributionId, status: 'rejected', reason: 'object_reverted' })).toBe(CONTRIBUTION_MESSAGES.rejected);
  expect(contributionMessage({ contributionId, status: 'tentative' })).toBe(CONTRIBUTION_MESSAGES.tentative);
});
