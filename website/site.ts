import './styles.css';
import { createWelcomeArt } from '../src/renderer/welcomeArt';

const metal = document.getElementById('metal');
if (metal) {
  try { metal.replaceChildren(createWelcomeArt()); } catch { /* The transparent still remains the no-WebGL fallback. */ }
}

// Progressive enhancement only: the static 0.1.8 links work without JavaScript
// or if GitHub's unauthenticated API is unavailable/rate-limited.
const patterns: Record<string, RegExp> = {
  windows: /setup.*\.exe$/i,
  portable: /^Orion[. -][\d.]+\.exe$/i,
  appimage: /\.AppImage$/i,
  deb: /\.deb$/i,
  rpm: /\.rpm$/i,
};
async function refreshRelease() {
  const response = await fetch('https://api.github.com/repos/quietsource/Orion/releases/latest', { signal: AbortSignal.timeout(6000), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) return;
  const release = await response.json() as { tag_name?: string; html_url?: string; assets?: Array<{name:string;browser_download_url:string}> };
  const safe = (url: string) => { try { const value = new URL(url); return value.protocol === 'https:' && value.hostname === 'github.com' && value.pathname.startsWith('/quietsource/Orion/releases/'); } catch { return false; } };
  for (const [key, pattern] of Object.entries(patterns)) {
    const asset = release.assets?.find(item => pattern.test(item.name));
    if (asset && safe(asset.browser_download_url)) document.querySelectorAll<HTMLAnchorElement>(`[data-asset="${key}"]`).forEach(link => { link.href = asset.browser_download_url; });
  }
  const label = document.getElementById('release-version') as HTMLAnchorElement | null;
  if (label && release.tag_name && release.html_url && safe(release.html_url)) { label.textContent = release.tag_name; label.href = release.html_url; }
}
void refreshRelease().catch(() => { /* Preserve working static download links. */ });
