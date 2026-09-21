import type { FrameSize } from './rectangle';

export function previewGeometry(preview: FrameSize, frame: FrameSize, inputSize: number) {
  if (![preview.width, preview.height, frame.width, frame.height, inputSize].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(frame.width / preview.width, frame.height / preview.height);
  const width = preview.width * scale, height = preview.height * scale;
  // Native letterboxing centers with integer division, leaving any odd extra pixel on the right/bottom.
  const modelScale = inputSize / Math.max(preview.width, preview.height);
  const x = Math.floor((inputSize - preview.width * modelScale) / 2);
  const y = Math.floor((inputSize - preview.height * modelScale) / 2);
  const displayScale = scale / modelScale;
  return {
    artwork: { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height },
    model: { left: -x * displayScale, top: -y * displayScale, width: inputSize * displayScale, height: inputSize * displayScale },
  };
}
