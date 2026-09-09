import { renderHook } from '@testing-library/react-native';
import type { ScannedCode, ScannedObject } from 'react-native-vision-camera';

import { useQrScanner } from './use-qr-scanner';

const mockOutput = {};
let mockOptions: { types: string[]; onObjectsScanned: (objects: ScannedObject[]) => void };
jest.mock('react-native-vision-camera', () => ({
  useObjectOutput: (options: typeof mockOptions) => { mockOptions = options; return mockOutput; },
  isScannedCode: (object: ScannedObject) => object.type === 'qr',
}));

it('detaches the output while disabled and ignores late native callbacks', async () => {
  const onCode = jest.fn();
  const hook = await renderHook((props: { enabled: boolean }) => useQrScanner(props.enabled, onCode), { initialProps: { enabled: false } });
  const objects = [{ type: 'qr', value: 'https://museum.org/painting' }] as ScannedCode[];
  expect(hook.result.current).toBeUndefined();
  mockOptions.onObjectsScanned(objects);
  expect(onCode).not.toHaveBeenCalled();
  await hook.rerender({ enabled: true });
  expect(hook.result.current).toBe(mockOutput);
  expect(mockOptions.types).toEqual(['qr']);
  mockOptions.onObjectsScanned(objects);
  mockOptions.onObjectsScanned(objects);
  expect(onCode).toHaveBeenCalledTimes(1);
  expect(onCode).toHaveBeenCalledWith('https://museum.org/painting');
  await hook.rerender({ enabled: false });
  mockOptions.onObjectsScanned([{ type: 'qr', value: 'https://museum.org/other' }] as ScannedCode[]);
  expect(onCode).toHaveBeenCalledTimes(1);
});
