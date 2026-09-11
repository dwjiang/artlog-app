// Jest stand-in for react-native-fast-opencv: enough of the API for the crop, ORB and triage code,
// tracking every native object so tests can assert that nothing leaks.
import type { FastOpenCV } from './opencv';
import type { Keypoint } from '@/lib/orb/pack';

export type FakeObject = { released: boolean; release(): void };
export type FakeMat = FakeObject & {
  rows: number;
  cols: number;
  channels: number;
  data: ArrayLike<number>;
  toBuffer(type: string): { rows: number; cols: number; channels: number; buffer: ArrayLike<number> };
};
export type FakeImage = { rows: number; cols: number; channels: number };

export type FakeOpenCVOptions = {
  /** Decodable images keyed by their base64 payload. */
  images?: Record<string, FakeImage>;
  keypoints?: Keypoint[];
  descriptors?: Uint8Array;
  descriptorCols?: number;
  /** Standard deviation `meanStdDev` reports for the Laplacian. */
  laplacianStddev?: number;
  /** Pixels `countNonZero` reports after the highlight threshold. */
  highlightPixels?: number;
  cvtColorError?: Error;
};

export type FakeOpenCV = {
  cv: FastOpenCV;
  objects: FakeObject[];
  calls: { name: string; args: unknown[] }[];
  leaked(): FakeObject[];
};

export function fakeOpenCV(options: FakeOpenCVOptions = {}): FakeOpenCV {
  const objects: FakeObject[] = [];
  const calls: FakeOpenCV['calls'] = [];
  function track<T extends FakeObject>(object: T): T {
    objects.push(object);
    return object;
  }
  function releasable(): FakeObject {
    return { released: false, release() { this.released = true; } };
  }
  function mat(rows = 0, cols = 0, channels = 1, data: ArrayLike<number> = []): FakeMat {
    return track({
      ...releasable(),
      rows, cols, channels, data,
      toBuffer() {
        if (this.released) throw new Error('toBuffer on a released Mat');
        return { rows: this.rows, cols: this.cols, channels: this.channels, buffer: this.data };
      },
    });
  }
  function alive(object: FakeObject, what: string) {
    if (object.released) throw new Error(`${what} on a released object`);
  }
  function record(name: string, args: unknown[]) { calls.push({ name, args }); }

  const cv = {
    Mat: {
      create: (rows: number, cols: number) => mat(rows, cols),
      createFromBase64(base64: string) {
        const image = options.images?.[base64];
        if (!image) throw new Error(`Cannot decode image ${base64}`);
        return mat(image.rows, image.cols, image.channels);
      },
    },
    Size: { create: (width: number, height: number) => track({ ...releasable(), width, height }) },
    OpenCV: {
      cvtColor(src: FakeMat, dst: FakeMat, code: unknown) {
        record('cvtColor', [code]);
        alive(src, 'cvtColor');
        if (options.cvtColorError) throw options.cvtColorError;
        Object.assign(dst, { rows: src.rows, cols: src.cols, channels: 1 });
      },
      resize(src: FakeMat, dst: FakeMat, size: { width: number; height: number }, fx: number, fy: number, interpolation: unknown) {
        record('resize', [size.width, size.height, interpolation]);
        alive(src, 'resize');
        Object.assign(dst, { rows: size.height, cols: size.width, channels: src.channels });
      },
      Laplacian(src: FakeMat, dst: FakeMat, ddepth: unknown, ksize: number) {
        record('Laplacian', [ddepth, ksize]);
        alive(src, 'Laplacian');
        Object.assign(dst, { rows: src.rows, cols: src.cols, channels: 1 });
      },
      meanStdDev(src: FakeMat, mean: FakeMat, stddev: FakeMat) {
        alive(src, 'meanStdDev');
        Object.assign(mean, { rows: 1, cols: 1, data: [0] });
        Object.assign(stddev, { rows: 1, cols: 1, data: [options.laplacianStddev ?? 0] });
      },
      threshold(src: FakeMat, dst: FakeMat, thresh: number, maxval: number, type: unknown) {
        record('threshold', [thresh, maxval, type]);
        alive(src, 'threshold');
        Object.assign(dst, { rows: src.rows, cols: src.cols, channels: 1 });
      },
      countNonZero(src: FakeMat) {
        alive(src, 'countNonZero');
        return { value: options.highlightPixels ?? 0 };
      },
      ORB_create(nfeatures: number) {
        record('ORB_create', [nfeatures]);
        return track({ ...releasable(), nfeatures });
      },
      detectAndCompute(detector: FakeObject, image: FakeMat) {
        alive(detector, 'detectAndCompute');
        alive(image, 'detectAndCompute');
        const keypoints = options.keypoints ?? [];
        const cols = options.descriptorCols ?? 32;
        return {
          keypoints: track({ ...releasable(), length: keypoints.length, toArray: () => keypoints }),
          descriptors: mat(keypoints.length, cols, 1, options.descriptors ?? new Uint8Array(keypoints.length * cols)),
        };
      },
    },
    ColorConversionCodes: { COLOR_BGR2GRAY: 'COLOR_BGR2GRAY' },
    DataTypes: { CV_8U: 'CV_8U', CV_64F: 'CV_64F' },
    BorderTypes: { BORDER_DEFAULT: 'BORDER_DEFAULT' },
    InterpolationFlags: { INTER_AREA: 'INTER_AREA' },
    ThresholdTypes: { THRESH_BINARY: 'THRESH_BINARY' },
  };
  return { cv: cv as unknown as FastOpenCV, objects, calls, leaked: () => objects.filter((object) => !object.released) };
}
