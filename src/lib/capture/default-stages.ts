import model from '../../../shared/model/model-version.json';

import { getVisionRect } from '../../../modules/vision-rect/src';
import { embedder } from '@/lib/embed/embedder';
import { filePath } from '@/lib/file-uri';
import { captureStore } from '@/lib/queue/queue';
import { orb } from './features';
import { triage } from './triage';
import { selectCaptureQuad, toCorners } from './rectangle';
import type { CaptureDependencies, CaptureOptions, Warper } from './stages';

export const warper: Warper = {
  async warpAndLetterbox(photoUri, quad, size) {
    const visionRect = getVisionRect();
    const path = filePath(photoUri);
    const still = await visionRect.detectStill(path);
    const selected = selectCaptureQuad(quad, still);
    if (__DEV__) {
      console.debug('Still analysis', {
        still: `${still.width}×${still.height}`,
        subjects: still.subjects.map((subject) => `${(subject.area * 100).toFixed(1)}% fill ${subject.quadFill.toFixed(3)}`),
        rectangles: still.rectangles.length,
        subjectNote: still.subjectNote,
        selected: selected?.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ') ?? 'whole image',
      });
    }
    const result = await visionRect.warpAndLetterbox(path, selected ? toCorners(selected) : undefined, size);
    return { cropUri: `file://${result.cropPath}` };
  },
};

export const captureOptions: CaptureOptions = { inputSize: model.inputSize, modelVersion: model.modelVersion };

export const defaultStages: Pick<CaptureDependencies, 'warper' | 'triage' | 'embedder' | 'orb' | 'store'> = {
  warper,
  triage,
  embedder,
  orb,
  store: captureStore,
};
