import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { getSetting, setSetting } from '@/db/repos/settings';
import { DevTimings } from '@/components/scan/dev-timings';
import { DevTools } from './dev-tools';

const mockSignPayload = jest.fn();
const mockAssertSmoke = jest.fn();
const mockGetAppAttest = jest.fn();
const mockWarmUp = jest.fn();
const mockRunCalibrationExport = jest.fn();
const mockRunOrbParityCheck = jest.fn();

jest.mock('@expo/ui');
jest.mock('@expo/ui/swift-ui');
jest.mock('@/hooks/use-screen-active', () => ({ useScreenActive: () => true }));
jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('convex/react', () => ({ useMutation: () => mockAssertSmoke }));
jest.mock('@/lib/app-attest', () => ({ getAppAttest: () => mockGetAppAttest() }));
jest.mock('@/lib/attested-write', () => ({ signPayload: (...args: unknown[]) => mockSignPayload(...args) }));
jest.mock('@/lib/embed/embedder', () => ({ embedder: { warmUp: () => mockWarmUp() } }));
jest.mock('@/lib/embed/run-calibration-export', () => ({
  runCalibrationExport: (...args: unknown[]) => mockRunCalibrationExport(...args),
}));
jest.mock('@/lib/orb/run-parity-check', () => ({ runOrbParityCheck: () => mockRunOrbParityCheck() }));

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

it('runs the ORB parity check and reports the row agreement, timings and triage metrics', async () => {
  let finish!: (value: unknown) => void;
  mockRunOrbParityCheck.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check ORB parity' }));
  expect(screen.getByRole('button', { name: 'Checking ORB parity…' })).toBeDisabled();
  await act(async () => {
    finish({
      count: 500, expectedCount: 500, rowsInOrder: 312, rowsAnywhere: 494, extractMs: 9.84, triageMs: 3.06,
      blurVariance: 2047.2, glareFraction: 0.0004, device: 'iPhone17,1',
    });
  });
  expect(screen.getByText(
    'ORB: 500/500 keypoints · 494 rows match (312 in order) · extract 9.8 ms · blur 2047 · glare 0.0% · triage 3.1 ms · iPhone17,1',
  )).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check ORB parity' })).toBeEnabled();
});

it('shows ORB parity errors and makes the check available again', async () => {
  mockRunOrbParityCheck.mockRejectedValue(new Error('The ORB parity fixture is not bundled'));
  await render(<DevTools attested />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check ORB parity' }));
  expect(screen.getByText('The ORB parity fixture is not bundled')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check ORB parity' })).toBeEnabled();
});

it('persists the timings switch and hides capture timings when returning to the scan', async () => {
  await setSetting('dev-timings', 'true');
  const view = await render(<DevTools attested />);
  const toggle = await screen.findByRole('switch', { name: 'Show capture timings' });
  expect(toggle).toBeChecked();
  await fireEvent.press(toggle);
  expect(await getSetting('dev-timings')).toBe('false');
  await view.unmount();
  const scan = await render(<DevTimings timings={{ total: 200, warp: 100 }} />);
  expect(scan.toJSON()).toBeNull();
});
