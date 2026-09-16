import { waitFor } from '@testing-library/react-native';
import { ConvexError } from 'convex/values';
import { createVisitSharingController } from './visit-sharing-controller';
import type { SharePreview, ShareState, VisitSharingTransport } from './visit-sharing-transport';
import { captureOwner, subscribeOwner, switchOwner } from '../account/owner-store';
const initial: ShareState = { status: 'private', postId: null, removed: false, reflection: '', saveLocalIds: [], revision: 0 };
const preview: SharePreview = { author: { name: 'Reader', username: 'reader' } as SharePreview['author'], venue: { venueId: 'museum' as never, name: 'Museum' },
  visitedOn: '2024-02-29', reflection: 'For friends', artworks: [] };
const transport = { getState: jest.fn(), preview: jest.fn(), publish: jest.fn(), get: jest.fn(), unshare: jest.fn() } satisfies VisitSharingTransport;
const flush = jest.fn();
let controller: ReturnType<typeof createVisitSharingController>;
let ids: string[];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks(); switchOwner('account:a', 'scope-a');
  ids = Array.from({ length: 60 }, (_, i) => `save-${i}`);
  transport.getState.mockResolvedValue(initial); transport.preview.mockResolvedValue(preview);
  transport.publish.mockResolvedValue({ ...initial, status: 'active', postId: 'post', revision: 1 });
  transport.unshare.mockResolvedValue({ ...initial, revision: 2 }); flush.mockResolvedValue(undefined);
  controller = createVisitSharingController({ visitLocalId: 'visit', saveLocalIds: () => ids, transport, flush,
    capture: () => ({ ...captureOwner(), token: 'token' }), subscribeOwner }); controller.connect();
});
afterEach(() => controller.dispose());
it('selects at most 50 artworks, starts with no shared reflection, and allows zero', async () => {
  await controller.load();
  expect(controller.getSnapshot().draft?.saveLocalIds).toHaveLength(50);
  expect(controller.getSnapshot().draft?.reflection).toBe('');
  controller.edit({ saveLocalIds: [], reflection: 'For friends' });
  await controller.preview(); await controller.publish();
  expect(transport.publish).toHaveBeenCalledWith({ visitLocalId: 'visit', saveLocalIds: [], reflection: 'For friends', revision: 0, photoSelections: [], highlightLocalIds: [] }, expect.anything());
  expect(controller.getSnapshot().success).toBe('published');
});
it('flushes before every request and sends no request when sync fails', async () => {
  flush.mockRejectedValueOnce(new Error('offline'));
  expect(await controller.load()).toBe(false); expect(transport.getState).not.toHaveBeenCalled();
  const gate = deferred<void>(); flush.mockReturnValueOnce(gate.promise);
  const load = controller.load(); expect(transport.getState).not.toHaveBeenCalled(); gate.resolve(); await load;
  expect(transport.getState).toHaveBeenCalledTimes(1);
});
it('preserves selection and reflection on network failure without reporting success', async () => {
  await controller.load(); controller.edit({ saveLocalIds: ['save-2'], reflection: 'My draft' }); await controller.preview();
  transport.publish.mockRejectedValueOnce(new Error('Network request failed'));
  expect(await controller.publish()).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ success: undefined, draft: { saveLocalIds: ['save-2'], reflection: 'My draft' } });
  expect(controller.getSnapshot().preview).not.toBeNull();
});
it('requires a fresh preview after a conflict while preserving the draft', async () => {
  await controller.load(); controller.edit({ saveLocalIds: [], reflection: 'Keep this' }); await controller.preview();
  transport.publish.mockRejectedValueOnce(new ConvexError({ code: 'conflict' })); await controller.publish();
  expect(controller.getSnapshot()).toMatchObject({ conflict: true, preview: null, success: undefined });
  await controller.publish(); expect(transport.publish).toHaveBeenCalledTimes(1);
  transport.getState.mockResolvedValueOnce({ ...initial, revision: 7, reflection: 'Other device' });
  await controller.preview(); await controller.publish();
  expect(transport.publish).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 7, reflection: 'Keep this' }), expect.anything());
});
it('aborts and clears private state on account changes and discards a late mutation acknowledgement', async () => {
  await controller.load(); await controller.preview();
  const gate = deferred<ShareState>(); transport.publish.mockReturnValueOnce(gate.promise);
  const publish = controller.publish(); await waitFor(() => expect(transport.publish).toHaveBeenCalled());
  const signal = transport.publish.mock.calls[0][1].signal;
  switchOwner('account:b', 'scope-b');
  expect(signal.aborted).toBe(true);
  gate.resolve({ ...initial, status: 'active', revision: 1 });
  expect(await publish).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ acknowledged: null, draft: null, preview: null, busy: false });
});
it('blocks publishing an edited selection until another preview is ready', async () => {
  await controller.load(); await controller.preview(); controller.edit({ reflection: 'changed' });
  expect(await controller.publish()).toBe(false); expect(transport.publish).not.toHaveBeenCalled();
  controller.edit({ saveLocalIds: ['foreign-save'] });
  expect(controller.getSnapshot().draft?.saveLocalIds).not.toContain('foreign-save');
});
it('loads an existing share for editing and waits for acknowledged unsharing', async () => {
  transport.getState.mockResolvedValue({ ...initial, postId: 'post', status: 'active', saveLocalIds: ['save-1'], reflection: 'Already shared', revision: 3 });
  await controller.load(); expect(controller.getSnapshot().draft).toMatchObject({ saveLocalIds: ['save-1'], reflection: 'Already shared', revision: 3 });
  const gate = deferred<ShareState>(); transport.unshare.mockReturnValueOnce(gate.promise);
  const request = controller.unshare(); await Promise.resolve();
  expect(controller.getSnapshot().acknowledged?.status).toBe('active'); expect(controller.getSnapshot().success).toBeUndefined();
  gate.resolve({ ...initial, revision: 4 }); await request;
  expect(controller.getSnapshot().success).toBe('unshared');
});
it('surfaces profile requirements and refuses anonymous sharing', async () => {
  transport.getState.mockRejectedValueOnce(new ConvexError({ code: 'profile_required' })); await controller.load();
  expect(controller.getSnapshot().profileRequired).toBe(true);
  switchOwner('device:guest', 'guest'); await controller.load(); expect(transport.getState).toHaveBeenCalledTimes(1);
});
it('reads all artwork pages of a shared visit', async () => {
  transport.getState.mockResolvedValue({ ...initial, postId: 'post', status: 'active' });
  transport.get.mockResolvedValueOnce({ ...preview, artworks: { page: [{ itemId: 'one' }], isDone: false, cursor: 'next' } });
  transport.get.mockResolvedValueOnce({ ...preview, artworks: { page: [{ itemId: 'two' }], isDone: true, cursor: null } });
  await controller.view();
  expect(controller.getSnapshot().shared?.artworks.page.map((item) => item.itemId)).toEqual(['one', 'two']);
});
