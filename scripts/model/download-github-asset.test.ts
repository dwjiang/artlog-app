import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { downloadGitHubAsset } from './download-github-asset.ts';

const url = 'https://github.com/artlog/private-model/releases/download/model-v1/model.zip';
const api = 'https://api.github.com/repos/artlog/private-model/releases';
let directory: string;
let previousEnvironment: NodeJS.ProcessEnv;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'artlog-download-test-'));
  previousEnvironment = { ...process.env };
  process.env.GH_TOKEN = 'test-token';
});

afterEach(async () => {
  mock.restoreAll();
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'PATH']) {
    const value = previousEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(directory, { recursive: true, force: true });
});

function withoutGitHubAuthentication(): void {
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.PATH = directory;
}

test('downloads a public release without a token or the GitHub CLI', async () => {
  withoutGitHubAuthentication();
  const calls: { url: string; headers: Headers }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers) });
    if (calls.length === 1) return Response.json({ assets: [{ id: 42, name: 'model.zip' }] });
    return new Response(Uint8Array.of(80, 75, 3, 4));
  });
  const destination = join(directory, 'model.zip');
  await downloadGitHubAsset(url, destination);
  assert.deepEqual(calls.map((call) => call.url), [`${api}/tags/model-v1`, `${api}/assets/42`]);
  for (const call of calls) assert.equal(call.headers.has('Authorization'), false);
  assert.deepEqual([...await readFile(destination)], [80, 75, 3, 4]);
});

test('explains how to authenticate when an anonymous release lookup is refused', async () => {
  withoutGitHubAuthentication();
  const request = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  await assert.rejects(downloadGitHubAsset(url, join(directory, 'model.zip')), (error: Error) => {
    assert.match(error.message, /HTTP 404/);
    assert.match(error.message, /gh auth login/);
    assert.match(error.message, /GH_TOKEN.*Contents: read/);
    return true;
  });
  assert.equal(request.mock.callCount(), 1);
});

test('authenticates the release lookup and downloads the matching asset through the API', async () => {
  const calls: { url: string; headers: Headers }[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers) });
    if (calls.length === 1) return Response.json({ assets: [{ id: 1, name: 'unrelated.zip' }, { id: 42, name: 'model.zip' }] });
    return new Response(Uint8Array.of(80, 75, 3, 4));
  });
  const destination = join(directory, 'model.zip');
  await downloadGitHubAsset(url, destination);
  assert.deepEqual(calls.map((call) => call.url), [`${api}/tags/model-v1`, `${api}/assets/42`]);
  for (const call of calls) assert.equal(call.headers.get('Authorization'), 'Bearer test-token');
  assert.equal(calls[1].headers.get('Accept'), 'application/octet-stream');
  assert.deepEqual([...await readFile(destination)], [80, 75, 3, 4]);
});

test('explains missing releases or insufficient token access without exposing the token', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }));
  await assert.rejects(downloadGitHubAsset(url, join(directory, 'model.zip')), (error: Error) => {
    assert.match(error.message, /HTTP 404.*published.*Contents: read/);
    assert.ok(!error.message.includes('test-token'));
    return true;
  });
});

test('refuses a release without the pinned asset', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ assets: [{ id: 1, name: 'other.zip' }] }));
  await assert.rejects(downloadGitHubAsset(url, join(directory, 'model.zip')), /no asset named model.zip/);
  assert.equal(request.mock.callCount(), 1);
});

test('rejects failed asset downloads', async () => {
  let requests = 0;
  mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? Response.json({ assets: [{ id: 42, name: 'model.zip' }] })
    : new Response(null, { status: 403 }));
  await assert.rejects(downloadGitHubAsset(url, join(directory, 'model.zip')), /asset download: HTTP 403/);
});

test('never sends GitHub credentials to an arbitrary URL', async () => {
  const request = mock.method(globalThis, 'fetch', async () => new Response());
  await assert.rejects(downloadGitHubAsset('https://example.org/model.zip', join(directory, 'model.zip')), /GitHub release asset URL/);
  assert.equal(request.mock.callCount(), 0);
});

test('runs the command when invoked through a symlink', async () => {
  const alias = join(directory, 'download.ts');
  await symlink(fileURLToPath(new URL('./download-github-asset.ts', import.meta.url)), alias);
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', alias, 'https://example.org/model.zip', join(directory, 'model.zip'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected a GitHub release asset URL/);
});

async function modelFixture() {
  const version = 'test-v1';
  const scripts = join(directory, 'scripts/model');
  const modelFiles = join(directory, 'package');
  const models = join(directory, 'modules/coreml-embed/ios/Models');
  await mkdir(scripts, { recursive: true });
  await mkdir(join(directory, 'shared'));
  await mkdir(join(modelFiles, 'TestModel.mlmodelc'), { recursive: true });
  await writeFile(join(modelFiles, 'TestModel.mlmodelc/model.bin'), 'test weights');
  await writeFile(join(modelFiles, 'model-manifest.json'), JSON.stringify({ modelVersion: version, modelName: 'TestModel' }));
  await copyFile(new URL('./fetch-model.sh', import.meta.url), join(scripts, 'fetch-model.sh'));
  await writeFile(join(directory, 'shared/model-version.json'), JSON.stringify({ modelVersion: version }));
  const archive = join(directory, 'model.zip');
  execFileSync('zip', ['-qr', archive, 'TestModel.mlmodelc', 'model-manifest.json'], { cwd: modelFiles });
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(join(scripts, 'model-asset.json'), JSON.stringify({ modelVersion: version, sha256, url }));
  const fetchModel = () => execFileSync('bash', [join(scripts, 'fetch-model.sh')], {
    env: { ...process.env, MODEL_ASSET_URL: pathToFileURL(archive).href }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { archive, fetchModel, models, sha256 };
}

test('installs a verified local model override and reuses the matching asset', async () => {
  const { archive, fetchModel, models, sha256 } = await modelFixture();
  fetchModel();
  assert.equal(await readFile(join(models, 'TestModel.mlmodelc/model.bin'), 'utf8'), 'test weights');
  assert.equal((await readFile(join(models, '.asset-sha256'), 'utf8')).trim(), sha256);
  await rm(archive);
  assert.match(fetchModel(), /already in/);
});

test('rejects a changed archive before replacing an installed model', async () => {
  const { archive, fetchModel, models } = await modelFixture();
  await mkdir(models, { recursive: true });
  await writeFile(join(models, 'existing-model'), 'preserve until verified');
  await writeFile(archive, 'corrupt download');
  assert.throws(fetchModel, /does not match the pinned/);
  assert.equal(await readFile(join(models, 'existing-model'), 'utf8'), 'preserve until verified');
});
