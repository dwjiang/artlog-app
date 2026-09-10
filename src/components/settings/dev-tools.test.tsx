import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { DevTools } from './dev-tools';

const mockSignPayload = jest.fn();
const mockAssertSmoke = jest.fn();
const mockGetAppAttest = jest.fn();
const mockWarmUp = jest.fn();
const mockRunCalibrationExport = jest.fn();

jest.mock('@expo/ui', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Host: View,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => (
      <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock('convex/react', () => ({ useMutation: () => mockAssertSmoke }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/app-attest', () => ({ getAppAttest: () => mockGetAppAttest() }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (...args: unknown[]) => mockSignPayload(...args) }));
jest.mock('@/lib/embed/embedder', () => ({ embedder: { warmUp: () => mockWarmUp() } }));
jest.mock('@/lib/embed/run-calibration-export', () => ({
  runCalibrationExport: (...args: unknown[]) => mockRunCalibrationExport(...args),
}));

beforeEach(() => {
  jest.resetAllMocks();
  mockGetAppAttest.mockReturnValue({});
  mockSignPayload.mockResolvedValue({ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' });
  mockWarmUp.mockResolvedValue({ loadMs: 4100.4, predictMs: 66.2, alreadyLoaded: false });
});

it('shows accepted and rejected replay results using the exact same signed request', async () => {
  mockAssertSmoke.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check App Attest' }));
  expect(screen.getByText('Assertion: accepted · Replay: rejected')).toBeOnTheScreen();
  expect(mockSignPayload).toHaveBeenCalledTimes(1);
  expect(mockAssertSmoke.mock.calls).toEqual([
    [{ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' }],
    [{ nonce: 'nonce', assertionBase64: 'assertion', payloadJson: '{}' }],
  ]);
});

it('disables the check while registration is pending and on unsupported devices', async () => {
  const result = await render(<DevTools attested={false} />);
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeDisabled();
  mockGetAppAttest.mockReturnValue(null);
  await result.rerender(<DevTools attested />);
  expect(screen.getByText('App Attest: unsupported on this device')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeDisabled();
  expect(mockSignPayload).not.toHaveBeenCalled();
});

it('shows signing errors and makes the check available again', async () => {
  mockSignPayload.mockRejectedValue(new Error('Device key unavailable'));
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check App Attest' }));
  expect(screen.getByText('Device key unavailable')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check App Attest' })).toBeEnabled();
  expect(mockAssertSmoke).not.toHaveBeenCalled();
});

it('shows the embedding model load and prediction times once the warm-up finishes', async () => {
  await render(<DevTools attested />);
  expect(await screen.findByText('Embedding model: ready · load 4100 ms · predict 66 ms')).toBeOnTheScreen();
  mockWarmUp.mockRejectedValue(new Error('The CoreML model asset is missing from this build'));
  await render(<DevTools attested />);
  expect(await screen.findByText('Embedding model: The CoreML model asset is missing from this build')).toBeOnTheScreen();
});

it('exports the calibration embeddings, showing progress while it runs and the report after', async () => {
  let finish!: (value: unknown) => void;
  mockRunCalibrationExport.mockImplementation((onProgress: (done: number, total: number) => void) =>
    new Promise((resolve) => {
      onProgress(1, 2);
      finish = resolve;
    }),
  );
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export calibration embeddings' }));
  expect(screen.getByRole('button', { name: 'Exporting calibration 1/2…' })).toBeDisabled();
  await act(async () => {
    finish({ fileUri: 'file:///cache/calibration/iphone-embeddings.json', report: { count: 2, embedMedianMs: 66.44, device: 'iPhone17,1' } });
  });
  expect(screen.getByText('Calibration: 2 embeddings · median 66.4 ms · iPhone17,1')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Export calibration embeddings' })).toBeEnabled();
  expect(mockRunCalibrationExport).toHaveBeenCalledTimes(1);
});

it('shows calibration export errors and makes the export available again', async () => {
  mockRunCalibrationExport.mockRejectedValue(new Error('Expected a 512×512 crop, got 640×480'));
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Export calibration embeddings' }));
  expect(screen.getByText('Expected a 512×512 crop, got 640×480')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Export calibration embeddings' })).toBeEnabled();
});
