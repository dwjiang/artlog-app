import type { Id } from '../../convex/_generated/dataModel';
import model from '../model/model-version.json';
import { encodeOrbFeatures } from '../orb/features';
import { makeSyntheticPair } from '../orb/test-fixtures';
import type { VerifyResult } from '../orb/verify';
import { rankEntries, recognizeEntries } from './recognition';
import type { MuseumEntry } from './types';

let mockVerification: VerifyResult;
jest.mock('../orb/verify', () => ({ verifyOrb: () => mockVerification }));

const venueId = 'venue' as Id<'museums'>;
const pair = makeSyntheticPair({ count: 40 });
const corners = [[0, 0], [1, 0], [1, 1], [0, 1]] as VerifyResult['corners'];
const entry = (id: string, vector: number[]): MuseumEntry => ({ vectors: [vector], candidate: {
  object: { _id: id as Id<'objects'>, identityStatus: 'established', ownerId: venueId, calibratorPenalty: 0 },
  artwork: { _id: `${id}-artwork` as Id<'artworks'>, title: id, artist: 'Claude Monet', rightsStatus: 'public_domain' },
  placement: { venueId, onView: true }, similarity: 0,
  // Below the calibrator's low-texture cutoff, a confident match does not need a verified homography.
  keypointCount: 40, ...encodeOrbFeatures(pair.ref),
} });
const recognize = () => recognizeEntries({ modelVersion: model.modelVersion, venueId, ...encodeOrbFeatures(pair.query) },
  rankEntries([1, 0], [entry('match', [1, 0]), entry('other', [0, 1])]));

it('outlines only a best match whose homography verified, never a runner-up', () => {
  mockVerification = { matchCount: 12, inlierCount: 4, homography: null, corners, verified: false };
  const unverified = recognize();
  expect(unverified).toMatchObject({ outcome: 'confident', best: { objectId: 'match' }, runnerUps: [{ objectId: 'other' }] });
  expect(unverified?.best?.corners).toBeUndefined();

  mockVerification = { ...mockVerification, inlierCount: 30, verified: true };
  const verified = recognize();
  expect(verified?.best?.corners).toEqual(corners);
  expect(verified?.runnerUps?.[0].corners).toBeUndefined();
});
