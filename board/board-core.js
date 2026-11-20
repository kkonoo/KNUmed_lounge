'use strict';
// 자유 게시판 계산 (화면 없음): board.js·홈이 쓰고, tests/board.test.js 가 Node에서 확인
// 글 = { id, title, body, cat, by, name, at: ms, editedAt: ms | null, photos: [사진 번호] } · 댓글 = { id, body, by, name, at: ms }
// 반응 = { uid, name, kinds: [반응 키], at: ms } (한 사람에 하나)

// 말머리: 글마다 하나, 키로 저장 (이름을 바꿔도 글은 그대로). 글쓰기 창에서는 처음에 기타가 골라져 있어요
//   말머리를 만들기 전에 쓴 글은 cat이 없어서 말머리 없이 전체에서만 보여요 (고쳐 저장하면 붙음)
//   키 목록은 firestore.rules의 postOk와 같음
const BOARD_CATS = [['news', '소식'], ['meet', '번개'], ['daily', '일상'], ['etc', '기타']];
const BOARD_CAT_DEFAULT = 'etc';
const catLabel = k => (BOARD_CATS.find(([c]) => c === k) || [])[1] || '';

// 글자 수 한도 (firestore.rules와 같음)
const POST_MAX = { title: 80, body: 4000, comment: 1000 };

function postProblem({ title, body }) {
  if (!String(title || '').trim()) return '제목을 넣어 주세요';
  if (!String(body || '').trim()) return '내용을 넣어 주세요';
  if (String(title).trim().length > POST_MAX.title) return `제목은 ${POST_MAX.title}자까지예요`;
  if (String(body).trim().length > POST_MAX.body) return `내용은 ${POST_MAX.body}자까지예요`;
  return '';
}

// 사진: 글 하나에 3장까지. 올리기 전에 브라우저에서 줄여서, 한 장을 문서 하나에 data: 주소로 (firestore.rules와 같음)
//   긴 쪽 1600px부터, 그래도 chars를 넘으면 1280 → 1024px로 더 줄임 (문서 하나는 1MB까지라서)
const BOARD_PHOTO = { max: 3, chars: 900000, steps: [[1600, 0.82], [1280, 0.75], [1024, 0.7]] };
// 긴 쪽이 edge보다 크면 비율대로 줄인 크기 (작으면 그대로)
function photoSize(w, h, edge) {
  const k = Math.min(1, edge / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

// 반응: 번개 글은 🙋 손들기만, 다른 글은 여섯 가지. 한 사람이 여러 개 (누른 걸 한 번 더 누르면 취소)
//   키로 저장 (firestore.rules와 같음). 이름은 단추에 마우스를 올리거나 화면 읽기에서 들려요
const REACTIONS = [
  ['hand', '🙋', '손들기'], ['like', '👍', '따봉'], ['heart', '♥️', '하트'], ['party', '🎉', '축하'],
  ['lol', '🤣', '웃겨요'], ['sad', '😢', '슬퍼요'], ['ribbon', '🎗️', '애도'],
];
const reactionsFor = cat => REACTIONS.filter(([k]) => (cat === 'meet') === (k === 'hand'));
// 사람마다 { uid, name, kinds, at } → 이 글에서 보이는 반응마다 { key, emoji, label, names(먼저 누른 분부터), mine }
function tallyReactions(list, cat, uid) {
  const sorted = [...list].sort((a, b) => (a.at || 0) - (b.at || 0));
  return reactionsFor(cat).map(([key, emoji, label]) => {
    const who = sorted.filter(r => (r.kinds || []).includes(key));
    return { key, emoji, label, names: who.map(r => r.name), mine: who.some(r => r.uid === uid) };
  });
}
// 내 반응 목록에서 하나를 켜고 끔
const toggleKind = (kinds, k) => (kinds.includes(k) ? kinds.filter(x => x !== k) : [...kinds, k]);

// 지난번에 본 뒤로 올라온 남의 글 수 (seen: ms)
const newCount = (posts, seen, uid) => posts.filter(p => p.at > seen && p.by !== uid).length;

// 글 시각: 오늘이면 '오후 3:05', 올해면 '11월 9일', 그 전이면 '2025. 11. 9.'
function fmtWhen(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms), n = new Date(now);
  if (d.toDateString() === n.toDateString()) {
    const hh = d.getHours();
    return `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

// 본문의 주소를 링크로: [['t', 글자] | ['a', 주소]]. http(s)만, 끝에 붙은 문장부호는 빼고
function linkParts(text) {
  const out = [], s = String(text || '');
  let last = 0;
  for (const m of s.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = m[0].replace(/[).,!?;:\]]+$/, '');
    if (m.index > last) out.push(['t', s.slice(last, m.index)]);
    out.push(['a', url]);
    last = m.index + url.length;
  }
  if (last < s.length) out.push(['t', s.slice(last)]);
  return out;
}

// ---------- 목록 페이지 ----------
// 공지(pinned)는 페이지마다 맨 위에 따로, 나머지 글을 한 페이지에 BOARD_PAGE개씩
const BOARD_PAGE = 20;
// 지금 페이지에 보일 글: 새것부터 정렬된 글들에서 공지를 빼고 page번째 묶음
const pagePosts = (posts, page, per = BOARD_PAGE) => posts.filter(p => !p.pinned).slice((page - 1) * per, page * per);
const pageCount = (total, pinned, per = BOARD_PAGE) => Math.max(1, Math.ceil(Math.max(0, total - pinned) / per));
// 페이지 번호 단추: 지금 페이지를 가운데 두고 span개 (끝에서는 붙임)
function pageNumbers(cur, pages, span = 5) {
  const start = Math.max(1, Math.min(cur - Math.floor(span / 2), pages - span + 1));
  return Array.from({ length: Math.min(span, pages) }, (_, i) => start + i);
}
// 주소 # ↔ 목록 상태: 말머리와 페이지 (#cat=meet&page=2). 없거나 이상하면 전체·1페이지
function readList(hash) {
  const s = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const page = /^\d{1,4}$/.test(s.get('page') || '') ? Math.max(1, Number(s.get('page'))) : 1;
  return { cat: catLabel(s.get('cat')) ? s.get('cat') : '', page };
}
function writeList({ cat = '', page = 1 }) {
  const s = new URLSearchParams();
  if (cat) s.set('cat', cat);
  if (page > 1) s.set('page', String(page));
  const t = s.toString();
  return t ? `#${t}` : '';
}
