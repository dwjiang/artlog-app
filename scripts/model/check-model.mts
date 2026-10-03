import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const models = resolve(process.argv[2] ?? join(root, "modules/coreml-embed/ios/Models"));
const recovery = "Run `git lfs install` and `git lfs pull` before building or uploading to EAS.";
const lfsPointerPrefix = "version https://git-lfs.github.com/spec/v1";
const notices = join(root, "modules/coreml-embed/ios/model-notices/c-radio-v3-b");
// SHA-256 of NVIDIA's unchanged June 14, 2024 agreement, linked in Notice.txt.
const licenseSha256 = "396d7de220f6b0e6fcfe33836f1b99a9943769b97c56330444f8efe1b441f607";

function modelFile(path: string): Buffer {
  if (!existsSync(path)) {
    throw new Error(`Missing model file ${path}. ${recovery}`);
  }
  const contents = readFileSync(path);
  if (contents.subarray(0, lfsPointerPrefix.length).toString() === lfsPointerPrefix) {
    throw new Error(`Git LFS pointer found at ${path}. ${recovery}`);
  }
  if (contents.length === 0) {
    throw new Error(`Empty model file ${path}. ${recovery}`);
  }
  return contents;
}

try {
  const manifest = JSON.parse(modelFile(join(models, "model-manifest.json")).toString());
  const expected = JSON.parse(readFileSync(join(root, "shared/model/model-version.json"), "utf8"));
  for (const key of ["modelVersion", "inputSize", "embeddingDim"]) {
    if (manifest[key] !== expected[key]) {
      throw new Error(
        `Model ${key} ${manifest[key]} does not match shared/model/model-version.json (${expected[key]}).`,
      );
    }
  }
  const compiled = join(models, `${manifest.modelName}.mlmodelc`);
  for (const file of ["coremldata.bin", "analytics/coremldata.bin", "model.mil", "metadata.json"]) {
    modelFile(join(compiled, file));
  }
  const weights = modelFile(join(compiled, "weights/weight.bin"));
  if (createHash("sha256").update(weights).digest("hex") !== manifest.weightsSha256) {
    throw new Error(
      "Model weights do not match the manifest SHA-256. Restore the tracked model files before building.",
    );
  }
  for (const file of ["Notice.txt", "nvidia-open-model-license.pdf"]) {
    if (!existsSync(join(notices, file))) {
      throw new Error(`Missing NVIDIA legal resource ${file}. Restore modules/coreml-embed/ios/model-notices.`);
    }
  }
  const license = readFileSync(join(notices, "nvidia-open-model-license.pdf"));
  if (createHash("sha256").update(license).digest("hex") !== licenseSha256) {
    throw new Error("NVIDIA model license does not match the official agreement SHA-256. Restore model-notices.");
  }
  const notice = readFileSync(join(notices, "Notice.txt"), "utf8");
  if (!notice.includes("Licensed by NVIDIA Corporation under the NVIDIA Open Model License")) {
    throw new Error("NVIDIA model notice is missing the required attribution. Restore model-notices.");
  }
  console.log(`Model ${manifest.modelVersion} ready in ${models}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
