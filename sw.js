// 오프라인 캐시 + 백그라운드 알림 확인
const CACHE = 'pilgi-v2';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('notices.json')) return; // 공고는 항상 새로 받기
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ---- IndexedDB (앱 화면과 공유하는 일정/알림기록 저장소) ----
function db() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('pilgi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function kvGet(k) {
  const d = await db();
  return new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); });
}
async function kvSet(k, v) {
  const d = await db();
  return new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; });
}

function dday(dateStr) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - t) / 86400000);
}

async function checkAndNotify() {
  const events = (await kvGet('events')) || [];
  const settings = (await kvGet('settings')) || { days: [7, 3, 1, 0] };
  const sent = (await kvGet('sent')) || {};
  const today = new Date().toISOString().slice(0, 10);
  for (const ev of events) {
    if (ev.done) continue;
    const n = dday(ev.date);
    if (!settings.days.includes(n)) continue;
    const key = ev.id + '|' + n;
    if (sent[key]) continue;
    const when = n === 0 ? '오늘' : `D-${n}`;
    await self.registration.showNotification(`${when} · ${ev.company} ${ev.type}`, {
      body: `${ev.date}${ev.time ? ' ' + ev.time : ''}${ev.memo ? ' · ' + ev.memo : ''}`,
      icon: 'icon-192.png', badge: 'icon-192.png', tag: key
    });
    sent[key] = today;
  }
  await kvSet('sent', sent);
}

// 새 공공기관 공고 알림 (GitHub Actions 가 매일 notices.json 갱신)
async function checkNotices() {
  let data;
  try {
    const r = await fetch('notices.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    data = await r.json();
  } catch (_) { return; }
  const list = data.notices || [];
  await kvSet('notices', data);
  const seen = await kvGet('seenNotices');
  if (!seen) { await kvSet('seenNotices', list.map(n => n.id)); return; } // 첫 실행은 조용히
  const fresh = list.filter(n => !seen.includes(n.id));
  if (!fresh.length) return;
  const title = fresh.length === 1 ? `새 공고 · ${fresh[0].inst}` : `새 공공기관 공고 ${fresh.length}건`;
  const body = fresh.slice(0, 3).map(n => `${n.inst}: ${n.title} (~${n.end.slice(5)})`).join('\n');
  await self.registration.showNotification(title, { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'notices', data: { tab: 'notices' } });
  await kvSet('seenNotices', [...seen, ...fresh.map(n => n.id)]);
}

async function checkAll() { await checkNotices(); await checkAndNotify(); }

self.addEventListener('periodicsync', e => {
  if (e.tag === 'pilgi-check') e.waitUntil(checkAll());
});
self.addEventListener('message', e => {
  if (e.data === 'check') e.waitUntil(checkAll());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : self.clients.openWindow('./index.html' + (e.notification.data?.tab ? '#' + e.notification.data.tab : ''))));
});
