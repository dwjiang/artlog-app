import { Asset } from 'expo-asset';
import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

// The 200 Met calibration URLs shared with the index build's drift check (plan 02.04).
import calibrationUrlsAsset from '../../../shared/model/calibration/urls.txt';
import model from '../../../shared/model/model-version.json';

import { getVisionRect } from '../../../modules/vision-rect/src';
import { filePath } from '@/lib/file-uri';
import { collectCalibrationEmbeddings, parseCalibrationUrls } from './calibration-export';
import { embedder } from './embedder';

export type CalibrationReport = {
  modelVersion: string;
  inputSize: number;
  embeddingDim: number;
  normalized: true;
  count: number;
  embedMedianMs: number;
  device: string;
  simulator: boolean;
  os: string;
  exportedAt: string;
};

/**
 * Dev-only. Embeds the calibration paintings through the production letterbox and model, writes
 * `iphone-embeddings.json` and a report to the cache, and opens the share sheet so the file can be
 * committed as `jobs/calibration/iphone-embeddings.json` for the index build's drift check.
 */
export async function runCalibrationExport(
  onProgress?: (done: number, total: number) => void,
): Promise<{ fileUri: string; report: CalibrationReport }> {
  const directory = new Directory(Paths.cache, 'calibration');
  const images = new Directory(directory, 'images');
  images.create({ intermediates: true, idempotent: true });
  const { embeddings, embedMedianMs } = await collectCalibrationEmbeddings({
    urls: readCalibrationUrls,
    async download(url, index) {
      const file = new File(images, `${index}.jpg`);
      // One Met URL contains a space; the embeddings stay keyed by the raw line from urls.txt.
      if (!file.exists) await File.downloadFileAsync(encodeURI(url), file);
      return filePath(file.uri);
    },
    async letterbox(path) {
      const result = await getVisionRect().warpAndLetterbox(path, undefined, model.inputSize);
      return `file://${result.cropPath}`;
    },
    embed: (cropUri) => embedder.embed(cropUri),
    now: () => performance.now(),
  }, onProgress);
  const report: CalibrationReport = {
    modelVersion: model.modelVersion,
    inputSize: model.inputSize,
    embeddingDim: model.embeddingDim,
    normalized: true,
    count: Object.keys(embeddings).length,
    embedMedianMs,
    device: Device.modelId ?? Device.modelName ?? 'unknown',
    simulator: !Device.isDevice,
    os: `${Device.osName ?? 'iOS'} ${Device.osVersion ?? ''}`.trim(),
    exportedAt: new Date().toISOString(),
  };
  const embeddingsFile = new File(directory, 'iphone-embeddings.json');
  embeddingsFile.write(JSON.stringify(embeddings));
  new File(directory, 'iphone-report.json').write(JSON.stringify(report, null, 2) + '\n');
  await Share.share({ url: embeddingsFile.uri });
  return { fileUri: embeddingsFile.uri, report };
}

async function readCalibrationUrls(): Promise<string[]> {
  const asset = await Asset.fromModule(calibrationUrlsAsset).downloadAsync();
  if (!asset.localUri) throw new Error('The calibration URL list is not bundled');
  return parseCalibrationUrls(await new File(asset.localUri).text());
}
