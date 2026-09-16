import { File } from 'expo-file-system';
import { getNetworkStateAsync } from 'expo-network';
import { api } from '../../../convex/_generated/api';
import { captureOwner } from '../account/owner-store';
import { convex } from '../convex-client';
import { captureFileUri } from '../files/photos';
import { albumMatch } from './album-match';
import { captureOptions, defaultStages } from './default-stages';
import { extractFeatures } from './features';
import type { DraftPhoto } from './photo-draft';

export async function checkAlbumPhoto(photo: DraftPhoto, targetObjectId?: string): Promise<Pick<DraftPhoto, 'review' | 'recognized'>> {
  const session = captureOwner();
  if (!targetObjectId || !session.scope) return { review: 'uncertain' };
  let cropUri: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const network = await getNetworkStateAsync();
    if (network.isInternetReachable === false) return { review: 'uncertain' };
    const prepared = await defaultStages.warper.warpAndLetterbox(captureFileUri(photo.path), null, captureOptions.inputSize);
    if (!prepared) return { review: 'uncertain' };
    cropUri = prepared.cropUri;
    const features = await extractFeatures(cropUri, defaultStages);
    if (!session.isCurrent()) return { review: 'uncertain' };
    const result = await Promise.race([convex.action(api.identify.identify, { ...features, scope: session.scope, localId: photo.localId,
      modelVersion: captureOptions.modelVersion, capturedAt: photo.capturedAt }), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Recognition timed out')), 15_000); })]);
    const classification = albumMatch(result, targetObjectId);
    return { review: classification === 'same' ? undefined : classification, recognized: result.outcome === 'confident' && result.best ? {
      title: result.best.title, artist: result.best.artist, objectId: result.best.objectId, artworkId: result.best.artworkId,
    } : undefined };
  } catch { return { review: 'uncertain' }; }
  finally { clearTimeout(timeout); if (cropUri) { const file = new File(cropUri); if (file.exists) file.delete(); } }
}
