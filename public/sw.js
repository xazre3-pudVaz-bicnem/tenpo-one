/*
 * TENPO ONE Service Worker
 *
 * 方針（マルチテナントPOSのため保守的にキャッシュする）:
 *  - 認証済みHTML・API応答は「一切キャッシュしない」。共有タブレットで別ユーザー/別店舗の
 *    情報が残る事故を防ぐため。
 *  - キャッシュするのは内容ハッシュ付きの静的アセット（/_next/static/…）とアイコン等、
 *    ユーザーデータを含まないものだけ。
 *  - 画面遷移はネットワーク優先。通信不可のときだけオフライン画面を返す。
 *  - GET以外（Server ActionsのPOST等）は素通し。
 */
const VERSION = 'v2';
const STATIC_CACHE = `tenpo-one-static-${VERSION}`;
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/favicon-32.png', '/logo-mark.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // 一部が失敗しても install 自体は成功させる
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('tenpo-one-') && k !== STATIC_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isCacheableAsset(pathname) {
  if (pathname.startsWith('/_next/static/')) return true;
  if (PRECACHE.includes(pathname)) return true;
  return /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // 正常な同一オリジン応答のみ保存（opaque/エラーは保存しない）
  if (response && response.status === 200 && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkThenOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // Server Actions等は素通し

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase等の外部は素通し
  if (url.pathname.startsWith('/api/')) return; // APIは常にネットワーク

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkThenOffline(request));
  }
});

/* ---------------------------------------------------------------------------
 * 予約の通知（Web Push）
 * サーバー（lib/push-server.ts）が送る payload: { title, body, url, tag }
 * iPad / iPhone は「ホーム画面に追加」したアプリでだけ受け取れる（iOS 16.4+）。
 * 音は OS の通知音が鳴る（Web Push 側で音は選べない）。
 * ------------------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'TENPO ONE', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '新しい予約';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/app/reservations' },
    // 端末が対応していれば振動（iPhone は無視される）
    vibrate: [200, 100, 200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/reservations';
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).href;
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // 開いているタブがあればそれを前に出して移動、無ければ新しく開く
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch {
              /* 別オリジン等で移動できないときはそのまま */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
