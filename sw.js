// 앱(PWA)으로 설치했을 때 오프라인에서도 열리게 하는 서비스 워커 (toy_box sw.js와 같은 방식)
// 온라인이면 항상 새 파일을 받고(업데이트 바로 반영), 오프라인이면 저장해 둔 파일을 씀
// kkonoo.github.io 의 다른 앱(장난감 상자 등)과 캐시 저장소를 같이 쓰므로 이름을 다르게, 남의 캐시는 지우지 않기
// 화면 파일을 더하면 아래 SHELL에도 적어요
const CACHE = 'lounge-v1';
const SHELL = [
  './', 'manifest.webmanifest',
  'css/style.css',
  'js/ui.js', 'js/icons.js', 'js/theme.js', 'js/pwa.js', 'js/firebase-config.js', 'js/worker-config.js', 'js/account-core.js', 'js/session.js', 'js/form.js', 'js/home.js',
  'icons/icon.svg', 'icons/app-192.png', 'icons/app-512.png', 'icons/app-maskable-192.png', 'icons/app-maskable-512.png', 'icons/apple-touch-icon.png',
  'login/', 'login/login.js',
  'events/', 'events/events.css', 'events/events-core.js', 'events/events-db.js', 'events/events.js',
  'board/', 'board/board.css', 'board/board-core.js', 'board/board-db.js', 'board/board.js',
  'order/', 'order/order.css', 'order/order-core.js', 'order/menu-photo.js', 'order/order-db.js', 'order/order.js',
  'people/', 'people/people.css', 'people/people-core.js', 'people/profile-db.js', 'people/people.js', 'data/people.json',
  'people/me/', 'people/me/me.js',
  'admin/', 'admin/admin.css', 'admin/admin-db.js', 'admin/admin.js',
];

self.addEventListener('install', e => {
  self.skipWaiting(); // 새 서비스 워커를 앱을 껐다 켜지 않아도 바로 사용
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 폰트 CDN·Firebase 같은 바깥 요청은 건드리지 않음
  if (!url.pathname.startsWith(new URL('./', location).pathname)) return; // 같은 주소의 다른 앱(장난감 상자 등)도 건드리지 않음
  e.respondWith(
    // no-cache: 브라우저 캐시(GitHub Pages는 10분)를 쓰기 전에 서버에 바뀌었는지 확인
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { cacheName: CACHE, ignoreSearch: true }))
  );
});
