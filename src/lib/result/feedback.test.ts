import { getFunctionName } from 'convex/server';

import type { Id } from '../../../convex/_generated/dataModel';
import { handOffLabelRejection, rejectMatch, resolveWithLabel, resolveWithRunnerUp } from './feedback';

const mockSign = jest.fn();
jest.mock('@/lib/attested-write', () => ({ signPayload: (payload: unknown) => mockSign(payload) }));

const mutation = jest.fn();
const client = { mutation: (fn: unknown, args: unknown) => mutation(getFunctionName(fn as never), args) };
const scanId = 'scan-1' as Id<'scans'>;
const objectId = 'obj-1' as Id<'objects'>;

beforeEach(() => {
  jest.resetAllMocks();
  mockSign.mockResolvedValue({ nonce: 'n', assertionBase64: 'a', payloadJson: 'p' });
  mutation.mockResolvedValue({ feedbackId: 'fb-1' });
});

it('signs the shared rejection payload and sends the attested mutation', async () => {
  await expect(rejectMatch(client as never, scanId, objectId)).resolves.toBe('fb-1');
  expect(mockSign).toHaveBeenCalledWith('{"objectId":"obj-1","operation":"rejectMatch","scanId":"scan-1"}');
  expect(mutation).toHaveBeenCalledWith('feedback:rejectMatch', { scanId, objectId, nonce: 'n', assertionBase64: 'a' });
});

it('returns null without a mutation when the device cannot attest', async () => {
  mockSign.mockResolvedValue(null);
  await expect(rejectMatch(client as never, scanId, objectId)).resolves.toBeNull();
  expect(mutation).not.toHaveBeenCalled();
});

it('resolves a rejection with the picked runner-up', async () => {
  mutation.mockResolvedValue(null);
  await resolveWithRunnerUp(client as never, 'fb-1' as Id<'feedback'>, objectId);
  expect(mutation).toHaveBeenCalledWith('feedback:resolveRejection', { feedbackId: 'fb-1', resolution: { kind: 'runner_up', objectId } });
});

it('resolves a handed-over rejection even when the contribution finishes first', async () => {
  let finish!: (id: Id<'feedback'>) => void;
  handOffLabelRejection(scanId, new Promise((resolve) => { finish = resolve; }));
  expect(resolveWithLabel(client as never, scanId, 'contrib-1' as Id<'contributions'>)).toBeUndefined();
  expect(mutation).not.toHaveBeenCalled();
  finish('fb-1' as Id<'feedback'>);
  await Promise.resolve();
  expect(mutation).toHaveBeenCalledWith('feedback:resolveRejection', {
    feedbackId: 'fb-1', resolution: { kind: 'label', contributionId: 'contrib-1' },
  });
  resolveWithLabel(client as never, scanId, 'contrib-1' as Id<'contributions'>);
  await Promise.resolve();
  expect(mutation).toHaveBeenCalledTimes(1);
});
