import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type UpdateAsset = { name: string; browser_download_url: string; size: number; digest?: string | null };
export type AppUpdate = { version: string; tag: string; notes: string; assets: UpdateAsset[] };
export type UpdateProgress = { phase: 'downloading'|'ready'|'error'; version: string; received: number; total: number; detail: string };

function versionParts(value: string) {
  const match = value.replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string) {
  const next = versionParts(candidate), installed = versionParts(current);
  if (!next || !installed || /-(?:alpha|beta|rc|pre)/i.test(candidate)) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index]! > installed[index]!;
  }
  return false;
}

export async function findLatestUpdate(currentVersion: string): Promise<AppUpdate | null> {
  const response = await fetch('https://api.github.com/repos/quietsource/Orion/releases/latest', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orion-Desktop-Updater', 'x-github-api-version': '2022-11-28' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Release check returned HTTP ${response.status}.`);
  const release = await response.json() as { tag_name?: unknown; body?: unknown; prerelease?: unknown; draft?: unknown; assets?: unknown };
  if (release.prerelease === true || release.draft === true || typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.replace(/^v/i, '');
  if (!isNewerVersion(version, currentVersion)) return null;
  const assets = Array.isArray(release.assets) ? release.assets.filter((asset): asset is UpdateAsset => {
    if (!asset || typeof asset !== 'object') return false;
    const value = asset as Partial<UpdateAsset>;
    return typeof value.name === 'string' && typeof value.browser_download_url === 'string' && Number.isFinite(value.size);
  }) : [];
  return { version, tag: release.tag_name, notes: typeof release.body === 'string' ? release.body : '', assets };
}

export async function downloadUpdateAsset(asset: UpdateAsset, destination: string, onProgress: (progress: UpdateProgress) => void) {
  const response = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'Orion-Desktop-Updater', accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Could not download ${asset.name} (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || asset.size;
  const handle = await fs.open(destination, 'wx', 0o600);
  const digest = createHash('sha256');
  const reader = response.body.getReader();
  let received = 0;
  let lastUpdate = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      await handle.writeFile(chunk);
      digest.update(chunk);
      received += chunk.length;
      if (Date.now() - lastUpdate > 150) {
        onProgress({ phase: 'downloading', version: '', received, total, detail: `Downloading update · ${Math.floor(received / 1_048_576)} MB` });
        lastUpdate = Date.now();
      }
    }
    await handle.sync();
  } catch (error) {
    await fs.rm(destination, { force: true });
    throw error;
  } finally { await handle.close(); }
  const actualDigest = digest.digest('hex');
  if (received !== asset.size) {
    await fs.rm(destination, { force: true });
    throw new Error(`The update download was incomplete (${received} of ${asset.size} bytes).`);
  }
  const expectedDigest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
  if (expectedDigest && actualDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
    await fs.rm(destination, { force: true });
    throw new Error('The downloaded update failed its SHA-256 integrity check.');
  }
  return { received, total, digest: actualDigest, path: path.resolve(destination) };
}
