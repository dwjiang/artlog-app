import { waitFor } from '@testing-library/react-native';
import { ConvexError } from 'convex/values';

import type { Id } from '../../../convex/_generated/dataModel';
import type { LabelFlowDisplay } from '../../../convex/lib/validators';
import { contributionPayload } from '../../../shared/attested-payloads';
import { contributeLabel, contributionErrorMessage, uploadCrop } from './contribute';
import { clearLabelDraft, loadLabelDraft } from './draft';
import { formStateFromFlow, setFieldValue, unlockField } from './fields';
import { handOffLabelRejection } from '@/lib/result/feedback';

const mockMutation = jest.fn();
const mockQuery = jest.fn();
let mockStoredFlow: LabelFlowDisplay;
const mockAction = jest.fn();
const mockSign = jest.fn();
const mockVerify = jest.fn();
const mockResize = jest.fn();
const mockRemove = jest.fn();
const mockUpload = jest.fn();
const calls: string[] = [];

jest.mock('@/db/client', () => ({ db: jest.requireActual('@/db/test-db').createTestDatabase() }));

jest.mock('@/lib/convex-client', () => ({
  convex: {
    query: (fn: unknown, args: unknown) => mockQuery(jest.requireActual('convex/server').getFunctionName(fn), args),
    mutation: (fn: unknown, args: unknown) => mockMutation(jest.requireActual('convex/server').getFunctionName(fn), args),
    action: (fn: unknown, args: unknown) => mockAction(jest.requireActual('convex/server').getFunctionName(fn), args),
  },
}));
jest.mock('@/lib/attested-write', () => ({ signPayload: (payload: unknown) => mockSign(payload) }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: (path: string) => `file:///documents/${path}` }));
jest.mock('./crop', () => ({ resizeCropForContribution: (uri: string) => mockResize(uri), removeFile: (uri: string) => mockRemove(uri) }));
jest.mock('./label-deps', () => ({ labelApi: { verifyLabel: (args: unknown) => mockVerify(args) } }));
jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0 },
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    upload(url: string, options: unknown) { return mockUpload(this.uri, url, options); }
  },
}));

const scanId = 'scan-1' as Id<'scans'>;
const feedbackId = 'fb-1' as Id<'feedback'>;
const capture = { cropPath: 'crops/c1.jpg', descriptors: new ArrayBuffer(64), keypoints: new ArrayBuffer(32) };
const flow: LabelFlowDisplay = {
  stage: 'verified', evidence: ['wikidata'], warnings: [], moderation: 'clear', updatedAt: 1,
  fields: {
    title: { value: 'Water Lilies', evidence: 'wikidata', locked: true },
    artist: { value: 'Claude Monet', evidence: 'wikidata', locked: true },
    date: { value: '1916', evidence: 'ocr', locked: false },
  },
};
const submitted = { title: { value: 'Water Lilies', edited: false }, artist: { value: 'Claude Monet', edited: false }, date: { value: '1916', edited: false } };

beforeEach(async () => {
  jest.resetAllMocks();
  await clearLabelDraft(scanId);
  calls.length = 0;
  mockStoredFlow = flow;
  mockQuery.mockImplementation(async () => { calls.push('scans:get'); return { labelFlow: mockStoredFlow }; });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockResize.mockImplementation(async () => { calls.push('resize'); return { uri: 'file:///cache/crop-256.jpg', width: 256, height: 256 }; });
  mockMutation.mockImplementation(async (name: string) => {
    calls.push(name);
    if (name === 'contributions:requestCropUpload') return { uploadUrl: 'https://upload.example/crop' };
    return null;
  });
  mockUpload.mockImplementation(async () => { calls.push('upload'); return { status: 200, headers: {}, body: JSON.stringify({ storageId: 'st-1' }) }; });
  mockSign.mockImplementation(async () => { calls.push('sign'); return { nonce: 'nonce-1', assertionBase64: 'sig', payloadJson: 'p' }; });
  mockAction.mockImplementation(async (name: string) => { calls.push(name); return { contributionId: 'contrib-1', status: 'private' }; });
  mockVerify.mockImplementation(async () => { calls.push('verify'); return flow; });
});
afterEach(() => jest.restoreAllMocks());

it('uploads the 256 px crop, signs the exact fields and contributes the capture’s own features', async () => {
  handOffLabelRejection(scanId, Promise.resolve(feedbackId));
  const result = await contributeLabel({ scanId, capture, state: formStateFromFlow(flow) });
  expect(result).toEqual({ contributionId: 'contrib-1', status: 'private' });
  expect(calls).toEqual(['scans:get', 'resize', 'contributions:requestCropUpload', 'upload', 'sign', 'contributions:contribute', 'feedback:resolveRejection']);
  expect(mockVerify).not.toHaveBeenCalled();
  expect(mockResize).toHaveBeenCalledWith('file:///documents/crops/c1.jpg');
  expect(mockUpload).toHaveBeenCalledWith('file:///cache/crop-256.jpg', 'https://upload.example/crop', {
    httpMethod: 'POST', uploadType: 0, headers: { 'Content-Type': 'image/jpeg' },
  });
  expect(mockSign).toHaveBeenCalledWith(contributionPayload({ scanId, cropStorageId: 'st-1', fields: submitted }));
  expect(mockAction).toHaveBeenCalledWith('contributions:contribute', {
    scanId, descriptors: capture.descriptors, keypoints: capture.keypoints, fields: submitted, cropStorageId: 'st-1',
    consent: true, nonce: 'nonce-1', assertionBase64: 'sig',
  });
  expect(mockMutation).toHaveBeenCalledWith('feedback:resolveRejection', { feedbackId, resolution: { kind: 'label', contributionId: 'contrib-1' } });
  expect(mockRemove).toHaveBeenCalledWith('file:///cache/crop-256.jpg');
});

it('re-verifies edited values first and flags the edited fields; no rejection means no resolution', async () => {
  const state = setFieldValue(unlockField(formStateFromFlow(flow), 'title'), 'date', '1916–19');
  await contributeLabel({ scanId, capture, state });
  expect(calls.slice(0, 2)).toEqual(['scans:get', 'verify']);
  expect(mockVerify).toHaveBeenCalledWith({ scanId, fields: { title: 'Water Lilies', artist: 'Claude Monet', date: '1916–19' } });
  expect(mockAction).toHaveBeenCalledWith('contributions:contribute', expect.objectContaining({
    fields: { title: { value: 'Water Lilies', edited: true }, artist: { value: 'Claude Monet', edited: false }, date: { value: '1916–19', edited: true } },
  }));
  expect(mockMutation).not.toHaveBeenCalledWith('feedback:resolveRejection', expect.anything());
});

it('needs a title and an artist, an attestable device and a successful upload', async () => {
  await expect(contributeLabel({ scanId, capture, state: setFieldValue(formStateFromFlow(flow), 'artist', '') }))
    .rejects.toThrow('A title and an artist are required to share');
  mockSign.mockResolvedValue(null);
  await expect(contributeLabel({ scanId, capture, state: formStateFromFlow(flow) })).rejects.toThrow('This device can’t share contributions yet');
  expect(mockAction).not.toHaveBeenCalled();
  expect(mockRemove).toHaveBeenCalledWith('file:///cache/crop-256.jpg');
  mockUpload.mockResolvedValue({ status: 413, headers: {}, body: '' });
  await expect(uploadCrop('https://upload.example/crop', 'file:///cache/crop-256.jpg')).rejects.toThrow('Crop upload failed with HTTP 413');
});

it('keeps the contribution when resolving the rejection fails', async () => {
  handOffLabelRejection(scanId, Promise.resolve(feedbackId));
  mockMutation.mockImplementation(async (name: string) => {
    if (name === 'contributions:requestCropUpload') return { uploadUrl: 'https://upload.example/crop' };
    throw new ConvexError({ code: 'invalid_resolution' });
  });
  await expect(contributeLabel({ scanId, capture, state: formStateFromFlow(flow) })).resolves.toEqual({ contributionId: 'contrib-1', status: 'private' });
  await waitFor(() => expect(console.warn).toHaveBeenCalledWith('Could not resolve the rejection with this contribution', expect.any(ConvexError)));
});

it('re-verifies reverted fields after an earlier upload failed', async () => {
  mockVerify.mockImplementation(async (args) => {
    mockStoredFlow = { ...flow, fields: { ...flow.fields, date: { ...flow.fields.date!, value: args.fields.date } } };
    return mockStoredFlow;
  });
  mockAction.mockImplementation(async (_name, args) => {
    if (args.fields.date.value !== mockStoredFlow.fields.date?.value) throw new ConvexError({ code: 'field_mismatch', field: 'date' });
    return { contributionId: 'contrib-1', status: 'private' };
  });
  const original = formStateFromFlow(flow);
  mockUpload.mockResolvedValueOnce({ status: 503, headers: {}, body: '' });
  await expect(contributeLabel({ scanId, capture, state: setFieldValue(original, 'date', '1917') })).rejects.toThrow('HTTP 503');
  await expect(contributeLabel({ scanId, capture, state: original })).resolves.toMatchObject({ status: 'private' });
  expect(mockVerify).toHaveBeenCalledTimes(2);
  expect(mockVerify).toHaveBeenLastCalledWith({ scanId, fields: { title: 'Water Lilies', artist: 'Claude Monet', date: '1916' } });
});

it('keeps edits marked as user edits when reopening after an upload failure', async () => {
  const state = setFieldValue(unlockField(formStateFromFlow(flow), 'title'), 'date', '1917');
  mockVerify.mockImplementation(async (args) => {
    expect(await loadLabelDraft(scanId)).toEqual(state);
    mockStoredFlow = { ...flow, fields: { ...flow.fields, date: { ...flow.fields.date!, value: args.fields.date } } };
    return mockStoredFlow;
  });
  mockUpload.mockResolvedValueOnce({ status: 503, headers: {}, body: '' });
  await expect(contributeLabel({ scanId, capture, state })).rejects.toThrow('HTTP 503');
  const reopened = (await loadLabelDraft(scanId)) ?? formStateFromFlow(mockStoredFlow);
  await contributeLabel({ scanId, capture, state: reopened });
  expect(mockVerify).toHaveBeenCalledTimes(1);
  expect(mockAction).toHaveBeenLastCalledWith('contributions:contribute', expect.objectContaining({
    fields: expect.objectContaining({
      title: { value: 'Water Lilies', edited: true }, date: { value: '1917', edited: true },
    }),
  }));
});

it('keeps museum sharing edits tied to their confirmation before verification replaces its fields', async () => {
  const state = setFieldValue(unlockField(formStateFromFlow(flow), 'title'), 'title', 'My title');
  mockVerify.mockImplementation(async () => {
    expect(await loadLabelDraft(scanId, 2)).toEqual(state);
    expect(await loadLabelDraft(scanId)).toBeUndefined();
    return { ...flow, updatedAt: 3 };
  });
  mockUpload.mockResolvedValueOnce({ status: 503, headers: {}, body: '' });
  await expect(contributeLabel({ scanId, capture, state, museumSearchUpdatedAt: 2 })).rejects.toThrow('HTTP 503');
  expect(await loadLabelDraft(scanId, 2)).toEqual(state);
  expect(await loadLabelDraft(scanId, 3)).toBeUndefined();
});

it.each([
  [new ConvexError({ code: 'rate_limited' }), 'Try again in a minute'],
  [new ConvexError({ code: 'field_mismatch', field: 'title' }), 'Verify the label again before sharing'],
  [new ConvexError({ code: 'invalid_scan' }), 'This scan isn’t tied to a museum, so it can’t be shared'],
  [new Error('Network request failed'), 'No connection — try sharing when you’re back online'],
  [new Error('This device can’t share contributions yet'), 'This device can’t share contributions yet'],
  [new ConvexError({ code: 'contribution_busy' }), 'Couldn’t share this work right now'],
])('maps %s to a sharing message', (error, message) => {
  expect(contributionErrorMessage(error)).toBe(message);
});
