'use strict';
// 교수 디렉터리 계산 (화면 없음): people.js가 쓰고, tests/people.test.js 가 Node에서 확인
// 사람 = { id, name, rank, dept, group, line, keywords: [], topics: [], links: [[주소, 글자]], photo, source, status }

// 찾기용 글자: 띄어쓰기·대소문자·가운뎃점 무시 ('생화학 세포' = '생화학·세포')
const fold = s => String(s || '').toLowerCase().replace(/[\s·・,.\-_/()]+/g, '');

// '분자의학교실' → '분자의학' (고르는 단추에 짧게)
const shortDept = d => String(d).replace(/교실$/, '');

// 한 사람이 찾는 말에 맞는지: 이름·교실·소개·키워드 어디든. 낱말을 띄어 쓰면 모두 맞아야 함 (그리고)
function matches(p, q) {
  const words = String(q || '').trim().split(/\s+/).map(fold).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([p.name, p.dept, p.rank, p.line, ...(p.keywords || [])].join(' '));
  return words.every(w => hay.includes(w));
}

// 거르기: q(찾는 말) · dept(교실, ''이면 전체) · topic(주제 key, ''이면 전체)
function filterPeople(people, { q = '', dept = '', topic = '' } = {}) {
  return people.filter(p => (!dept || p.dept === dept) && (!topic || (p.topics || []).includes(topic)) && matches(p, q));
}

const ko = (a, b) => a.localeCompare(b, 'ko');

// 교실별로 묶기: [[교실, [사람…]]]. 교실은 가나다, 교실 안은 이름 가나다
function groupByDept(people) {
  const m = new Map();
  for (const p of people) {
    if (!m.has(p.dept)) m.set(p.dept, []);
    m.get(p.dept).push(p);
  }
  return [...m.entries()].sort((a, b) => ko(a[0], b[0])).map(([d, ps]) => [d, ps.slice().sort((a, b) => ko(a.name, b.name))]);
}

// 고르는 단추에 쓸 교실 목록과 인원: [[교실, 명]] 가나다
function deptCounts(people) {
  const m = new Map();
  for (const p of people) m.set(p.dept, (m.get(p.dept) || 0) + 1);
  return [...m.entries()].sort((a, b) => ko(a[0], b[0]));
}

// 주제별 인원 (명단에 한 명도 없는 주제는 뺌): [{ key, emoji, label, n }]
function topicCounts(topics, people) {
  return topics.map(t => ({ ...t, n: people.filter(p => (p.topics || []).includes(t.key)).length })).filter(t => t.n > 0);
}

// 주소 # 뒤 ↔ 거르기 상태. 링크로 "생리학교실 보기"를 보낼 수 있게
function readHash(hash) {
  const s = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return { q: s.get('q') || '', dept: s.get('dept') || '', topic: s.get('topic') || '' };
}
function writeHash({ q = '', dept = '', topic = '' }) {
  const s = new URLSearchParams();
  if (q.trim()) s.set('q', q.trim());
  if (dept) s.set('dept', dept);
  if (topic) s.set('topic', topic);
  const t = s.toString();
  return t ? `#${t}` : '';
}
