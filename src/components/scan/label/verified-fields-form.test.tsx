import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import type { LabelFlowDisplay } from '../../../../convex/lib/validators';

import { UNLOCK_TITLE, unlockMessage, VerifiedFieldsForm } from './verified-fields-form';
import { EDITED_LABEL, formStateFromFlow, unlockField } from '@/lib/label/fields';

jest.mock('@expo/ui', () => {
  const { TextInput, View } = jest.requireActual('react-native');
  return {
    Host: View,
    TextInput: ({ defaultValue, placeholder, editable, onChangeText }: { defaultValue?: string; placeholder?: string; editable?: boolean; onChangeText?: (value: string) => void }) => (
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} defaultValue={defaultValue} editable={editable} onChangeText={onChangeText} />
    ),
  };
});

const flow: LabelFlowDisplay = {
  stage: 'verified', evidence: ['tavily+image'], warnings: ['date_outside_lifespan'], moderation: 'clear', updatedAt: 1,
  fields: {
    title: { value: 'Water Lilies', evidence: 'tavily+image', locked: true },
    artist: { value: 'Claude Monet', evidence: 'tavily+image', locked: true },
    date: { value: '1990', evidence: 'weak', locked: false },
  },
};
const handlers = { onChange: jest.fn(), onUnlock: jest.fn() };

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

it('locks verified fields behind a confirmation that names the source', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable {...handlers} />);
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  expect(screen.getByLabelText('Date').props.editable).toBe(true);
  expect(screen.getAllByText('From the museum’s site')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Edit Date' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Title' }));
  expect(alert).toHaveBeenCalledWith(UNLOCK_TITLE, unlockMessage('the museum’s site'), expect.any(Array));
  expect(unlockMessage('the museum’s site')).toBe('It was verified against the museum’s site; your shared entry will remain tentative, including any edits.');
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  buttons.find((button) => button.text === 'Edit')?.onPress?.();
  expect(handlers.onUnlock).toHaveBeenCalledWith('title');
  expect(handlers.onChange).not.toHaveBeenCalled();
});

it('makes an unlocked field editable with the "Edited by you" badge and reports edits by field', async () => {
  const state = unlockField(formStateFromFlow(flow), 'title');
  await render(<VerifiedFieldsForm state={state} warnings={[]} editable {...handlers} />);
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  expect(screen.getByText(EDITED_LABEL)).toBeOnTheScreen();
  expect(screen.getAllByText('From the museum’s site')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Nymphéas');
  expect(handlers.onChange).toHaveBeenCalledWith('title', 'Nymphéas');
});

it('shows plausibility warnings and freezes everything when not editable', async () => {
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable={false} {...handlers} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The date is outside the artist’s lifespan — please check');
  expect(screen.getByLabelText('Date').props.editable).toBe(false);
  expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
  for (const label of ['Title', 'Artist', 'Date', 'Accession number', 'Medium', 'Credit line']) expect(screen.getByText(label)).toBeOnTheScreen();
});
