import type { FunctionArgs } from 'convex/server';

import type { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { LabelFlowDisplay, MuseumSearchDisplay } from '../../../convex/lib/validators';
import type { ScanFeatures } from '@/lib/capture/features';
import type { ImageCheckDeps } from '@/lib/label/image-check';
import { errorMessage } from '@/lib/network-error';
import { getMuseumSearchConsent } from '@/lib/settings/museum-search';
import { checkCandidates } from './candidate-check';

export type MuseumSearchStage = 'describe' | 'search' | 'check' | 'done' | 'none';
export type MuseumSearchOutcome =
  | { stage: 'done'; flow: LabelFlowDisplay; confirmedAt: number }
  | { stage: 'none'; reason: string }
  | { stage: 'cancelled' };

export type MuseumSearchApi = {
  searchMuseumSite(args: FunctionArgs<typeof api.museumSearch.searchMuseumSite>): Promise<MuseumSearchDisplay>;
  confirmSearchCandidate(args: FunctionArgs<typeof api.museumSearch.confirmSearchCandidate>): Promise<LabelFlowDisplay>;
};

export function museumSearchMessage(reason: string): string | undefined {
  switch (reason) {
    case 'no_venue_site': case 'venue_opted_out': return undefined;
    case 'feature_off': return 'Museum search is paused right now';
    case 'rate_limited': return 'Try again in a minute';
    case 'spend_cap': case 'cap': return 'Museum search is paused for today';
    case 'no_candidates': case 'no_match': return "Not on the museum's site — point at the label";
    default: return "Couldn't search right now";
  }
}

type Input = {
  scanId: Id<'scans'>;
  localId: string;
  api: MuseumSearchApi;
  images: ImageCheckDeps;
  inputSize: number;
  getCapture(localId: string): Promise<(ScanFeatures & { cropPath: string; scanId: Id<'scans'> | null }) | undefined>;
  prepareCrop(path: string): Promise<string>;
  stored?: MuseumSearchDisplay;
  canContinue(): boolean;
  onStage?(stage: MuseumSearchStage): void;
};

export async function runMuseumSearch(input: Input): Promise<MuseumSearchOutcome> {
  const { scanId, api, onStage } = input;
  const canContinue = async () => await getMuseumSearchConsent() === 'granted' && input.canContinue();
  const none = (reason: string): MuseumSearchOutcome => {
    onStage?.('none');
    return { stage: 'none', reason };
  };
  try {
    if (!await canContinue()) return { stage: 'cancelled' };
    let search = input.stored;
    if (search?.stage === 'none') return none(search.reason);
    // Confirmed fields are restored by the public scan subscription, never by another provider request.
    if (search?.stage === 'confirmed') return { stage: 'cancelled' };
    const capture = await input.getCapture(input.localId);
    if (!capture || capture.scanId !== scanId) return none('missing_capture');
    if (!search) {
      onStage?.('describe');
      const imageBase64 = await input.prepareCrop(capture.cropPath);
      if (!await canContinue()) return { stage: 'cancelled' };
      onStage?.('search');
      search = await api.searchMuseumSite({ scanId, imageBase64 });
    }
    if (!await canContinue()) return { stage: 'cancelled' };
    if (search.stage === 'none') return none(search.reason);
    if (search.stage === 'confirmed') return { stage: 'cancelled' };
    onStage?.('check');
    const match = await checkCandidates(search.candidates, capture, input.images, { inputSize: input.inputSize, canContinue });
    if (!await canContinue()) return { stage: 'cancelled' };
    if (!match) return none('no_match');
    const flow = await api.confirmSearchCandidate({ scanId, ...match });
    if (flow.moderation !== 'clear' || flow.stage !== 'verified') return none('model_error');
    onStage?.('done');
    return { stage: 'done', flow, confirmedAt: flow.updatedAt };
  } catch (error) {
    return none(errorMessage(error));
  }
}
