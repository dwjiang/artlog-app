import { render, screen } from '@testing-library/react-native';

import type { Id } from '../../../convex/_generated/dataModel';

import { CaptureDraftBanner } from './capture-draft-banner';
import { clearDeletedAlbumPhotoPath, saveArtworkSession } from '@/db/repos/artwork-album';
import { enqueuePendingScan } from '@/db/repos/pending-scans';
import { softDeleteSavedWork } from '@/db/repos/saved-works';
import { db } from '@/db/client';
import { artworkPhotos, pendingScans, savedWorks } from '@/db/schema';

jest.mock('@/db/client', () => ({ db: jest.requireActual('../../db/test-db').createTestDatabase() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/account/photo-transfer', () => ({ removePhotoFile: jest.fn() }));

const owner = 'device:test-installation';
const scanLocalId = '3f6b1c2d-8e4a-4f90-b1c5-2d7e8f9a0b11';

beforeEach(() => { for (const table of [artworkPhotos, savedWorks, pendingScans]) db.delete(table).run(); });

async function capture() {
  await enqueuePendingScan({
    localId: scanLocalId, photoPath: 'photos/scan.jpg', cropPath: 'crops/scan.jpg', vector: [0.1], descriptors: new ArrayBuffer(0), keypoints: new ArrayBuffer(0),
    modelVersion: 'm', attemptModelVersion: 'm', venueId: 'museum-legion' as Id<'museums'>, capturedAt: 1, createdAt: 1, status: 'identified', scanId: 'scan-1' as Id<'scans'>,
  });
}

it('offers an unsaved capture as a draft', async () => {
  await capture();
  await render(<CaptureDraftBanner />);
  expect(await screen.findByText('Unsaved artwork · 1 photo')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Resume draft' })).toBeOnTheScreen();
});

it('keeps a saved capture out of the drafts after its artwork is deleted and its album path cleared', async () => {
  await capture();
  // saveResult keys the capture's album row by the scan id; a later sync tombstones the row and drops its path.
  saveArtworkSession('work', { localId: 'work', title: 'Study', artist: '', savedAt: 1, photoPath: 'photos/scan.jpg', cropPath: 'crops/scan.jpg' },
    [{ localId: scanLocalId, savedLocalId: 'work', path: 'photos/scan.jpg', kind: 'full', capturedAt: 1 }], undefined, owner);
  await softDeleteSavedWork('work', 2, owner);
  clearDeletedAlbumPhotoPath(scanLocalId, owner);
  await render(<CaptureDraftBanner />);
  await expect(screen.findByText(/Unsaved artwork/)).rejects.toThrow();
});
