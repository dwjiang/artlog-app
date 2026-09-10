import model from '../../../shared/model-version.json';

import { getVisionRect } from '../../../modules/vision-rect/src';
import { selectCaptureQuad, toCorners } from './rectangle';
import type { CaptureDependencies, CaptureOptions, Warper } from './stages';

function embedPending(): never { throw new Error('Embedder implemented by plan 03.03'); }
function orbPending(): never { throw new Error('Triage and ORB implemented by plan 03.04'); }

function filePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

export const warper: Warper = {
  async warpAndLetterbox(photoUri, quad, size) {
    const visionRect = getVisionRect();
    const path = filePath(photoUri);
    const still = await visionRect.detectStill(path);
    const selected = selectCaptureQuad(quad, still);
    const result = await visionRect.warpAndLetterbox(path, selected ? toCorners(selected) : undefined, size);
    return { cropUri: `file://${result.cropPath}` };
  },
};

export const captureOptions: CaptureOptions = { inputSize: model.inputSize, modelVersion: model.modelVersion };

export const defaultStages: Pick<CaptureDependencies, 'warper' | 'triage' | 'embedder' | 'orb' | 'enqueue'> = {
  warper,
  triage: { check: orbPending },
  embedder: { embed: embedPending, modelVersion: model.modelVersion },
  orb: { extract: orbPending },
  enqueue: async ({ localId }) => {
    console.warn('Offline queue pending plan 03.06; capture is not persisted', { localId });
  },
};
