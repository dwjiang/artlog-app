import { ConvexError } from 'convex/values';

import type { Id } from '../../../convex/_generated/dataModel';
import type { MuseumSearchDisplay } from '../../../convex/lib/validators';
import { getMuseumSearchConsent } from '@/lib/settings/museum-search';
import { encodeOrbFeatures } from '@/shared/orb/features';
import { makeSyntheticPair } from '@/shared/orb/test-fixtures';
import { candidate, candidates, exhibitionCandidates, verified } from './__fixtures__/search';
import { museumSearchMessage, runMuseumSearch } from './flow';

jest.mock('@/lib/settings/museum-search', () => ({ getMuseumSearchConsent: jest.fn() }));
const pair = makeSyntheticPair({ count: 120 });
const scanId = 'scan-1' as Id<'scans'>;

function input() {
  return {
    scanId, localId: 'capture-1', inputSize: 512,
    api: { searchExhibitions: jest.fn(async (): Promise<MuseumSearchDisplay> => ({ stage: 'exhibitions', updatedAt: 1, candidates: [] })),
      searchMuseumSite: jest.fn(async () => candidates), confirmSearchCandidate: jest.fn(async () => verified) },
    images: {
      download: jest.fn(async (url: string) => `file:///cache/${url.split('/').pop()}`),
      letterbox: jest.fn(async (uri: string) => `${uri}.box.jpg`),
      embed: jest.fn(async () => Float32Array.from([1, 0])),
      extractOrb: jest.fn(async () => encodeOrbFeatures(pair.ref)),
      remove: jest.fn(),
    },
    getCapture: jest.fn(async () => ({ scanId, cropPath: 'crops/one.jpg', vector: [1, 0], ...encodeOrbFeatures(pair.query) })),
    prepareCrop: jest.fn(async () => 'encoded-crop'),
    canContinue: jest.fn(() => true), onStage: jest.fn(),
  };
}

beforeEach(() => { jest.resetAllMocks(); jest.mocked(getMuseumSearchConsent).mockResolvedValue('granted'); });

it('describes, searches, checks and confirms only the first passing image', async () => {
  const deps = input();
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  expect(deps.onStage.mock.calls.flat()).toEqual(['exhibitions', 'describe', 'search', 'check', 'done']);
  expect(deps.prepareCrop).toHaveBeenCalledWith('crops/one.jpg');
  expect(deps.api.searchMuseumSite).toHaveBeenCalledWith({ scanId, imageBase64: 'encoded-crop' });
  expect(deps.api.confirmSearchCandidate).toHaveBeenCalledWith({ scanId, sourceUrl: candidate.sourceUrl,
    imageCheck: { url: candidate.imageUrls[0], cosine: 1, homographyValid: true } });
  expect(deps.images.download).toHaveBeenCalledTimes(1);
  expect(deps.images.remove).toHaveBeenCalledTimes(2);
});

it.each(['unset', 'declined'] as const)('sends no image with %s consent', async (consent) => {
  jest.mocked(getMuseumSearchConsent).mockResolvedValue(consent);
  const deps = input();
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'cancelled' });
  expect(deps.prepareCrop).not.toHaveBeenCalled();
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('rechecks persisted consent after preparing the crop and prevents upload after revocation', async () => {
  const deps = input();
  deps.prepareCrop.mockImplementation(async () => {
    jest.mocked(getMuseumSearchConsent).mockResolvedValue('declined');
    return 'encoded-crop';
  });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'cancelled' });
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('prevents upload when the card loses focus during preparation', async () => {
  const deps = input();
  deps.prepareCrop.mockImplementation(async () => { deps.canContinue.mockReturnValue(false); return 'encoded-crop'; });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'cancelled' });
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('resumes stored candidates without preparing a crop or calling a provider', async () => {
  const deps = input();
  expect(await runMuseumSearch({ ...deps, stored: candidates })).toEqual({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  expect(deps.onStage.mock.calls.flat()).toEqual(['check', 'done']);
  expect(deps.prepareCrop).not.toHaveBeenCalled();
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('never confirms a high-cosine image with a failed homography', async () => {
  const deps = input();
  deps.images.extractOrb.mockResolvedValue(encodeOrbFeatures(makeSyntheticPair({ count: 120, seed: 9 }).ref));
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'no_match' });
  expect(deps.api.confirmSearchCandidate).not.toHaveBeenCalled();
  expect(deps.images.remove).toHaveBeenCalledTimes(4);
});

it.each(['cap', 'no_candidates'] as const)('restores stored %s without a search', async (reason) => {
  const deps = input();
  expect(await runMuseumSearch({ ...deps, stored: { stage: 'none', reason, updatedAt: 1 } })).toEqual({ stage: 'none', reason });
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
  expect(deps.images.download).not.toHaveBeenCalled();
});

it('handles server none without downloading candidate images', async () => {
  const deps = input();
  deps.api.searchMuseumSite.mockResolvedValue({ stage: 'none', reason: 'no_candidates', updatedAt: 1 });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'no_candidates' });
  expect(deps.images.download).not.toHaveBeenCalled();
});

it('turns provider errors into a reason the card can display', async () => {
  const deps = input();
  deps.api.searchMuseumSite.mockRejectedValue(new ConvexError({ code: 'rate_limited' }));
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'rate_limited' });
});

it.each([
  ['feature_off', 'Museum search is paused right now'], ['rate_limited', 'Try again in a minute'],
  ['spend_cap', 'Museum search is paused for today'], ['cap', 'Museum search is paused for today'],
  ['no_candidates', "Not on the museum's site — point at the label"], ['no_match', "Not on the museum's site — point at the label"],
  ['no_venue_site', undefined], ['venue_opted_out', undefined], ['model_error', "Couldn't search right now"],
  ['Network request failed', "Couldn't search right now"],
])('maps %s to the intended copy', (reason, message) => expect(museumSearchMessage(reason!)).toBe(message));

it('cleans the current candidate and stops confirming when consent is revoked during its image check', async () => {
  const deps = input();
  deps.images.embed.mockImplementation(async () => {
    jest.mocked(getMuseumSearchConsent).mockResolvedValue('declined');
    return Float32Array.from([1, 0]);
  });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'cancelled' });
  expect(deps.images.remove).toHaveBeenCalledTimes(2);
  expect(deps.api.confirmSearchCandidate).not.toHaveBeenCalled();
});

it('refuses to upload a capture belonging to a different scan', async () => {
  const deps = input();
  const capture = await deps.getCapture();
  deps.getCapture.mockResolvedValue({ ...capture, scanId: 'another-scan' as Id<'scans'> });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'missing_capture' });
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('does not display a confirmed candidate whose fields failed moderation', async () => {
  const deps = input();
  deps.api.confirmSearchCandidate.mockResolvedValue({ ...verified, moderation: 'flagged', fields: {} });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'model_error' });
});

it('matches an exhibition image without preparing or uploading the visitor photo', async () => {
  const deps = input();
  deps.api.searchExhibitions.mockResolvedValue(exhibitionCandidates);
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'done', flow: verified, confirmedAt: verified.updatedAt });
  expect(deps.api.searchExhibitions).toHaveBeenCalledWith({ scanId });
  expect(deps.onStage.mock.calls.flat()).toEqual(['exhibitions', 'check', 'done']);
  expect(deps.prepareCrop).not.toHaveBeenCalled();
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
  expect(deps.api.confirmSearchCandidate).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://museum.example/exhibitions/colour' }));
  expect(deps.images.remove).toHaveBeenCalledTimes(2);
});

it('continues with the painting search when none of the exhibition images match', async () => {
  const deps = input();
  deps.api.searchExhibitions.mockResolvedValue(exhibitionCandidates);
  deps.images.embed.mockResolvedValueOnce(Float32Array.from([0, 1])).mockResolvedValueOnce(Float32Array.from([0, 1]));
  expect(await runMuseumSearch(deps)).toMatchObject({ stage: 'done' });
  expect(deps.api.searchMuseumSite).toHaveBeenCalledTimes(1);
  expect(deps.api.confirmSearchCandidate).toHaveBeenCalledTimes(1);
  expect(deps.images.remove).toHaveBeenCalledTimes(6);
});

it('resumes exhibition candidates without repeating the live lookup', async () => {
  const deps = input();
  expect(await runMuseumSearch({ ...deps, stored: exhibitionCandidates })).toMatchObject({ stage: 'done' });
  expect(deps.api.searchExhibitions).not.toHaveBeenCalled();
  expect(deps.prepareCrop).not.toHaveBeenCalled();
});

it('asks for the label when an image matches but the artwork identity is unresolved', async () => {
  const deps = input();
  deps.api.searchExhibitions.mockResolvedValue(exhibitionCandidates);
  deps.api.confirmSearchCandidate.mockRejectedValue(new ConvexError({ code: 'identity_unresolved' }));
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'identity_unresolved' });
  expect(museumSearchMessage('identity_unresolved')).toContain('Point at the label');
  expect(deps.prepareCrop).not.toHaveBeenCalled();
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});

it('stops after exhibition lookup when consent is revoked, before downloading any image', async () => {
  const deps = input();
  deps.api.searchExhibitions.mockImplementation(async () => {
    jest.mocked(getMuseumSearchConsent).mockResolvedValue('declined');
    return exhibitionCandidates;
  });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'cancelled' });
  expect(deps.images.download).not.toHaveBeenCalled();
  expect(deps.prepareCrop).not.toHaveBeenCalled();
});

it('does not start the description search when the exhibition lookup reaches the daily cap', async () => {
  const deps = input();
  deps.api.searchExhibitions.mockResolvedValue({ stage: 'none', reason: 'cap', updatedAt: 1 });
  expect(await runMuseumSearch(deps)).toEqual({ stage: 'none', reason: 'cap' });
  expect(deps.prepareCrop).not.toHaveBeenCalled();
  expect(deps.api.searchMuseumSite).not.toHaveBeenCalled();
});
