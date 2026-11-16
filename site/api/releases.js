const GITHUB_API = 'https://api.github.com/repos/ItsDeimox/configura/releases?per_page=100';
const isInstaller = asset => typeof asset?.name === 'string' && /setup.*x64\.exe$/i.test(asset.name);
const isPortable = asset => typeof asset?.name === 'string' && /-x64\.zip$/i.test(asset.name);
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const response = await fetch(GITHUB_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'IniStudio-Download-Site' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('GitHub returned ' + response.status);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid release list');
    const stable = releases
      .filter(release => !release.draft && !release.prerelease && Array.isArray(release.assets))
      .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
    const current = stable.find(release => release.assets.some(isInstaller));
    if (!current) return res.status(404).json({ error: 'No Windows release yet' });
    const installer = current.assets.find(isInstaller);
    const portable = current.assets.find(isPortable);
    const totalDownloads = stable.reduce((sum, release) =>
      sum + release.assets.filter(asset => isInstaller(asset) || isPortable(asset))
        .reduce((n, asset) => n + (Number.isSafeInteger(asset.download_count) ? asset.download_count : 0), 0), 0);
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    return res.status(200).json({
      version: current.tag_name,
      downloadUrl: installer.browser_download_url,
      portableUrl: portable?.browser_download_url || null,
      totalDownloads,
      latestReleaseUrl: current.html_url
    });
  } catch (error) {
    console.error('Release metadata unavailable:', error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Release metadata temporarily unavailable' });
  }
};
