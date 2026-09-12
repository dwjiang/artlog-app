import type { Id } from '../../../convex/_generated/dataModel';
import { runMuseumSearch } from './flow';
import { runMuseumSearchForScan } from './museum-search-deps';
import { convex } from '@/lib/convex-client';
import { candidates, confirmed, verified } from './__fixtures__/search';
import { loadLabelDraft } from '@/lib/label/draft';
import { formStateFromFlow, setFieldValue } from '@/lib/label/fields';

jest.mock('./flow', () => ({ runMuseumSearch: jest.fn() }));
jest.mock('@/db/repos/pending-scans', () => ({ getPendingScan: jest.fn() }));
jest.mock('@/lib/convex-client', () => ({ convex: { action: jest.fn(), query: jest.fn(async () => null) } }));
jest.mock('@/lib/label/label-deps', () => ({ imageCheckDeps: {} }));
jest.mock('@/lib/files/photos', () => ({ captureFileUri: jest.fn() }));
jest.mock('@/lib/label/crop', () => ({ prepareMuseumSearchCrop: jest.fn() }));
jest.mock('@/lib/label/draft', () => ({ loadLabelDraft: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(convex.query).mockResolvedValue(null);
  jest.mocked(runMuseumSearch).mockResolvedValue({ stage: 'none', reason: 'no_candidates' });
});

it('shares an in-flight search across remounts, then allows a manual retry', async () => {
  let finish!: (outcome: Awaited<ReturnType<typeof runMuseumSearch>>) => void;
  jest.mocked(runMuseumSearch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const input = { scanId: 'scan-1' as Id<'scans'>, localId: 'capture-1', canContinue: () => true, onStage: jest.fn() };
  const first = runMuseumSearchForScan(input);
  const remounted = runMuseumSearchForScan({ ...input, onStage: jest.fn() });
  expect(remounted).toBe(first);
  await Promise.resolve();
  expect(runMuseumSearch).toHaveBeenCalledTimes(1);
  finish({ stage: 'none', reason: 'no_candidates' });
  await first;
  jest.mocked(runMuseumSearch).mockResolvedValue({ stage: 'none', reason: 'no_candidates' });
  await runMuseumSearchForScan(input);
  expect(runMuseumSearch).toHaveBeenCalledTimes(2);
});

it('uses freshly stored candidates if the live subscription has not caught up', async () => {
  jest.mocked(runMuseumSearch).mockClear();
  jest.mocked(runMuseumSearch).mockResolvedValue({ stage: 'none', reason: 'no_match' });
  jest.mocked(convex.query).mockResolvedValue({ museumSearch: candidates });
  await runMuseumSearchForScan({ scanId: 'scan-2' as Id<'scans'>, localId: 'capture-2', canContinue: () => true, onStage: jest.fn() });
  expect(runMuseumSearch).toHaveBeenCalledWith(expect.objectContaining({ stored: candidates }));
});

it('restores a freshly confirmed search without preparing or uploading a crop', async () => {
  jest.mocked(runMuseumSearch).mockClear();
  jest.mocked(convex.query).mockResolvedValue({ museumSearch: confirmed, labelFlow: verified });
  const result = await runMuseumSearchForScan({ scanId: 'scan-3' as Id<'scans'>, localId: 'capture-3', canContinue: () => true, onStage: jest.fn() });
  expect(result).toEqual({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  expect(runMuseumSearch).not.toHaveBeenCalled();
  expect(convex.action).not.toHaveBeenCalled();
});

it('restores a freshly completed none result, while an explicit retry can search again', async () => {
  jest.mocked(convex.query).mockResolvedValue({ museumSearch: { stage: 'none', reason: 'no_candidates', updatedAt: 1 } });
  const input = { scanId: 'scan-4' as Id<'scans'>, localId: 'capture-4', canContinue: () => true, onStage: jest.fn() };
  expect(await runMuseumSearchForScan(input)).toEqual({ stage: 'none', reason: 'no_candidates' });
  expect(runMuseumSearch).not.toHaveBeenCalled();
  await runMuseumSearchForScan({ ...input, retry: true });
  expect(runMuseumSearch).toHaveBeenCalledTimes(1);
});

it('restores an edited confirmation from the latest query without searching again', async () => {
  const flow = { ...verified, updatedAt: 3, sourceUrl: undefined, fields: { ...verified.fields, title: { value: 'My title', evidence: 'ocr' as const, locked: false } } };
  jest.mocked(loadLabelDraft).mockResolvedValue(setFieldValue(formStateFromFlow(verified), 'title', 'My title'));
  jest.mocked(convex.query).mockResolvedValue({ scanId: 'scan-5', museumSearch: confirmed, labelFlow: flow });
  expect(await runMuseumSearchForScan({ scanId: 'scan-5' as Id<'scans'>, localId: 'capture-5', canContinue: () => true, onStage: jest.fn() }))
    .toEqual({ stage: 'done', flow, confirmedAt: confirmed.updatedAt });
  expect(runMuseumSearch).not.toHaveBeenCalled();
  expect(convex.action).not.toHaveBeenCalled();
});
