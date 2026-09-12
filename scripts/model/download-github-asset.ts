import { execFileSync } from 'node:child_process';
import { createWriteStream, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

function githubToken(): string | undefined {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) return token;
  try {
    return execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function downloadGitHubAsset(url: string, destination: string): Promise<void> {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/.exec(url);
  if (!match) throw new Error('Expected a GitHub release asset URL');
  const [, owner, repo, tag, filename] = match;
  const api = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const releaseResponse = await fetch(`${api}/tags/${tag}`, { headers });
  if (!releaseResponse.ok) {
    throw new Error(`GitHub release ${decodeURIComponent(tag)}: HTTP ${releaseResponse.status}. Check that the release is published. For a private release, run \`gh auth login\` or set GH_TOKEN with repository Contents: read access.`);
  }
  const release = await releaseResponse.json() as { assets: { id: number; name: string }[] };
  const asset = release.assets.find((item) => item.name === decodeURIComponent(filename));
  if (!asset) throw new Error(`The release has no asset named ${decodeURIComponent(filename)}`);

  // The release-asset API authenticates private downloads; browser download URLs do not.
  // Fetch strips Authorization when following the redirect to GitHub's asset storage host.
  const response = await fetch(`${api}/assets/${asset.id}`, {
    headers: { ...headers, Accept: 'application/octet-stream' },
  });
  if (!response.ok || !response.body) throw new Error(`GitHub asset download: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(destination));
}

// realpath: macOS /tmp and /var are symlinks, and import.meta.url is already resolved.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  downloadGitHubAsset(process.argv[2], process.argv[3]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
