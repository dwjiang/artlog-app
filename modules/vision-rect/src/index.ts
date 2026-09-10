import { NitroModules } from 'react-native-nitro-modules';

import type { VisionRect } from './vision-rect.nitro';

export type { LetterboxResult, RectDetection, RectObservation, RectPoint, VisionRect } from './vision-rect.nitro';

let instance: VisionRect | undefined;

export function getVisionRect(): VisionRect {
  instance ??= NitroModules.createHybridObject<VisionRect>('VisionRect');
  return instance;
}
