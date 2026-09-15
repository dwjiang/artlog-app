import { Image, type ImageRef } from 'expo-image';
import { PRESENTATION_LOAD_TIMEOUT_MS, PresentationImages } from './presentation-images';

jest.mock('expo-image', () => ({ Image: { loadAsync: jest.fn() } }));
const load = jest.mocked(Image.loadAsync);
const image = () => ({ release: jest.fn() }) as unknown as ImageRef;

beforeEach(() => { jest.resetAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

it('holds decoded images after source files move, releasing each exactly once at the end', async () => {
  const photo = image(), crop = image();
  load.mockResolvedValueOnce(photo).mockResolvedValueOnce(crop);
  const images = new PresentationImages();
  expect(await images.load('file:///photo.jpg')).toBe(photo);
  expect(await images.load('file:///crop.jpg')).toBe(crop);
  expect(photo.release).not.toHaveBeenCalled();
  expect(crop.release).not.toHaveBeenCalled();
  images.release();
  images.release();
  expect(photo.release).toHaveBeenCalledTimes(1);
  expect(crop.release).toHaveBeenCalledTimes(1);
});

it('releases a late decoded image after cancellation', async () => {
  let resolve!: (value: ImageRef) => void;
  load.mockReturnValue(new Promise((done) => { resolve = done; }));
  const images = new PresentationImages();
  const pending = images.load('file:///photo.jpg');
  images.release();
  const photo = image();
  resolve(photo);
  expect(await pending).toBeUndefined();
  expect(photo.release).toHaveBeenCalledTimes(1);
});

it('bounds a stalled image load and releases its eventual result', async () => {
  jest.useFakeTimers();
  let resolve!: (value: ImageRef) => void;
  load.mockReturnValue(new Promise((done) => { resolve = done; }));
  const images = new PresentationImages();
  const pending = images.load('file:///photo.jpg');
  await jest.advanceTimersByTimeAsync(PRESENTATION_LOAD_TIMEOUT_MS);
  expect(await pending).toBeUndefined();
  const photo = image();
  resolve(photo);
  await jest.advanceTimersByTimeAsync(0);
  expect(photo.release).toHaveBeenCalledTimes(1);
});

it('allows normal processing to continue after image decoding fails', async () => {
  load.mockRejectedValue(new Error('Decode failed'));
  expect(await new PresentationImages().load('file:///photo.jpg')).toBeUndefined();
});
