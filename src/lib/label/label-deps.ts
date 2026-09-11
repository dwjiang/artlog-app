import type { FunctionArgs } from 'convex/server';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import model from '../../../shared/model-version.json';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { LabelFlowDisplay } from '../../../convex/lib/validators';
import { getVisionRect } from '../../../modules/vision-rect/src';
import { getCaptureForScan } from '@/db/repos/pending-scans';
import type { ScanFeatures } from '@/lib/capture/features';
import { convex } from '@/lib/convex-client';
import { embedder } from '@/lib/embed/embedder';
import { filePath } from '@/lib/file-uri';
import { extractOrb } from '@/lib/orb/extract';
import { prepareLabelPhoto, removeFile } from './crop';
import { clearLabelDraft } from './draft';
import { runLabelFlow, type LabelApi, type LabelStage } from './flow';
import { checkImages, type ImageCheckDeps } from './image-check';

export type LabelSource = { labelPhotoUri?: string; qrUrl?: string };

export const labelApi: LabelApi = {
  fetchQr: (args: FunctionArgs<typeof api.label.fetchQr>) => convex.action(api.label.fetchQr, args),
  readLabel: (args: FunctionArgs<typeof api.label.readLabel>) => convex.action(api.label.readLabel, args),
  verifyLabel: (args: FunctionArgs<typeof api.label.verifyLabel>) => convex.action(api.label.verifyLabel, args),
};

const IMAGE_FOLDER = 'label-images';

function extension(url: string): string {
  const match = /\.[a-z0-9]{3,4}$/i.exec(new URL(url).pathname);
  return match ? match[0].toLowerCase() : '.jpg';
}

export const imageCheckDeps: ImageCheckDeps = {
  async download(url) {
    const directory = new Directory(Paths.cache, IMAGE_FOLDER);
    directory.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(url, new File(directory, `${randomUUID()}${extension(url)}`));
    return file.uri;
  },
  async letterbox(uri) {
    // No quad: the museum's reproduction is letterboxed whole, as the index build does (jobs letterbox.py).
    const result = await getVisionRect().warpAndLetterbox(filePath(uri), undefined, model.inputSize);
    return `file://${result.cropPath}`;
  },
  embed: (uri) => embedder.embed(uri),
  extractOrb: (uri) => extractOrb(uri),
  remove: removeFile,
};

export function imageCheckFor(scan: ScanFeatures): (urls: string[]) => ReturnType<typeof checkImages> {
  return (urls) => checkImages(urls, scan, imageCheckDeps, { inputSize: model.inputSize });
}

/** The label flow for a scan captured on this phone: the queue's path (03.06) and the label screen's. */
export async function runLabelFlowForScan(
  scanId: Id<'scans'>,
  source: LabelSource,
  onStage?: (stage: LabelStage) => void,
): Promise<LabelFlowDisplay> {
  await clearLabelDraft(scanId);
  const capture = await getCaptureForScan(scanId);
  return runLabelFlow({
    scanId, ...source, api: labelApi, onStage,
    encodePhoto: async (uri) => (await prepareLabelPhoto(uri)).base64,
    checkImages: capture ? imageCheckFor(capture) : undefined,
  });
}
