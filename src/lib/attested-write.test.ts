import { signPayload } from './attested-write';

const mockGetItem = jest.fn();
const mockMutation = jest.fn();
const mockAssertion = jest.fn();
const mockGetAppAttest = jest.fn();

jest.mock('@/lib/installation-storage', () => ({
  installationStorage: { getItem: (...args: unknown[]) => mockGetItem(...args) },
}));
jest.mock('@/lib/convex-client', () => ({ convex: { mutation: (...args: unknown[]) => mockMutation(...args) } }));
jest.mock('@/lib/app-attest', () => ({
  APP_ATTEST_KEY_ID: 'appAttestKeyId',
  getAppAttest: () => mockGetAppAttest(),
}));
jest.mock('../../convex/_generated/api', () => ({ api: { devices: { createChallenge: 'challenge' } } }));

beforeEach(() => {
  jest.resetAllMocks();
  mockGetItem.mockResolvedValue('saved-key');
  mockMutation.mockResolvedValue({ nonce: 'server-nonce' });
  mockAssertion.mockResolvedValue('base64-assertion');
  mockGetAppAttest.mockReturnValue({ generateAssertion: mockAssertion });
});

it('signs the stored key with the exact nonce.payloadJson contract', async () => {
  expect(await signPayload({ z: 2, a: { c: 1 } })).toEqual({
    nonce: 'server-nonce', assertionBase64: 'base64-assertion', payloadJson: '{"a":{"c":1},"z":2}',
  });
  expect(mockGetItem).toHaveBeenCalledWith('appAttestKeyId');
  expect(mockMutation).toHaveBeenCalledWith('challenge', { purpose: 'assert' });
  expect(mockAssertion).toHaveBeenCalledWith('saved-key', 'server-nonce.{"a":{"c":1},"z":2}');
});

it('returns null only for unsupported devices without requesting a challenge', async () => {
  mockGetAppAttest.mockReturnValue(null);
  expect(await signPayload({ a: 1 })).toBeNull();
  expect(mockGetItem).not.toHaveBeenCalled();
  expect(mockMutation).not.toHaveBeenCalled();
});

it('requires a saved key before requesting a challenge', async () => {
  mockGetItem.mockResolvedValue(null);
  await expect(signPayload({})).rejects.toThrow('Device attestation is not ready');
  expect(mockMutation).not.toHaveBeenCalled();
});

it.each(['keychain', 'challenge', 'assertion'])('propagates %s errors instead of returning an unsigned fallback', async (stage) => {
  const call = stage === 'keychain' ? mockGetItem : stage === 'challenge' ? mockMutation : mockAssertion;
  call.mockRejectedValueOnce(new Error('unavailable'));
  await expect(signPayload({})).rejects.toThrow('unavailable');
  if (stage !== 'assertion') expect(mockAssertion).not.toHaveBeenCalled();
});

it('snapshots the payload before waiting for a challenge', async () => {
  const payload = { value: 1 };
  mockMutation.mockImplementation(async () => {
    payload.value = 2;
    return { nonce: 'server-nonce' };
  });
  expect((await signPayload(payload))?.payloadJson).toBe('{"value":1}');
  expect(mockAssertion).toHaveBeenCalledWith('saved-key', 'server-nonce.{"value":1}');
});

it('rejects non-JSON payloads before contacting the server', async () => {
  await expect(signPayload({ value: BigInt(1) })).rejects.toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
});
