const CACHE_NAME = 'easyresume-pwa-v2026.11.1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './responsive-fixes.css',
  './logo.png',
  './logo-192.png'
];

const RESPONSIVE_STYLESHEET = '<link rel="stylesheet" href="./responsive-fixes.css?v=dashboard-toolbar-cards-4">';
const DASHBOARD_FIX_SCRIPT = `<script>
(() => {
  const isVisible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const markDashboardControls = () => {
    const dashboard = document.querySelector('#view-dashboard');
    const dashboardActive = isVisible(dashboard);
    document.body.classList.toggle('dashboard-active', dashboardActive);
    document.documentElement.classList.toggle('dashboard-active', dashboardActive);

    document.querySelectorAll('.dashboard-preview-control').forEach((element) => {
      element.classList.remove('dashboard-preview-control');
    });
    document.querySelectorAll('.compact-saved-resume-card').forEach((element) => {
      element.classList.remove('compact-saved-resume-card');
    });
    if (!dashboardActive) return;

    const header = document.querySelector('header, [role="banner"]') || document.body;
    header.querySelectorAll('button, [role="button"], a').forEach((control) => {
      const label = [control.innerText, control.getAttribute('aria-label'), control.getAttribute('title')]
        .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
      if (/print|pdf|^edit$|^view$|zoom in|zoom out/.test(label)) {
        control.classList.add('dashboard-preview-control');
      }
    });

    // Detect the zoom widget by its percentage label and hide the entire compact control group.
    document.querySelectorAll('button, [role="button"], span, div').forEach((element) => {
      if (element.children.length > 4 || !/^\\d{1,3}\\s*%$/.test((element.innerText || '').trim())) return;
      let group = element;
      for (let depth = 0; depth < 3 && group.parentElement && group.parentElement !== header; depth++) {
        const parent = group.parentElement;
        if (parent.querySelectorAll('button, [role="button"]').length >= 2) {
          group = parent;
          break;
        }
        group = parent;
      }
      group.classList.add('dashboard-preview-control');
    });

    // Locate the saved-resumes panel by its heading and tag its bordered resume cards.
    const heading = [...dashboard.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span')]
      .find((element) => element.children.length < 3 && (element.innerText || '').trim().toLowerCase() === 'saved resumes');
    if (!heading) return;
    let panel = heading.parentElement;
    for (let depth = 0; depth < 6 && panel && panel !== dashboard; depth++, panel = panel.parentElement) {
      const profileImages = [...panel.querySelectorAll('img')].filter(isVisible);
      if (!profileImages.length) continue;
      profileImages.forEach((image) => {
        let card = image.parentElement;
        while (card && card !== panel) {
          const style = getComputedStyle(card);
          const rect = card.getBoundingClientRect();
          const hasCardSurface = style.borderTopWidth !== '0px' || style.boxShadow !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)';
          if (hasCardSurface && rect.width >= image.getBoundingClientRect().width && rect.height > image.getBoundingClientRect().height) {
            card.classList.add('compact-saved-resume-card');
            break;
          }
          card = card.parentElement;
        }
      });
      break;
    }
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; markDashboardControls(); });
  };

  document.addEventListener('DOMContentLoaded', () => {
    markDashboardControls();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
  }, { once: true });
  if (document.readyState !== 'loading') markDashboardControls();
})();
</script>`;

async function addDashboardFixes(response) {
  if (!response || !response.headers.get('content-type')?.includes('text/html')) return response;

  let html = await response.text();
  if (!html.includes('responsive-fixes.css')) {
    html = html.replace(/<\\/head>/i, `${RESPONSIVE_STYLESHEET}\\n</head>`);
  }
  if (!html.includes('dashboard-toolbar-cards-4')) {
    html = html.replace(/<\\/head>/i, `${DASHBOARD_FIX_SCRIPT}\\n</head>`);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => console.warn('PWA Precache warning:', err));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : undefined)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Enforce same-origin boundary; never intercept or cache cross-origin responses
  let reqUrl;
  try {
    reqUrl = new URL(event.request.url);
  } catch {
    return;
  }
  if (reqUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(addDashboardFixes).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', response.clone()));
        }
        return response;
      }).catch(() => caches.match('./index.html')
        .then(addDashboardFixes))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (!response || !response.ok || response.type !== 'basic') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => event.request.destination === 'image' ? caches.match('./logo.png') : undefined);
    })
  );
});
