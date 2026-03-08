// ═══════════════════════════════════════════════════
// FATLIN AI — SERVICE WORKER v9.0
// Estrategia: Cache-first para assets, Network-first
// para llamadas a API (Firebase / Claude proxy)
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'fatlin-ai-v64';
const CACHE_VERSION = '9.0.0';

// Archivos que se cachean al instalar (App Shell)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Fuentes de Google (se cachean en primera visita)
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap'
];

// URLs que NUNCA se cachean (siempre van a la red)
const NETWORK_ONLY = [
  'https://api.anthropic.com',
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://www.googleapis.com/identitytoolkit',
  // Si usas el proxy de Firebase Functions:
  'https://us-central1-fatlin.cloudfunctions.net'
];

// ─── INSTALL ────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Fatlin AI SW v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cacheando App Shell');
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn('[SW] No se pudo cachear:', url, err.message);
        }))
      );
    }).then(() => {
      console.log('[SW] App Shell cacheada');
      return self.skipWaiting(); // Activa inmediatamente sin esperar
    })
  );
});

// ─── ACTIVATE ───────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Eliminando cache antiguo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Toma control de todos los clientes abiertos inmediatamente
      return self.clients.claim();
    }).then(() => {
      // ── CLAVE: notifica a todas las pestañas abiertas que recarguen ──
      // Esto hace que el usuario vea la nueva versión sin tocar nada
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED' });
        });
      });
    })
  );
});

// ─── FETCH ──────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 1. Peticiones POST o no-GET → siempre red (Firebase writes, API calls)
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. URLs de red obligatoria → nunca cachear
  const isNetworkOnly = NETWORK_ONLY.some(pattern => url.includes(pattern));
  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Sin conexión. Verifica tu internet.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 3. Fuentes de Google → Stale-while-revalidate
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetched = fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          });
          return cached || fetched;
        })
      )
    );
    return;
  }

  // 4. App Shell y assets → Cache-first, red como fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then(response => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Sin conexión', { status: 503 });
      });
    })
  );
});

// ─── MENSAJE DESDE EL CLIENTE ───────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
