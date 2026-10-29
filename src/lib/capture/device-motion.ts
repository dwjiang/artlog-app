import { useEffect } from "react";
import { SensorType, useAnimatedSensor, type Value3D } from "react-native-reanimated";

export type DeviceMotion = { rotationRate: number; upright: boolean };
export type MotionReader = () => DeviceMotion | undefined;

/** Matches the detector's pace of about ten frames a second. */
const SAMPLE_INTERVAL_MS = 100;
/**
 * Largest share of gravity along the screen's normal for a phone aimed at a wall, about 45° of tilt: enough to aim up
 * at a high painting, not a phone lying on a table facing the ceiling.
 */
export const UPRIGHT_MAX_TILT = 0.7;

/** Undefined without readings: sensors that never reported, as on the iOS Simulator, leave gravity at zero. */
export function readMotion(rotation: Value3D, gravity: Value3D): DeviceMotion | undefined {
  const weight = Math.hypot(gravity.x, gravity.y, gravity.z);
  if (weight === 0) return undefined;
  return {
    rotationRate: Math.hypot(rotation.x, rotation.y, rotation.z),
    upright: Math.abs(gravity.z) / weight <= UPRIGHT_MAX_TILT,
  };
}

/** Runs the gyroscope and gravity sensors while mounted and hands `onReader` a reader of their latest values. */
export function MotionSampler({ onReader }: { onReader: (read: MotionReader | undefined) => void }): null {
  const { sensor: rotation } = useAnimatedSensor(SensorType.GYROSCOPE, { interval: SAMPLE_INTERVAL_MS });
  const { sensor: gravity } = useAnimatedSensor(SensorType.GRAVITY, { interval: SAMPLE_INTERVAL_MS });
  useEffect(() => {
    onReader(() => readMotion(rotation.value, gravity.value));
    return () => onReader(undefined);
  }, [rotation, gravity, onReader]);
  return null;
}
