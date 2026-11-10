'use strict';
// 친목회 계산 (화면 없음): events.js가 쓰고, tests/events.test.js 가 Node에서 확인
// 행사 = { id, title, date: 'YYYY-MM-DD', time: '' | 'HH:MM', place, mapUrl, deadline: ms | null, note, audience: '기초'|'임상'|'전체', closed }
// 응답 = { uid, status: 'yes'|'maybe'|'no', name, comment }

const STATUS = [['yes', '참석', '🙋'], ['maybe', '미정', '🤔'], ['no', '불참', '🙅']];
const WEEK = '일월화수목금토';
const pad2 = n => String(n).padStart(2, '0');

// 이 기기 시간 기준 오늘 'YYYY-MM-DD'
const todayStr = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// '2026-11-24' → '11월 24일 (화)'. 올해가 아니면 앞에 연도
function fmtDate(date, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return '';
  const d = new Date(+m[1], m[2] - 1, +m[3]);
  const head = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${head}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}
// '18:30' → '오후 6:30', '' → ''
function fmtTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || '');
  if (!m) return '';
  const hh = +m[1];
  return `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${m[2]}`;
}
const whenText = (e, now) => [fmtDate(e.date, now), fmtTime(e.time)].filter(Boolean).join(' ');
// 마감 시각(ms) → '11월 20일 (목) 오후 6:00'
function fmtStamp(ms, now) {
  const d = new Date(ms);
  return `${fmtDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, now)} ${fmtTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)}`;
}

// <input type="datetime-local"> 값 ↔ ms
const fromLocalInput = v => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const toLocalInput = ms => { if (ms == null) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

const isOpen = (e, now = Date.now()) => !e.closed && (e.deadline == null || now < e.deadline);

// 내가 볼 행사: 관리자는 모두, 회원은 대상이 '전체'이거나 내 구분과 같은 것
const forMe = (events, group, isAdmin) => events.filter(e => isAdmin || e.audience === '전체' || e.audience === group);

// 다가오는 것(오늘 포함, 가까운 날부터)과 지난 것(최근부터)
function splitEvents(events, today) {
  const key = e => `${e.date} ${e.time || '99:99'}`;
  return {
    upcoming: events.filter(e => e.date >= today).sort((a, b) => key(a).localeCompare(key(b))),
    past: events.filter(e => e.date < today).sort((a, b) => key(b).localeCompare(key(a))),
  };
}

// 응답 모으기: { yes: [{ name, comment, uid }], maybe, no } 이름 가나다
function tally(rsvps) {
  const out = { yes: [], maybe: [], no: [] };
  for (const r of rsvps) if (out[r.status]) out[r.status].push(r);
  for (const k in out) out[k].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return out;
}

// 아직 체크 안 한 분 (관리자만 봄): 명단에서 사용 중이고 이 행사 대상인 분 중, 그 메일로 가입한 계정의 응답이 없는 분
// 아직 가입 안 한 분도 들어가요. roster = [{ email, name, group, status }], members = [{ uid, email }]
function notYet(roster, rsvps, members, audience) {
  const emailOf = new Map(members.map(m => [m.uid, String(m.email).toLowerCase()]));
  const done = new Set(rsvps.map(r => emailOf.get(r.uid)).filter(Boolean));
  return roster
    .filter(r => r.status === 'active' && (audience === '전체' || r.group === audience) && !done.has(r.email))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// 새 친목회 기본 제목: '11월 기초친목회'
function defaultTitle(date, audience = '기초') {
  const m = /^\d{4}-(\d{2})/.exec(date || '');
  return `${m ? `${+m[1]}월 ` : ''}${audience === '전체' ? '' : audience}친목회`;
}

// 만들기·고치기 확인 (firestore.rules와 같은 한도)
function eventProblem(d) {
  if (!d.title.trim()) return '제목을 넣어 주세요';
  if (d.title.trim().length > 60) return '제목은 60자까지예요';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return '날짜를 골라 주세요';
  if (d.time && !/^\d{2}:\d{2}$/.test(d.time)) return '시간을 다시 확인해 주세요';
  if (d.place.length > 80) return '장소는 80자까지예요';
  if (d.mapUrl && !/^https:\/\/\S+$/.test(d.mapUrl)) return '지도 링크는 https:// 로 시작하는 주소를 붙여 넣어 주세요';
  if (d.note.length > 1000) return '메모는 1000자까지예요';
  return '';
}

// 식당 메뉴 미리 받기: 한 줄에 메뉴 하나 (20개까지, 이름 40자까지, 같은 것은 한 번만). 비우면 안 받음
const parseMeals = text => [...new Set(String(text || '').split('\n').map(l => l.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);

// 메뉴별로 고른 분 (참석·미정인 분만, 메뉴 순서): [{ meal, names: [] }]
function mealTally(meals, rsvps) {
  const picked = rsvps.filter(r => r.status !== 'no' && r.meal && meals.includes(r.meal));
  return meals.map(meal => ({ meal, names: picked.filter(r => r.meal === meal).map(r => r.name).sort((a, b) => a.localeCompare(b, 'ko')) }));
}
// 식당에 알릴 글: 고른 메뉴만, 모두 몇 개
function mealText(title, tally) {
  const rows = tally.filter(t => t.names.length);
  return [`${title} 식당 메뉴 (모두 ${rows.reduce((n, t) => n + t.names.length, 0)}개)`, ...rows.map(t => `${t.meal} ${t.names.length}`)].join('\n');
}

// 공지 메일에 붙일 글
function announceText(e, url, now) {
  const lines = [`[${e.title}]`, `일시: ${whenText(e, now)}`];
  if (e.place) lines.push(`장소: ${e.place}${e.mapUrl ? ` (${e.mapUrl})` : ''}`);
  if (e.deadline != null) lines.push(`참석 체크 마감: ${fmtStamp(e.deadline, now)}`);
  if (e.note) lines.push('', e.note);
  lines.push('', `참석 체크: ${url}`);
  return lines.join('\n');
}
