import { randomUUID } from 'expo-crypto';

export function createCaptureId(): string {
  return randomUUID();
}
