import model from '../../../shared/model-version.json';

import { getVisionRect } from '../../../modules/vision-rect/src';
import { embedder } from '@/lib/embed/embedder';
import { filePath } from '@/lib/file-uri';
import { selectCaptureQuad, toCorners } from './rectangle';
import type { CaptureDependencies, CaptureOptions, Warper } from './stages';

function orbPending(): never { throw new Error('Triage and ORB implemented by plan 03.04'); }

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
  embedder,
  orb: { extract: orbPending },
  enqueue: async ({ localId }) => {
    console.warn('Offline queue pending plan 03.06; capture is not persisted', { localId });
  },
};
