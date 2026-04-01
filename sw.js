/* ═══════════════════════════════════════════════════════════════
   Fatlin AI — Service Worker (sw.js)
   Estrategia: Network First para HTML · Cache First para assets
   Actualiza CACHE_VERSION en cada deploy para forzar refresco
═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION  = 'fatlin-v108';
const CACHE_STATIC   = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC  = `${CACHE_VERSION}-dynamic`;

// Archivos que se precargan en instalación (app shell)
// NOTA: main.js NO se incluye aquí porque usa query-string de versión (?v=N)
//       El SW lo captura y cachea automáticamente en la primera carga.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/js/pwa.js',
  '/js/splash.js',
  '/js/restSystem.js',
  '/js/payment.js',
  '/manifest.json',
  '/verify-pending.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
// NOTA: styles.css, fixes.css y fixes.js ya van INLINE en index.html
// No se cachean como archivos externos para garantizar que siempre
// se sirve la versión más reciente.

// ── INSTALL: precargar app shell ──────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando versión:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(
        PRECACHE_ASSETS.filter(url => !url.startsWith('https://fonts'))
      ))
      .then(() => {
        console.log('[SW] App shell precargada — esperando confirmación del usuario');
        // ✅ NO se llama skipWaiting() aquí.
        // El SW queda en estado "waiting" hasta que el usuario
        // haga clic en "Actualizar" en el banner → pwa.js envía
        // SKIP_WAITING → el SW llama skipWaiting() → controllerchange
        // se dispara en la página → window.location.reload().
      })
      .catch(err => console.warn('[SW] Precache parcial:', err))
  );
});

// ── ACTIVATE: limpiar cachés viejas ──────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activando:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC && key !== CACHE_DYNAMIC)
          .map(key => {
            console.log('[SW] Eliminando caché vieja:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())  // ← claim PRIMERO: nuevo SW toma control
     .then(() => self.clients.matchAll({ includeUncontrolled: true }))
     .then(clients => {
       // Notificar DESPUÉS de claim: la recarga ya cae bajo el nuevo SW.
       // pwa.js escucha 'controllerchange' y ejecuta window.location.reload().
       clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
     })
  );
});

// ── FETCH: estrategia mixta ───────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar peticiones no GET y extensiones de Chrome
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Firebase APIs, Anthropic proxy, CDN scripts → Network only (sin caché)
  if (
    url.hostname.includes('firebaseio.com')                  ||
    url.hostname.includes('googleapis.com')                  ||
    url.hostname.includes('firestore.googleapis.com')        ||
    url.hostname.includes('firebase.googleapis.com')         ||
    url.hostname.includes('identitytoolkit.googleapis.com')  ||
    url.hostname.includes('securetoken.googleapis.com')      ||
    url.hostname.includes('anthropic.com')                   ||
    url.hostname.includes('cloudfunctions.net')              ||
    url.hostname.includes('gstatic.com')                     ||
    url.hostname.includes('firebaseapp.com')                 ||
    url.hostname.includes('mercadopago.com')                 ||
    url.hostname.includes('paypal.com')                      ||
    url.hostname.includes('sandbox.paypal.com')              ||
    url.pathname.includes('/v1/messages')                    ||
    url.pathname.includes('/google.firestore')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML → Network First (siempre la versión más reciente)
  if (request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // CSS, JS, Fuentes → Cache First (versión con hash inmutable)
  if (
    url.pathname.startsWith('/css/')   ||
    url.pathname.startsWith('/js/')    ||
    url.pathname.startsWith('/icons/') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Resto → Network First con fallback a caché dinámica
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_DYNAMIC).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── Recibir mensajes desde la app ─────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING recibido — activando nueva versión');
    // ✅ skipWaiting() se llama SOLO cuando el usuario confirma.
    // Esto dispara 'controllerchange' en la página → pwa.js recarga.
    self.skipWaiting();
  }
});
