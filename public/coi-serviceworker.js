/* Cross-Origin Isolation Service Worker
 * Injects COOP/COEP headers at the browser level.
 *
 * GitHub Pages strips custom HTTP headers, so we can't use _headers file
 * to set Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy.
 * This SW intercepts same-origin navigation requests and adds the required
 * headers for cross-origin isolation. Previously required for SharedArrayBuffer
 * (ffmpeg.wasm); kept for future WebAssembly threading support.
 *
 * How it works:
 *   1. On first visit, index.html registers this SW
 *   2. install → skipWaiting (activate immediately, don't wait for old SW)
 *   3. activate → claim all uncontrolled clients in scope
 *   4. On next navigation, this SW intercepts the fetch and injects
 *      COOP: same-origin + COEP: require-corp headers
 *   5. The page loads with crossOriginIsolated=true
 *
 * Only navigation requests are intercepted because:
 *   - COOP/COEP are document-level policies (set on the top-level response)
 *   - Subresource requests don't need COOP/COEP headers
 *   - Cross-origin CDN requests (e.g., ffmpeg-core.wasm) are handled by
 *     toBlobURL() on the main thread and the CDN's own CORP headers
 *
 * License: MIT — adapted from https://github.com/gzuidhof/coi-serviceworker
 */
self.addEventListener('install', () => {
  // Activate immediately — don't wait for old SW tabs to close.
  self.skipWaiting();
  console.log('[COI SW] Installed, skipping waiting');
});

self.addEventListener('activate', (e) => {
  // Claim all uncontrolled clients in scope so this SW controls them
  // immediately without waiting for a navigation.
  e.waitUntil(
    self.clients.claim().then(() => {
      console.log('[COI SW] Activated and claimed all clients');
    })
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only intercept same-origin requests — cross-origin resources
  // (CDN, external APIs) should pass through unchanged.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only inject headers on document (navigation) requests.
  // Subresources (JS, CSS, images) don't need COOP/COEP headers.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((response) => {
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }).catch((err) => {
        // Fetch failed (offline, network error). Pass through the error
        // so the browser can show its standard offline page.
        console.error('[COI SW] Navigation fetch failed:', err);
        throw err;
      })
    );
  }
});
