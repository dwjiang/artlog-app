import { captureFileUri, deleteCapture, persistCapture } from './photos';

const mockCreate = jest.fn();
const mockMove = jest.fn();
const mockDelete = jest.fn();
const mockExisting = new Set<string>();
let mockDocumentsUri = 'file:///documents';

jest.mock('expo-file-system', () => {
  class Node {
    uri: string;
    constructor(...parts: (string | Node)[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() { return mockExisting.has(this.uri); }
  }
  class Directory extends Node {
    create(options: unknown) { mockCreate(this.uri, options); }
  }
  class File extends Node {
    async move(destination: Node) { mockMove(this.uri, destination.uri); this.uri = destination.uri; }
    delete() { mockDelete(this.uri); mockExisting.delete(this.uri); }
  }
  return { Directory, File, Paths: { get document() { return new Directory(mockDocumentsUri); } } };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting.clear();
  mockDocumentsUri = 'file:///documents';
});

it('moves the photo and crop into documents named by the capture, keeping extensions', async () => {
  const files = await persistCapture({ photoUri: 'file:///tmp/IMG_1.PNG', cropUri: 'file:///caches/crops/abc.jpg', localId: 'cap-1' });
  expect(files).toEqual({ photoPath: 'photos/cap-1.png', cropPath: 'crops/cap-1.jpg' });
  expect(mockCreate.mock.calls).toEqual([
    ['file:///documents/photos', { intermediates: true, idempotent: true }],
    ['file:///documents/crops', { intermediates: true, idempotent: true }],
  ]);
  expect(mockMove.mock.calls).toEqual([
    ['file:///tmp/IMG_1.PNG', 'file:///documents/photos/cap-1.png'],
    ['file:///caches/crops/abc.jpg', 'file:///documents/crops/cap-1.jpg'],
  ]);
});

it('falls back to .jpg when the source has no extension', async () => {
  const files = await persistCapture({ photoUri: 'file:///tmp/photo', cropUri: 'file:///tmp/crop', localId: 'cap-2' });
  expect(files).toEqual({ photoPath: 'photos/cap-2.jpg', cropPath: 'crops/cap-2.jpg' });
});

it('deletes only the files that still exist', () => {
  mockExisting.add('file:///documents/photos/cap-1.jpg');
  mockExisting.add('file:///documents/labels/cap-1.jpg');
  deleteCapture({ photoPath: 'photos/cap-1.jpg', cropPath: 'crops/cap-1.jpg', labelPhotoPath: 'labels/cap-1.jpg' });
  expect(mockDelete.mock.calls).toEqual([['file:///documents/photos/cap-1.jpg'], ['file:///documents/labels/cap-1.jpg']]);
  expect(() => deleteCapture({ photoPath: null, cropPath: undefined })).not.toThrow();
});

it('finds persisted files after the app data container moves', async () => {
  const files = await persistCapture({ photoUri: 'file:///tmp/photo.jpg', cropUri: 'file:///tmp/crop.jpg', localId: 'cap-1' });
  mockDocumentsUri = 'file:///new-container/documents';
  expect(captureFileUri(files.cropPath)).toBe('file:///new-container/documents/crops/cap-1.jpg');
  mockExisting.add('file:///new-container/documents/photos/cap-1.jpg');
  mockExisting.add('file:///new-container/documents/crops/cap-1.jpg');
  deleteCapture(files);
  expect(mockDelete.mock.calls).toEqual([
    ['file:///new-container/documents/photos/cap-1.jpg'],
    ['file:///new-container/documents/crops/cap-1.jpg'],
  ]);
});
