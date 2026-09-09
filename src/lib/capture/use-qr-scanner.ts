import { useCallback, useState } from 'react';
import { isScannedCode, useObjectOutput, type ScannedObject, type ScannedObjectType } from 'react-native-vision-camera';

import { createQrDebouncer } from './qr-debounce';

const qrTypes: ScannedObjectType[] = ['qr'];

export function useQrScanner(enabled: boolean, onCode: (url: string) => void) {
  const [accept] = useState(createQrDebouncer);
  const onObjectsScanned = useCallback((objects: ScannedObject[]) => {
    if (!enabled) return;
    for (const object of objects) {
      if (isScannedCode(object) && object.value && accept(object.value, performance.now())) onCode(object.value);
    }
  }, [accept, enabled, onCode]);
  // AVFoundation's built-in QR output avoids ML Kit's arm64 simulator exclusion.
  const output = useObjectOutput({ types: qrTypes, onObjectsScanned });
  return enabled ? output : undefined;
}
