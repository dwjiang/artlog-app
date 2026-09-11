export const FLAG_MIN_REJECTIONS = 20;
export const FLAG_REJECT_RATIO = 0.3;
export const PENALTY_STEP = 0.2;
export const MAX_PENALTY = 0.8;

export function effectiveObjectPenalty(object: { calibratorPenalty: number; rejectionPenalty?: number }): number {
  return Math.max(object.calibratorPenalty, Math.min(MAX_PENALTY, object.calibratorPenalty + (object.rejectionPenalty ?? 0)));
}
