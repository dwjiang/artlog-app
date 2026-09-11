import { fakeOpenCV } from './opencv-fake';
import { loadGray } from './read-crop';

const mockBase64 = jest.fn();
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    base64() { return mockBase64(this.uri); }
  },
}));

beforeEach(() => {
  mockBase64.mockReset();
  mockBase64.mockImplementation(async (uri: string) => `b64:${uri}`);
});

it('decodes the file and converts it to a single gray channel, releasing the color image', async () => {
  const fake = fakeOpenCV({ images: { 'b64:file:///crops/a%20b.jpg': { rows: 512, cols: 512, channels: 3 } } });
  const image = await loadGray('file:///crops/a%20b.jpg', fake.cv);
  expect(mockBase64).toHaveBeenCalledWith('file:///crops/a%20b.jpg');
  expect(image).toMatchObject({ width: 512, height: 512 });
  expect(fake.calls).toEqual([{ name: 'cvtColor', args: ['COLOR_BGR2GRAY'] }]);
  expect(fake.leaked()).toEqual([image.gray]);
  image.gray.release();
  expect(fake.leaked()).toEqual([]);
});

it('releases both images when the conversion fails', async () => {
  const fake = fakeOpenCV({ images: { 'b64:file:///crop.png': { rows: 8, cols: 8, channels: 1 } }, cvtColorError: new Error('Invalid number of channels') });
  await expect(loadGray('file:///crop.png', fake.cv)).rejects.toThrow('Invalid number of channels');
  expect(fake.leaked()).toEqual([]);
});
