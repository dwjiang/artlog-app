import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const models = resolve(process.argv[2] ?? join(root, 'modules/coreml-embed/ios/Models'));
const recovery = 'Run `git lfs install` and `git lfs pull` before building or uploading to EAS.';
const lfsPointerPrefix = 'version https://git-lfs.github.com/spec/v1';

function modelFile(path: string): Buffer {
  if (!existsSync(path)) throw new Error(`Missing model file ${path}. ${recovery}`);
  const contents = readFileSync(path);
  if (contents.subarray(0, lfsPointerPrefix.length).toString() === lfsPointerPrefix) {
    throw new Error(`Git LFS pointer found at ${path}. ${recovery}`);
  }
  if (contents.length === 0) throw new Error(`Empty model file ${path}. ${recovery}`);
  return contents;
}

try {
  const manifest = JSON.parse(modelFile(join(models, 'model-manifest.json')).toString());
  const expected = JSON.parse(readFileSync(join(root, 'shared/model/model-version.json'), 'utf8'));
  for (const key of ['modelVersion', 'inputSize', 'embeddingDim']) {
    if (manifest[key] !== expected[key]) {
      throw new Error(`Model ${key} ${manifest[key]} does not match shared/model/model-version.json (${expected[key]}).`);
    }
  }
  const compiled = join(models, `${manifest.modelName}.mlmodelc`);
  for (const file of ['coremldata.bin', 'analytics/coremldata.bin', 'model.mil', 'metadata.json']) {
    modelFile(join(compiled, file));
  }
  const weights = modelFile(join(compiled, 'weights/weight.bin'));
  if (createHash('sha256').update(weights).digest('hex') !== manifest.weightsSha256) {
    throw new Error('Model weights do not match the manifest SHA-256. Restore the tracked model files before building.');
  }
  console.log(`Model ${manifest.modelVersion} ready in ${models}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
