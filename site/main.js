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


/* Motion is independent of the OS-wide animations toggle.
   A persistent in-page control is available for accessibility/performance. */
(function initMotion() {
  const root = document.documentElement;
  const toggle = document.getElementById('effects-toggle');
  const label = document.getElementById('effects-label');
  const reveal = [...document.querySelectorAll('[data-reveal]')];
  const storage = 'ini-studio.effects.enabled';
  let enabled = true;
  try { enabled = localStorage.getItem(storage) !== 'false'; } catch (_) {}

  function setEffects(on) {
    enabled = on;
    root.classList.toggle('effects-off', !on);
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Desativar efeitos visuais' : 'Ativar efeitos visuais');
    label.textContent = on ? 'Efeitos ativos' : 'Efeitos pausados';
    window.dispatchEvent(new CustomEvent('ini-studio:effects', { detail: { enabled: on } }));
    try { localStorage.setItem(storage, String(on)); } catch (_) {}
  }
  toggle.addEventListener('click', () => setEffects(!enabled));
  setEffects(enabled);

  // Content stays accessible even without IntersectionObserver or JS.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -35px 0px', threshold: .08 });
    for (const element of reveal) {
      if (element.getBoundingClientRect().top < innerHeight * .92) {
        element.classList.add('is-visible');
      } else {
        observer.observe(element);
      }
    }
    root.classList.add('visual-ready');
  } else {
    reveal.forEach(e => e.classList.add('is-visible'));
  }

  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  for (const surface of document.querySelectorAll('.energy-surface')) {
    const preview = surface.id === 'app-preview';
    let last = null, raf = 0;
    function paintPointer() {
      raf = 0;
      if (!last || !enabled) return;
      const box = surface.getBoundingClientRect();
      const x = Math.max(0, Math.min(box.width, last.clientX - box.left));
      const y = Math.max(0, Math.min(box.height, last.clientY - box.top));
      surface.style.setProperty('--spot-x', x.toFixed(1) + 'px');
      surface.style.setProperty('--spot-y', y.toFixed(1) + 'px');
      if (preview && finePointer.matches) {
        const nx = x / Math.max(box.width,1) - .5;
        const ny = y / Math.max(box.height,1) - .5;
        surface.style.setProperty('--tilt-x', (-ny * 4.2).toFixed(2) + 'deg');
        surface.style.setProperty('--tilt-y', (nx * 5.2).toFixed(2) + 'deg');
      }
    }
    surface.addEventListener('pointermove', e => {
      last = e;
      if (!raf) raf = requestAnimationFrame(paintPointer);
    }, { passive: true });
    surface.addEventListener('pointerleave', () => {
      last = null; if(raf)cancelAnimationFrame(raf);raf=0;
      if (preview) {
        surface.style.setProperty('--tilt-x','0deg');
        surface.style.setProperty('--tilt-y','0deg');
      }
    });
    surface.addEventListener('blur', () => {
      if (preview) {
        surface.style.setProperty('--tilt-x','0deg');
        surface.style.setProperty('--tilt-y','0deg');
      }
    });
  }
})();
