// 채용 필기 알림 - 화면 로직
const COMPANIES = [
  // 공기업·공공기관
  { name: '코레일', alias: ['철도'], group: '공기업', url: 'https://www.korail.com' },
  { name: '한국전력공사', alias: ['한전', '전력'], group: '공기업', url: 'https://home.kepco.co.kr' },
  { name: '국민건강보험공단', alias: ['건보', '건강보험'], group: '공기업', url: 'https://www.nhis.or.kr' },
  { name: 'IBK기업은행', alias: ['기업은행', 'IBK'], group: '공기업', url: 'https://www.ibk.co.kr' },
  { name: '한국가스공사', alias: ['가스'], group: '공기업', url: 'https://www.kogas.or.kr' },
  // 대기업
  { name: '삼성 (GSAT)', alias: ['GSAT'], group: '대기업', url: 'https://www.samsungcareers.com' },
  { name: 'SK (SKCT)', alias: ['SKCT'], group: '대기업', url: 'https://www.skcareers.com' },
  { name: 'CJ (CAT)', alias: ['CAT'], group: '대기업', url: 'https://recruit.cj.net' },
  { name: '현대자동차 (HMAT)', alias: ['현대', 'HMAT'], group: '대기업', url: 'https://talent.hyundai.com' },
  { name: 'LG (LG Way Fit)', alias: ['LG', '엘지'], group: '대기업', url: 'https://careers.lg.com' },
];
const AGGREGATORS = [
  { name: '잡알리오 (공공기관 채용 통합)', url: 'https://job.alio.go.kr' },
  { name: '나라일터', url: 'https://www.gojobs.go.kr' },
];

// 처음 실행할 때 넣어두는 일정 (확인 필요한 예상치는 tentative)
const SEED = [
  { company: 'SK (SKCT)', type: '인적성검사', date: '2026-10-17', time: '', memo: 'SKCT 인지검사 10/17~18 예상, 지원 계열사 공고 확인', url: 'https://www.skcareers.com', tentative: true },
];

// ---------- 저장소 (IndexedDB: 서비스워커와 공유) ----------
function openDB() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('pilgi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function kvGet(k) {
  const d = await openDB();
  return new Promise(ok => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); });
}
async function kvSet(k, v) {
  const d = await openDB();
  return new Promise(ok => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; });
}

// 기간제·대체인력 등은 기본으로 숨김 (설정에서 '모든 공고 보기'로 변경)
const isMinor = n => /비정규/.test(n.hire || '') || /(기간제|대체인력|대체 인력|위촉|계약직|체험형|육아휴직)/.test(n.title || '');
let events = [];
let settings = { days: [7, 3, 1, 0], filter: '전체', showAll: false };
let tab = location.hash === '#notices' ? 'notices' : 'soon';
let notices = { updated: '', notices: [] };
let seenIds = [];
let editingId = null;

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dday(dateStr) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - t) / 86400000);
}
function ddLabel(n) { return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`; }
function ddClass(n) { return n < 0 ? 'past' : n <= 3 ? 'hot' : n <= 7 ? 'warm' : ''; }
function groupOf(company) {
  const c = COMPANIES.find(x => [x.name.split(' ')[0], ...(x.alias || [])].some(k => company.toUpperCase().includes(k.toUpperCase())) || x.name.includes(company));
  return c ? c.group : '기타';
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDate(d) { const x = new Date(d + 'T00:00:00'); return `${x.getMonth() + 1}/${x.getDate()}(${WD[x.getDay()]})`; }

async function save() {
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  await kvSet('events', events);
  await kvSet('settings', settings);
}

// ---------- 화면 ----------
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const upcoming = events.filter(e => dday(e.date) >= 0);
  const soon = upcoming.filter(e => dday(e.date) <= 14);
  $('#summary').textContent = upcoming.length
    ? `예정 ${upcoming.length}건 · 2주 이내 ${soon.length}건` + (upcoming[0] ? ` · 가장 가까운 일정 ${ddLabel(dday(upcoming[0].date))}` : '')
    : '예정된 일정이 없어요. + 버튼으로 추가하세요';
  $('#addBtn').style.display = (tab === 'links' || tab === 'settings' || tab === 'notices') ? 'none' : '';
  const m = $('#main');

  if (tab === 'notices') return renderNotices(m);
  if (tab === 'links') return renderLinks(m);
  if (tab === 'settings') return renderSettings(m);

  let list = tab === 'soon' ? soon : tab === 'all' ? upcoming : events.filter(e => dday(e.date) < 0).reverse();
  if (settings.filter !== '전체') list = list.filter(e => groupOf(e.company) === settings.filter);

  let html = notifBanner();
  html += `<div class="filters">${['전체', '공기업', '대기업'].map(f => `<button class="chip ${settings.filter === f ? 'on' : ''}" data-filter="${f}">${f}</button>`).join('')}</div>`;
  if (!list.length) {
    html += `<div class="empty">${tab === 'soon' ? '2주 안에 다가오는 일정이 없어요.<br>전체 예정 탭이나 공고 확인 탭을 보세요.' : tab === 'past' ? '지난 일정이 없어요.' : '예정된 일정이 없어요.<br>공고가 뜨면 + 버튼으로 추가하세요.'}</div>`;
  } else {
    html += list.map(e => {
      const n = dday(e.date);
      return `<div class="card" data-id="${e.id}">
        <div class="dd ${ddClass(n)}">${ddLabel(n)}</div>
        <div class="info">
          <div><b>${esc(e.company)}</b><span class="t">${esc(e.type)}</span>${e.tentative ? '<span class="tag">예상</span>' : ''}</div>
          <div class="s">${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}${e.memo ? ' · ' + esc(e.memo) : ''}</div>
        </div></div>`;
    }).join('');
  }
  m.innerHTML = html;
}

function notifBanner() {
  if (!('Notification' in window)) {
    return `<div class="banner">이 브라우저는 알림을 지원하지 않아요. 아이폰은 Safari에서 <b>공유 → 홈 화면에 추가</b> 후 홈 화면 아이콘으로 열어야 알림이 됩니다. 확실한 알람은 설정 탭의 <b>캘린더로 내보내기</b>를 쓰세요.</div>`;
  }
  if (Notification.permission === 'default') {
    return `<div class="banner">일정이 다가오면 알림을 받으려면 허용해 주세요.<br><button class="btn" id="askNotif">알림 켜기</button></div>`;
  }
  if (Notification.permission === 'denied') {
    return `<div class="banner">알림이 차단돼 있어요. 폰 설정에서 이 앱(또는 브라우저)의 알림을 허용해 주세요.</div>`;
  }
  return '';
}

function renderNotices(m) {
  const all = notices.notices || [];
  const isCorp = n => n.source === 'saramin';
  const base = settings.showAll ? all : all.filter(n => !isMinor(n));
  const list = settings.filter === '공기업' ? base.filter(n => !isCorp(n)) : settings.filter === '대기업' ? base.filter(isCorp) : base;
  const hidden = all.length - base.length;
  let html = notifBanner();
  html += `<div class="filters">${['전체', '공기업', '대기업'].map(f => `<button class="chip ${settings.filter === f ? 'on' : ''}" data-filter="${f}">${f}</button>`).join('')}</div>`;
  html += `<p><small>공공기관(잡알리오)과 대기업(사람인) 신입 공고예요. 하루 두 번(오전 6시, 낮 12시) 자동으로 갱신돼요.${notices.updated ? ' 마지막 갱신 ' + esc(notices.updated) : ''}</small></p>`;
  html += `<p><button class="chip ${settings.showAll ? 'on' : ''}" data-showall="1">${settings.showAll ? '모든 공고 보는 중' : `기간제·대체인력 등 ${hidden}건 숨김 · 모두 보기`}</button></p>`;
  if (!notices.updated) {
    html += `<div class="empty">아직 자동 수집 결과가 없어요.<br>GitHub 설정을 마치면 여기에 공고가 떠요.<br><small>(설치 안내서 2단계 참고)</small></div>`;
  } else if (!list.length) {
    html += `<div class="empty">지금 진행 중인 관심 기관 공고가 없어요.</div>`;
  } else {
    html += list.map(n => {
      const left = n.end ? dday(n.end) : null;
      const added = events.some(e => e.noticeId === n.id);
      return `<div class="card info" style="display:block">
        <div><b>${esc(n.inst)}</b>${n.source === 'saramin' ? '<span class="tag" style="background:#e0e7ff;color:#3730a3">대기업</span>' : ''}${!seenIds.includes(n.id) ? '<span class="tag" style="background:#dcfce7;color:#166534">NEW</span>' : ''}${left !== null ? `<span class="t">${left >= 0 ? '마감 ' + ddLabel(left) : '마감됨'}</span>` : ''}</div>
        <div class="s" style="margin:4px 0;font-size:14px;color:var(--text)">${esc(n.title)}</div>
        ${n.source === 'saramin' ? '<div class="s">출처: 사람인</div>' : ''}<div class="s">접수 ${n.start ? fmtDate(n.start) : '?'} ~ ${n.end ? fmtDate(n.end) : '?'}${[n.kind, n.hire, n.people ? n.people + '명' : ''].filter(Boolean).map(x => ' · ' + esc(x)).join('')}</div>
        <div class="actions" style="margin-top:8px">
          <a class="btn ghost" style="text-decoration:none;font-size:14px;padding:7px 12px" href="${esc(n.url)}" target="_blank" rel="noopener">공고 보기</a>
          <button class="btn" style="font-size:14px;padding:7px 12px" data-notice="${esc(n.id)}" ${added ? 'disabled' : ''}>${added ? '일정에 추가됨' : '마감일 일정에 추가'}</button>
        </div></div>`;
    }).join('');
  }
  m.innerHTML = html;
  // 화면에서 본 공고는 '본 것'으로 기록 (다음에 NEW 표시 안 함)
  const ids = list.map(n => n.id);
  if (ids.some(id => !seenIds.includes(id))) kvGet('seenNotices').then(s => kvSet('seenNotices', [...new Set([...(s || []), ...ids])]));
}

async function loadNotices() {
  try {
    const r = await fetch('notices.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { notices = await r.json(); }
  } catch (_) { notices = (await kvGet('notices')) || notices; }
  seenIds = (await kvGet('seenNotices')) || [];
  const newCount = (notices.notices || []).filter(n => !seenIds.includes(n.id) && (settings.showAll || !isMinor(n))).length;
  const btn = document.querySelector('[data-tab=notices]');
  if (btn) btn.textContent = newCount ? `새 공고 ${newCount}` : '새 공고';
}

function renderLinks(m) {
  const g = grp => COMPANIES.filter(c => c.group === grp).map(c => `<a href="${c.url}" target="_blank" rel="noopener">${esc(c.name)}<span>채용 사이트 ›</span></a>`).join('');
  m.innerHTML = `<div class="links">
    <p><small>필기 일정 공고가 떴는지 여기서 확인하고, 뜨면 일정 탭에서 + 로 추가하세요. 공고 확인 리마인더는 설정 탭에서 켤 수 있어요.</small></p>
    <h3>공기업 · 공공기관</h3>${g('공기업')}
    ${AGGREGATORS.map(c => `<a href="${c.url}" target="_blank" rel="noopener">${esc(c.name)}<span>통합 공고 ›</span></a>`).join('')}
    <h3>대기업</h3>${g('대기업')}
  </div>`;
}

function renderSettings(m) {
  const opts = [14, 7, 3, 2, 1, 0];
  m.innerHTML = `
  ${notifBanner()}
  <h3>알림 받을 시점</h3>
  <div class="filters" style="flex-wrap:wrap">${opts.map(d => `<button class="chip ${settings.days.includes(d) ? 'on' : ''}" data-day="${d}">${d === 0 ? '당일' : d + '일 전'}</button>`).join('')}</div>
  <p><small>앱 알림은 앱을 열 때와, 안드로이드 크롬에서 홈 화면에 설치한 경우 하루 한 번쯤 백그라운드에서 확인해 보냅니다. 폰이 앱을 오래 안 열면 백그라운드 확인을 줄일 수 있어서, <b>꼭 놓치면 안 되는 시험은 캘린더로 내보내기</b>를 같이 쓰세요.</small></p>
  <div class="actions">
    <button class="btn" id="testNotif">알림 테스트</button>
    <button class="btn" id="icsAll">예정 일정 전체 캘린더로 내보내기</button>
    <button class="btn ghost" id="icsCheck">매주 월요일 '공고 확인' 리마인더 캘린더에 추가</button>
  </div>
  <h3>백업</h3>
  <p><small>일정은 이 폰의 브라우저 안에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 백업하세요.</small></p>
  <div class="actions">
    <button class="btn ghost" id="exportJson">백업 파일 저장</button>
    <button class="btn ghost" id="importJson">백업 불러오기</button>
    <input type="file" id="importFile" accept=".json,application/json" style="display:none">
  </div>`;
}

// ---------- 일정 추가/수정 ----------
function openForm(ev) {
  editingId = ev ? ev.id : null;
  const f = $('#form');
  $('#dlgTitle').textContent = ev ? '일정 수정' : '일정 추가';
  f.company.value = ev?.company || '';
  f.type.value = ev?.type || '필기시험';
  f.date.value = ev?.date || '';
  f.time.value = ev?.time || '';
  f.memo.value = ev?.memo || '';
  f.url.value = ev?.url || '';
  f.tentative.checked = !!ev?.tentative;
  $('#delBtn').style.display = ev ? '' : 'none';
  $('#icsOne').style.display = ev ? '' : 'none';
  $('#dlg').showModal();
}

$('#dlg').addEventListener('close', async () => {
  const v = $('#dlg').returnValue, f = $('#form');
  if (v === 'save') {
    if (!f.company.value || !f.date.value) return;
    const data = { company: f.company.value.trim(), type: f.type.value, date: f.date.value, time: f.time.value, memo: f.memo.value.trim(), url: f.url.value.trim(), tentative: f.tentative.checked };
    if (editingId) Object.assign(events.find(e => e.id === editingId), data);
    else events.push({ id: uid(), ...data });
  } else if (v === 'delete' && editingId) {
    if (!confirm('이 일정을 삭제할까요?')) return;
    events = events.filter(e => e.id !== editingId);
  } else if (v === 'ics' && editingId) {
    downloadICS([events.find(e => e.id === editingId)], '일정.ics');
    return;
  } else return;
  await save(); render(); checkNow();
});

// ---------- 캘린더(.ics) 내보내기: 폰 기본 캘린더 알람으로 확실하게 ----------
function icsDate(d, t) { return d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : ''); }
function icsEscape(s) { return String(s || '').replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n'); }
function buildICS(list, extra = '') {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const alarms = settings.days.filter(d => d > 0).map(d => `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:D-${d}\r\nTRIGGER:-P${d}D\r\nEND:VALARM`);
  const body = list.map(e => {
    const next = new Date(e.date + 'T00:00:00'); next.setDate(next.getDate() + 1);
    const dt = e.time
      ? `DTSTART;TZID=Asia/Seoul:${icsDate(e.date, e.time)}\r\nDURATION:PT2H`
      : `DTSTART;VALUE=DATE:${icsDate(e.date)}\r\nDTEND;VALUE=DATE:${icsDate(next.toISOString().slice(0, 10))}`;
    const sameDay = e.time ? 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:곧 시작\r\nTRIGGER:-PT2H\r\nEND:VALARM' : 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:오늘\r\nTRIGGER:PT8H\r\nEND:VALARM';
    return ['BEGIN:VEVENT', `UID:${e.id}@pilgi-alarm`, `DTSTAMP:${now}`, dt,
      `SUMMARY:${icsEscape(`[${e.type}] ${e.company}${e.tentative ? ' (예상)' : ''}`)}`,
      `DESCRIPTION:${icsEscape([e.memo, e.url].filter(Boolean).join('\n'))}`,
      ...alarms, sameDay, 'END:VEVENT'].join('\r\n');
  }).join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pilgi-alarm//KO\r\nCALSCALE:GREGORIAN\r\n${body}${extra}\r\nEND:VCALENDAR\r\n`;
}
function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadICS(list, name) { download(buildICS(list), name, 'text/calendar'); }

// ---------- 알림 ----------
async function checkNow() {
  if (!('serviceWorker' in navigator) || window.Notification?.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage('check');
}
async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('pilgi-check', { minInterval: 12 * 60 * 60 * 1000 });
  } catch (_) { /* 지원 안 하는 브라우저는 앱을 열 때만 확인 */ }
}

// ---------- 이벤트 위임 ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('button, .card');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; if (tab === 'notices') await loadNotices(); render(); return; }
  if (t.dataset.showall) { settings.showAll = !settings.showAll; await kvSet('settings', settings); render(); return; }
  if (t.dataset.filter) { settings.filter = t.dataset.filter; await save(); render(); return; }
  if (t.dataset.day !== undefined) {
    const d = +t.dataset.day;
    settings.days = settings.days.includes(d) ? settings.days.filter(x => x !== d) : [...settings.days, d].sort((a, b) => b - a);
    await save(); render(); return;
  }
  if (t.dataset.notice) {
    const n = notices.notices.find(x => x.id === t.dataset.notice);
    if (n && n.end) {
      events.push({ id: uid(), noticeId: n.id, company: n.inst, type: '서류 마감', date: n.end, time: '', memo: n.title, url: n.url, tentative: false });
      await save(); render(); checkNow();
      alert('마감일을 일정에 넣었어요. 필기 날짜는 공고를 보고 + 버튼으로 추가해 주세요.');
    }
    return;
  }
  if (t.classList.contains('card') && t.dataset.id) { openForm(events.find(x => x.id === t.dataset.id)); return; }
  switch (t.id) {
    case 'addBtn': openForm(null); break;
    case 'askNotif': {
      const p = await Notification.requestPermission();
      if (p === 'granted') { await registerPeriodic(); checkNow(); }
      render(); break;
    }
    case 'testNotif': {
      if (window.Notification?.permission !== 'granted') { alert('먼저 알림을 허용해 주세요.'); break; }
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('알림 테스트', { body: '이렇게 필기 일정 알림이 와요.', icon: 'icon-192.png' });
      break;
    }
    case 'icsAll': {
      const up = events.filter(x => dday(x.date) >= 0);
      if (!up.length) { alert('예정된 일정이 없어요.'); break; }
      downloadICS(up, '필기일정.ics'); break;
    }
    case 'icsCheck': {
      const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
      const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
      const ev = `\r\nBEGIN:VEVENT\r\nUID:weekly-check@pilgi-alarm\r\nDTSTAMP:${ds}T000000Z\r\nDTSTART;TZID=Asia/Seoul:${ds}T090000\r\nDURATION:PT10M\r\nRRULE:FREQ=WEEKLY;BYDAY=MO\r\nSUMMARY:채용 공고 확인 (필기알림 앱)\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:공고 확인\r\nTRIGGER:PT0M\r\nEND:VALARM\r\nEND:VEVENT`;
      download(buildICS([], ev), '공고확인_리마인더.ics', 'text/calendar'); break;
    }
    case 'exportJson': download(JSON.stringify({ events, settings }, null, 2), `필기알림_백업_${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); break;
    case 'importJson': $('#importFile').click(); break;
  }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data.events)) throw 0;
    if (!confirm(`일정 ${data.events.length}건으로 바꿀까요? 지금 일정은 사라집니다.`)) return;
    events = data.events; if (data.settings) settings = { ...settings, ...data.settings };
    await save(); render();
  } catch (_) { alert('백업 파일을 읽지 못했어요.'); }
});

// ---------- 시작 ----------
(async () => {
  $('#companyList').innerHTML = COMPANIES.map(c => `<option value="${esc(c.name)}">`).join('');
  const saved = await kvGet('events');
  events = saved || SEED.map(s => ({ id: uid(), ...s }));
  settings = { ...settings, ...((await kvGet('settings')) || {}) };
  await save();
  await loadNotices();
  render();
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('sw.js');
    if (window.Notification?.permission === 'granted') { registerPeriodic(); checkNow(); }
  }
  // 자정이 지나면 D-day 갱신
  setInterval(render, 60 * 1000);
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await loadNotices(); render(); checkNow(); } });
})();
