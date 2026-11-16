'use strict';
const OWNER = 'ItsDeimox';
const REPO = 'configura';
const RELEASES_URL = 'https://github.com/' + OWNER + '/' + REPO + '/releases/latest';
const elements = {
  download: document.getElementById('download-link'),
  portable: document.getElementById('portable-link'),
  versionText: document.getElementById('version-text'),
  versionStat: document.getElementById('version-stat'),
  versionNumber: document.getElementById('version-number'),
  countStat: document.getElementById('download-stat'),
  count: document.getElementById('download-count')
};
function isInstaller(asset) {
  return typeof asset?.name === 'string' && /setup.*x64\.exe$/i.test(asset.name);
}
function isPortable(asset) {
  return typeof asset?.name === 'string' && /-x64\.zip$/i.test(asset.name);
}
function fromReleases(releases) {
  const stable = releases.filter(r => !r.draft && !r.prerelease && Array.isArray(r.assets))
    .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
  const downloadable = stable.find(r => r.assets.some(isInstaller));
  if (!downloadable) throw new Error('Sem instalador publicado');
  const installer = downloadable.assets.find(isInstaller);
  const portable = downloadable.assets.find(isPortable);
  const totalDownloads = stable.reduce((sum, release) =>
    sum + release.assets.filter(a => isInstaller(a) || isPortable(a))
      .reduce((n, a) => n + (Number.isFinite(a.download_count) ? a.download_count : 0), 0), 0);
  return {
    version: downloadable.tag_name,
    downloadUrl: installer.browser_download_url,
    portableUrl: portable?.browser_download_url,
    totalDownloads
  };
}
function render(data) {
  if (typeof data.downloadUrl === 'string' && data.downloadUrl.startsWith('https://github.com/')) {
    elements.download.href = data.downloadUrl;
    elements.download.setAttribute('aria-label', 'Baixar instalador do Ini Studio para Windows');
  }
  if (typeof data.portableUrl === 'string' && data.portableUrl.startsWith('https://github.com/')) {
    elements.portable.href = data.portableUrl;
  }
  if (typeof data.version === 'string' && /^v?\d+\.\d+\.\d+/.test(data.version)) {
    elements.versionNumber.textContent = data.version;
    elements.versionStat.hidden = false;
    elements.versionText.textContent = 'Windows 10/11 · x64 · ' + data.version;
  }
  if (Number.isSafeInteger(data.totalDownloads) && data.totalDownloads >= 0) {
    elements.count.textContent = new Intl.NumberFormat('pt-BR').format(data.totalDownloads);
    elements.countStat.hidden = false;
    elements.countStat.title = 'Soma dos downloads de instaladores .exe e versões portáteis .zip das releases estáveis do GitHub.';
  }
}
async function load() {
  try {
    const response = await fetch('/api/releases', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Endpoint indisponível');
    render(await response.json());
  } catch (_) {
    try {
      const response = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error('API indisponível');
      render(fromReleases(await response.json()));
    } catch (_) {
      // Keep a valid GitHub releases link; never fabricate a counter or version.
      elements.download.href = RELEASES_URL;
      elements.portable.href = RELEASES_URL;
    }
  }
}
load();
