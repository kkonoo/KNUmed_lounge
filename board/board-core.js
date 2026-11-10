'use strict';
// 자유 게시판 계산 (화면 없음): board.js·홈이 쓰고, tests/board.test.js 가 Node에서 확인
// 글 = { id, title, body, by, name, at: ms, editedAt: ms | null } · 댓글 = { id, body, by, name, at: ms }

// 글자 수 한도 (firestore.rules와 같음)
const POST_MAX = { title: 80, body: 4000, comment: 1000 };

function postProblem({ title, body }) {
  if (!String(title || '').trim()) return '제목을 넣어 주세요';
  if (!String(body || '').trim()) return '내용을 넣어 주세요';
  if (String(title).trim().length > POST_MAX.title) return `제목은 ${POST_MAX.title}자까지예요`;
  if (String(body).trim().length > POST_MAX.body) return `내용은 ${POST_MAX.body}자까지예요`;
  return '';
}

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
