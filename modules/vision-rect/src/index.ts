import { NitroModules } from 'react-native-nitro-modules';

import type { VisionRect } from './vision-rect.nitro';

// eslint-disable-next-line artlog/no-re-exports -- nitrogen only reads *.nitro.ts, so the public types live there
export type { CropContentBounds, LetterboxResult, RectDetection, RectObservation, RectPoint, StillDetection, SubjectObservation, TextLine, TextRecognition, VisionRect } from './vision-rect.nitro';

let instance: VisionRect | undefined;

export function getVisionRect(): VisionRect {
  instance ??= NitroModules.createHybridObject<VisionRect>('VisionRect');
  return instance;
}
