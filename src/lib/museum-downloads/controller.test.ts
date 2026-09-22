import { MuseumDownloadsController, type DownloadDependencies } from './controller';
import type { MuseumManifest } from '@/shared/offline/types';
import { downloadProgress, sortMuseums } from './model';

const pack: MuseumManifest = { id: 'museum-1' as never, key: 'one', name: 'Art Institute of Chicago', city: 'Chicago', lat: 1, lng: 1,
  version: 'v1', modelVersion: 'model', size: 3000, count: 2, previews: [], chunks: [0, 1, 2].map(n => ({ url: `https://file/${n}`, size: 1000, sha256: 'hash' })) };
function fixture() {
  let saved: Parameters<DownloadDependencies['write']>[0] | undefined;
  const deps = {
    read: jest.fn(async () => saved && structuredClone(saved)),
    write: jest.fn(async value => { saved = structuredClone(value); }),
    catalog: jest.fn(async () => [pack]), manifest: jest.fn(async () => pack), online: jest.fn(async (): Promise<boolean> => true),
    folder: jest.fn(value => `${value.id}-${value.version}`), download: jest.fn(async () => {}), previews: jest.fn(async () => {}),
    remove: jest.fn(), availableBytes: () => 1_000_000_000,
  } satisfies DownloadDependencies;
  return { deps, controller: new MuseumDownloadsController(deps) };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function waitFor(fn: () => boolean) { for (let i = 0; i < 50 && !fn(); i++) await Promise.resolve(); expect(fn()).toBe(true); }

it('only becomes ready after all chunks and previews have been persisted, including across a restart', async () => {
  const { controller, deps } = fixture();
  const preview = deferred(); deps.previews.mockImplementation(() => preview.promise);
  const running = controller.start(pack);
  await waitFor(() => deps.previews.mock.calls.length === 1);
  expect(controller.getSnapshot().downloads[pack.id].status).toBe('downloading');
  expect(downloadProgress(controller.getSnapshot().downloads[pack.id])).toBe(99);
  preview.resolve(); await running;
  const restarted = new MuseumDownloadsController(deps); await restarted.hydrate();
  expect(restarted.getSnapshot().downloads[pack.id]).toMatchObject({ status: 'ready', active: { manifest: pack }, completed: 3 });
});
it('pauses an in-flight transfer and resumes from the last completed chunk', async () => {
  const { controller, deps } = fixture(); const part = deferred();
  deps.download.mockImplementationOnce(async () => {}).mockImplementationOnce(() => part.promise);
  const running = controller.start(pack);
  await waitFor(() => deps.download.mock.calls.length === 2);
  await controller.pause(pack.id); part.resolve(); await running;
  expect(controller.getSnapshot().downloads[pack.id]).toMatchObject({ status: 'paused', completed: 1 });
  await controller.start(pack);
  expect(deps.download.mock.calls.map(call => (call as unknown[])[1])).toEqual([0, 1, 1, 2]);
});
it('coalesces repeated download taps while checking connectivity', async () => {
  const { controller, deps } = fixture();
  const network = deferred();
  deps.online.mockImplementation(async () => { await network.promise; return true; });
  const first = controller.start(pack), second = controller.start(pack);
  network.resolve();
  await Promise.all([first, second]);
  expect(deps.manifest).toHaveBeenCalledTimes(1);
  expect(deps.download).toHaveBeenCalledTimes(3);
});
it('cancellation cannot be undone by an in-flight transfer finishing later', async () => {
  const { controller, deps } = fixture(); const part = deferred(); deps.download.mockImplementation(() => part.promise);
  const running = controller.start(pack); await waitFor(() => deps.download.mock.calls.length === 1);
  await controller.cancel(pack.id); part.resolve(); await running;
  expect(controller.getSnapshot().downloads[pack.id]).toBeUndefined();
  expect(deps.remove).toHaveBeenCalledWith('museum-1-v1');
});
it('failed updates keep the complete package usable; cancelling the update restores ready status', async () => {
  const { controller, deps } = fixture(); await controller.start(pack);
  deps.manifest.mockResolvedValue({ ...pack, version: 'v2' }); deps.download.mockRejectedValue(new Error('Connection lost'));
  expect(await controller.checkForUpdate(pack)).toBe(true);
  expect(controller.getSnapshot().downloads[pack.id]).toMatchObject({ status: 'paused', active: { manifest: { version: 'v1' } }, pending: { manifest: { version: 'v2' } } });
  await controller.cancel(pack.id);
  expect(controller.getSnapshot().downloads[pack.id]).toMatchObject({ status: 'ready', active: { manifest: { version: 'v1' } } });
  expect(deps.remove).not.toHaveBeenCalledWith('museum-1-v1');
});
it('a completed update swaps packages before cleaning up the previous version', async () => {
  const { controller, deps } = fixture(); await controller.start(pack);
  deps.manifest.mockResolvedValue({ ...pack, version: 'v2' });
  deps.remove.mockImplementation(() => { expect(controller.getSnapshot().downloads[pack.id].active?.manifest.version).toBe('v2'); });
  await controller.checkForUpdate(pack);
  expect(deps.remove).toHaveBeenCalledWith('museum-1-v1');
});
it('does not start offline, and insufficient space leaves a resumable download', async () => {
  const { controller, deps } = fixture(); deps.online.mockResolvedValue(false);
  await expect(controller.start(pack)).rejects.toThrow('Connect to download'); expect(deps.download).not.toHaveBeenCalled();
  deps.online.mockResolvedValue(true); deps.availableBytes = () => 0;
  await controller.start(pack);
  expect(controller.getSnapshot().downloads[pack.id]).toMatchObject({ status: 'paused', error: 'space', completed: 0 });
  expect(deps.download).not.toHaveBeenCalled();
});
it('reports lost connectivity instead of an empty catalog', async () => {
  const { controller, deps } = fixture(); deps.online.mockResolvedValue(false);
  await controller.refresh();
  expect(controller.getSnapshot()).toMatchObject({ catalog: [], loading: false, error: 'Connect to load museums.' });
  expect(deps.catalog).not.toHaveBeenCalled();
});
it('removes only the requested museum and retains other downloads and the catalog', async () => {
  const { controller, deps } = fixture(); await controller.refresh(); await controller.start(pack);
  const other = { ...pack, id: 'museum-2' as never }; deps.manifest.mockResolvedValue(other); await controller.start(other);
  await controller.remove(pack.id);
  expect(controller.getSnapshot().downloads[other.id].status).toBe('ready');
  expect(controller.getSnapshot().catalog).toEqual([pack]);
  expect(deps.remove.mock.calls).toEqual([['museum-1-v1']]);
});
it('filters names and cities and sorts by real size, name, or distance', () => {
  const other = { ...pack, id: 'museum-2' as never, name: 'Z Museum', city: 'Boston', size: 1, lat: 5, lng: 5 };
  expect(sortMuseums([other, pack], 'chicago', 'size')).toEqual([pack]);
  expect(sortMuseums([pack, other], '', 'size')).toEqual([other, pack]);
  expect(sortMuseums([other, pack], '', 'name')).toEqual([pack, other]);
  expect(sortMuseums([pack, other], '', 'nearest', { lat: 5, lng: 5 })).toEqual([other, pack]);
  expect(sortMuseums([other, pack], '', 'nearest')).toEqual([pack, other]);
});
