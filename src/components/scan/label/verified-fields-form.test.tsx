import { fireEvent, render, screen } from '@testing-library/react-native';

import type { LabelFlowDisplay } from '../../../../convex/lib/validators';

import { VerifiedFieldsForm } from './verified-fields-form';
import { formStateFromFlow, unlockField } from '@/lib/label/fields';

jest.mock('@/components/collection/gallery-button');
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

it('allows direct editing and downgrades verified evidence before applying an edit', async () => {
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable {...handlers} />);
  expect(screen.getByLabelText('Title').props.editable).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Nymphéas');
  expect(handlers.onUnlock).toHaveBeenCalledWith('title');
  expect(handlers.onChange).toHaveBeenCalledWith('title', 'Nymphéas');
  expect(handlers.onUnlock.mock.invocationCallOrder[0]).toBeLessThan(handlers.onChange.mock.invocationCallOrder[0]);
});

it('keeps verified evidence while the typed value still matches the verified one', async () => {
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={[]} editable {...handlers} />);
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Water Lilies ');
  expect(handlers.onUnlock).not.toHaveBeenCalled();
  expect(handlers.onChange).toHaveBeenCalledWith('title', 'Water Lilies ');
});

it('edits an already unlocked field without downgrading it again', async () => {
  await render(<VerifiedFieldsForm state={unlockField(formStateFromFlow(flow), 'title')} warnings={[]} editable {...handlers} />);
  await fireEvent.changeText(screen.getByLabelText('Title'), 'Nymphéas');
  expect(handlers.onUnlock).not.toHaveBeenCalled();
  expect(handlers.onChange).toHaveBeenCalledWith('title', 'Nymphéas');
});

it('shows plausibility warnings and freezes everything when not editable', async () => {
  await render(<VerifiedFieldsForm state={formStateFromFlow(flow)} warnings={flow.warnings} editable={false} {...handlers} />);
  expect(screen.getByRole('alert')).toHaveTextContent('The date is outside the artist’s lifespan — please check');
  expect(screen.getByLabelText('Date').props.editable).toBe(false);
  expect(screen.queryByRole('button', { name: 'Edit Title' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'More details' }));
  for (const label of ['Title', 'Artist', 'Date', 'Accession number', 'Medium', 'Credit line']) expect(screen.getByText(label)).toBeOnTheScreen();
});

it('keeps optional catalog details available without crowding the main review', async () => {
  const state = formStateFromFlow({ ...flow, fields: { ...flow.fields, accession: { value: 'A-42', evidence: 'ocr', locked: false } } });
  await render(<VerifiedFieldsForm state={state} warnings={[]} editable {...handlers} />);
  expect(screen.queryByLabelText('Accession number')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'More details' }));
  expect(screen.getByLabelText('Accession number').props.defaultValue).toBe('A-42');
  await fireEvent.changeText(screen.getByLabelText('Accession number'), 'A-43');
  expect(handlers.onChange).toHaveBeenCalledWith('accession', 'A-43');
});
