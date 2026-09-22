import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { DocentSentence, FactChip } from '../../convex/lib/validators';
import type { ScanDisplay } from '../../convex/scans';

export type MuseumSummary = {
  id: Id<'museums'>; key: string; name: string; city?: string; lat: number; lng: number;
  version: string; modelVersion: string; size: number; count: number;
  previews: { title: string; url: string }[];
};
export type MuseumManifest = MuseumSummary & { chunks: { url: string; size: number; sha256: string }[] };

/**
 * One downloadable reference. Packages carry only what recognition and the result card read, so
 * review and enrichment state on the objects and artworks tables never leaves the server.
 */
export type MuseumEntry = {
  vectors: number[][];
  candidate: {
    object: Pick<Doc<'objects'>, '_id' | 'identityStatus' | 'ownerId' | 'medium' | 'calibratorPenalty' | 'rejectionPenalty'>;
    artwork: Pick<Doc<'artworks'>, '_id' | 'title' | 'artist' | 'date' | 'rightsStatus'> &
      { docent?: DocentSentence[]; factSheet?: FactChip[] };
    placement: Pick<Doc<'placements'>, 'venueId' | 'gallery' | 'onView'> | null;
    institution?: string;
    similarity: number;
    keypointCount: number;
    inputSize?: number;
    descriptors: ArrayBuffer;
    keypoints: ArrayBuffer;
  };
};
export type OfflineResult = Pick<ScanDisplay, 'outcome' | 'best' | 'runnerUps' | 'docent' | 'factSheet' | 'calibratorVersion'>;
