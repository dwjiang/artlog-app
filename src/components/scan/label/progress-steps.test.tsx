import { render, screen } from '@testing-library/react-native';

import { ProgressSteps, STEP_LABELS } from './progress-steps';

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

function status(label: string) {
  const { checked, busy } = screen.getByLabelText(label).props.accessibilityState as { checked: boolean; busy: boolean };
  return checked ? 'done' : busy ? 'active' : 'pending';
}

it('walks the photo path: reading first, the three checks together, images last', async () => {
  const view = await render(<ProgressSteps stage="read" qr={false} />);
  expect(status(STEP_LABELS.read)).toBe('active');
  expect(status(STEP_LABELS.records)).toBe('pending');
  expect(status(STEP_LABELS.images)).toBe('pending');
  expect(screen.queryByLabelText(STEP_LABELS.qr)).toBeNull();
  await view.rerender(<ProgressSteps stage="verify" qr={false} />);
  expect(status(STEP_LABELS.read)).toBe('done');
  expect([STEP_LABELS.records, STEP_LABELS.wikidata, STEP_LABELS.web].map(status)).toEqual(['active', 'active', 'active']);
  expect(status(STEP_LABELS.images)).toBe('pending');
  await view.rerender(<ProgressSteps stage="image-check" qr={false} />);
  expect([STEP_LABELS.read, STEP_LABELS.records, STEP_LABELS.web].map(status)).toEqual(['done', 'done', 'done']);
  expect(status(STEP_LABELS.images)).toBe('active');
});

it('names the museum page fetch on the QR path', async () => {
  await render(<ProgressSteps stage="qr" qr />);
  expect(status(STEP_LABELS.qr)).toBe('active');
  expect(screen.queryByLabelText(STEP_LABELS.read)).toBeNull();
});
