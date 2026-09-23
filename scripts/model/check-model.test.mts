import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, test } from "node:test";

let directory: string;
let models: string;
let compiled: string;
const contract = { modelVersion: "test-v1", inputSize: 512, embeddingDim: 1536 };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "artlog-model-test-"));
  models = join(directory, "modules/coreml-embed/ios/Models");
  compiled = join(models, "TestModel.mlmodelc");
  await mkdir(join(compiled, "weights"), { recursive: true });
  await mkdir(join(compiled, "analytics"));
  await mkdir(join(directory, "scripts/model"), { recursive: true });
  await mkdir(join(directory, "shared/model"), { recursive: true });
  await copyFile(
    new URL("./check-model.mts", import.meta.url),
    join(directory, "scripts/model/check-model.mts"),
  );
  await writeFile(join(directory, "shared/model/model-version.json"), JSON.stringify(contract));
  await writeFile(
    join(models, "model-manifest.json"),
    JSON.stringify({
      ...contract,
      modelName: "TestModel",
      weightsSha256: createHash("sha256").update("test weights").digest("hex"),
    }),
  );
  for (const file of ["coremldata.bin", "analytics/coremldata.bin", "model.mil", "metadata.json"]) {
    await writeFile(join(compiled, file), "compiled model");
  }
  await writeFile(join(compiled, "weights/weight.bin"), "test weights");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function checkModel(...args: string[]) {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", join(directory, "scripts/model/check-model.mts"), ...args],
    {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

test("accepts a complete model in a build archive without Git or installed dependencies", () => {
  assert.match(checkModel(), /Model test-v1 ready/);
});

test("can validate a freshly compiled model before replacing the tracked package", async () => {
  const staging = join(directory, "compiled");
  await rename(models, staging);
  assert.match(checkModel(staging), /Model test-v1 ready/);
});

test("explains how to recover a missing model", async () => {
  await rm(models, { recursive: true });
  assert.throws(checkModel, /git lfs pull/);
});

test("rejects unresolved LFS pointers before native compilation", async () => {
  for (const file of [
    "coremldata.bin",
    "analytics/coremldata.bin",
    "model.mil",
    "metadata.json",
    "weights/weight.bin",
  ]) {
    const path = join(compiled, file);
    const original = await readFile(path);
    await writeFile(path, "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 100\n");
    assert.throws(checkModel, /Git LFS pointer.*git lfs pull/);
    await writeFile(path, original);
  }
});

test("rejects incomplete compiled packages", async () => {
  await rm(join(compiled, "model.mil"));
  assert.throws(checkModel, /model.mil.*git lfs pull/);
});

test("rejects a model whose version or dimensions do not match the app", async () => {
  const path = join(directory, "shared/model/model-version.json");
  for (const change of [{ modelVersion: "test-v2" }, { inputSize: 224 }, { embeddingDim: 768 }]) {
    await writeFile(path, JSON.stringify({ ...contract, ...change }));
    assert.throws(checkModel, /does not match shared\/model\/model-version.json/);
  }
});

test("rejects corrupted weights even when the model version is correct", async () => {
  await writeFile(join(compiled, "weights/weight.bin"), "wrong weights");
  assert.throws(checkModel, /weights.*SHA-256/);
});

async function compilerFixture() {
  const script = join(directory, "scripts/model/compile-model.sh");
  const output = join(directory, "export with spaces");
  const bin = join(directory, "bin");
  const result = join(directory, "compiler-result");
  await copyFile(new URL("./compile-model.sh", import.meta.url), script);
  await mkdir(output);
  await mkdir(bin);
  await mkdir(result);
  await cp(compiled, join(result, "TestModel.mlmodelc"), { recursive: true });
  await copyFile(join(models, "model-manifest.json"), join(output, "model-manifest.json"));
  await writeFile(join(bin, "xcrun"), '#!/bin/sh\ncp -R "$ARTLOG_TEST_COMPILED/." "$4/"\n');
  await chmod(join(bin, "xcrun"), 0o755);
  const compile = () =>
    execFileSync("bash", [script, output], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARTLOG_TEST_COMPILED: result },
    });
  return { compile, output };
}

test("installs a validated compiler result into the tracked model directory", async () => {
  const { compile } = await compilerFixture();
  await rm(models, { recursive: true });
  assert.match(compile(), /Compiled model ready/);
  assert.match(checkModel(), /Model test-v1 ready/);
});

test("keeps the existing model when a new export does not match the app", async () => {
  const { compile, output } = await compilerFixture();
  const manifest = JSON.parse(await readFile(join(output, "model-manifest.json"), "utf8"));
  await writeFile(
    join(output, "model-manifest.json"),
    JSON.stringify({ ...manifest, modelVersion: "wrong" }),
  );
  assert.throws(compile, /does not match/);
  assert.match(checkModel(), /Model test-v1 ready/);
});
