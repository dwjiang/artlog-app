import model from '../../../shared/model-version.json';

import type { CaptureDependencies, CaptureOptions } from './stages';

function warpPending(): never { throw new Error('Warper implemented by plan 03.02'); }
function embedPending(): never { throw new Error('Embedder implemented by plan 03.03'); }
function orbPending(): never { throw new Error('Triage and ORB implemented by plan 03.04'); }

export const captureOptions: CaptureOptions = { inputSize: model.inputSize, modelVersion: model.modelVersion };

export const defaultStages: Pick<CaptureDependencies, 'warper' | 'triage' | 'embedder' | 'orb' | 'enqueue'> = {
  warper: { warpAndLetterbox: warpPending },
  triage: { check: orbPending },
  embedder: { embed: embedPending, modelVersion: model.modelVersion },
  orb: { extract: orbPending },
  enqueue: async ({ localId }) => {
    console.warn('Offline queue pending plan 03.06; capture is not persisted', { localId });
  },
};
