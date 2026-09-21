import type { Mat } from 'react-native-fast-opencv';

import type { FastOpenCV } from '@/lib/image/opencv';
import { withGray } from '@/lib/image/read-crop';
import type { Triage } from './stages';

/** Metrics are measured on the gray crop downscaled to this square size. */
export const TRIAGE_SIZE = 256;
/** Variance of the 3×3 Laplacian; the sharp fixture scores ~2,000, a σ=3 px Gaussian blur ~20. */
export const BLUR_THRESHOLD = 60;
/** Pixels at or above this gray level count as blown highlights. */
export const GLARE_LEVEL = 250;
/** Fraction of highlight pixels above which the shot is a glare retake. */
export const GLARE_THRESHOLD = 0.04;

export type TriageMetrics = { blurVariance: number; glareFraction: number };
export type TriageResult = Awaited<ReturnType<Triage['check']>>;

export function decide({ blurVariance, glareFraction }: TriageMetrics): TriageResult {
  if (blurVariance < BLUR_THRESHOLD) return { ok: false, reason: 'blur', message: 'Hold steady and try again' };
  if (glareFraction > GLARE_THRESHOLD) return { ok: false, reason: 'glare', message: 'Adjust the angle to reduce glare' };
  return { ok: true };
}

export function measureTriage(gray: Mat, cv: FastOpenCV): TriageMetrics {
  const { OpenCV, Mat, Size, DataTypes, BorderTypes, InterpolationFlags, ThresholdTypes } = cv;
  const size = Size.create(TRIAGE_SIZE, TRIAGE_SIZE);
  const [small, laplacian, mean, stddev, highlights] = Array.from({ length: 5 }, () => Mat.create(0, 0, DataTypes.CV_8U));
  try {
    OpenCV.resize(gray, small, size, 0, 0, InterpolationFlags.INTER_AREA);
    OpenCV.Laplacian(small, laplacian, DataTypes.CV_64F, 1, 1, 0, BorderTypes.BORDER_DEFAULT);
    OpenCV.meanStdDev(laplacian, mean, stddev);
    const sigma = stddev.toBuffer('float64').buffer[0];
    OpenCV.threshold(small, highlights, GLARE_LEVEL - 1, 255, ThresholdTypes.THRESH_BINARY);
    const glareFraction = OpenCV.countNonZero(highlights).value / (TRIAGE_SIZE * TRIAGE_SIZE);
    return { blurVariance: sigma * sigma, glareFraction };
  } finally {
    for (const object of [size, small, laplacian, mean, stddev, highlights]) object.release();
  }
}

export function measureCrop(cropUri: string, cv?: FastOpenCV): Promise<TriageMetrics> {
  return withGray(cropUri, cv, ({ gray }, opencv) => measureTriage(gray, opencv));
}

export async function check(cropUri: string, cv?: FastOpenCV): Promise<TriageResult> {
  const metrics = await measureCrop(cropUri, cv);
  const result = decide(metrics);
  // Thresholds are product tuning; the metrics behind each decision are what gets recorded.
  if (__DEV__) console.debug('Triage', { ...metrics, ...result });
  return result;
}

export const triage: Triage = { check: (cropUri) => check(cropUri) };
