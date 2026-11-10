'use strict';
// 연구실 둘러보기 계산 (화면 없음): people.js가 쓰고, tests/people.test.js 가 Node에서 확인
// 사람 = { id, name, rank, dept, group, line, keywords: [], topics: [], links: [[주소, 글자]], photo, source, status }
//   본인이 저장한 프로필은 여기에 question, axes [{ name, text, papers: [{ label, url }] }], timeline [{ years, text }],
//   resources { models, samples, equipment, data, techniques }, confirmedAt(ms)가 더해짐

// 찾기용 글자: 띄어쓰기·대소문자·가운뎃점 무시 ('생화학 세포' = '생화학·세포')
const fold = s => String(s || '').toLowerCase().replace(/[\s·・,.\-_/()]+/g, '');

// '분자의학교실' → '분자의학' (고르는 단추에 짧게)
const shortDept = d => String(d).replace(/교실$/, '');

// 한 사람이 찾는 말에 맞는지: 이름·교실·소개·키워드 어디든. 낱말을 띄어 쓰면 모두 맞아야 함 (그리고)
function matches(p, q) {
  const words = String(q || '').trim().split(/\s+/).map(fold).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([p.name, p.dept, p.rank, p.line, p.question, ...(p.keywords || []), ...Object.values(p.resources || {}),
    ...(p.axes || []).flatMap(a => [a.name, a.text])].join(' '));
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

// ---------- 프로필 (Firestore profiles/{번호}) ----------
// 모든 교수님이 같은 칸, 같은 길이 한도예요 (DESIGN §8). 칸 수 한도는 firestore.rules도 확인
const RESOURCE_KINDS = [['models', '모델'], ['samples', '시료·코호트'], ['equipment', '장비'], ['data', '데이터'], ['techniques', '기법']];
const PROFILE_MAX = {
  rank: 20, line: 160, question: 600, keyword: 30, keywords: 10, resource: 300, links: 4, label: 40, url: 300,
  axes: 3, axisName: 40, axisText: 200, papers: 2, timeline: 4, years: 20, step: 120,
  seeking: 300, now: 160, contact: 200,
};
const isUrl = s => /^https?:\/\/\S+$/.test(s);

// 공개 목록: 이름북(people.json) 위에 Firestore 프로필을 얹음
//   본인이 저장했으면(confirmedAt) 그 내용 · 아직이면 이름북 소개, 이름북에도 없으면 이름·교실만(status 'listed') · 숨김이면 빼기
//   photos: 이름북에 없는 분의 사진 { 번호: 'photos/번호.jpg' } (people.json의 photos, 학교 홈페이지 교수소개에서)
function mergeProfiles(base, docs, photos = {}) {
  const out = new Map(base.map(p => [p.id, p]));
  for (const d of docs) {
    const old = out.get(d.id);
    if (d.hidden) { out.delete(d.id); continue; }
    const head = { id: d.id, name: d.name, dept: d.dept || old?.dept || '', group: d.group || '기초', rank: d.rank || old?.rank || '', photo: old?.photo || photos[d.id] || '' };
    if (d.confirmedAt) {
      out.set(d.id, {
        ...head, line: d.line || '', question: d.question || '', keywords: d.keywords || [], topics: d.topics || [],
        axes: d.axes || [], timeline: d.timeline || [], resources: d.resources || {},
        links: (d.links || []).map(l => [l.url, l.label]), confirmedAt: d.confirmedAt, status: 'confirmed',
      });
    } else if (old) out.set(d.id, { ...old, ...head });
    else out.set(d.id, { ...head, line: '', keywords: [], topics: [], links: [], status: 'listed' });
  }
  return [...out.values()];
}

// 확인한 날: '2026. 11. 10.'
const fmtDay = ms => { const d = new Date(ms); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };

// 마지막 확인이 1년 넘음 → 흐리게 (DESIGN §8)
const isStale = (ms, now = Date.now()) => !!ms && now - ms > 365 * 864e5;

// 키워드 칸: 쉼표·줄바꿈으로 나누고 같은 것은 한 번만
const parseKeywords = s => [...new Set(String(s || '').split(/[,，、\n]/).map(k => k.trim()).filter(Boolean))];

// 링크 이름을 비워 두면 주소로 짐작
function linkLabel(url) {
  const host = (/^https?:\/\/([^/?#]+)/.exec(url) || [])[1] || '';
  if (/scholar\.google/.test(host)) return 'Google Scholar';
  if (/orcid\.org$/.test(host)) return 'ORCID';
  if (/researchgate\.net$/.test(host)) return 'ResearchGate';
  if (/pubmed|ncbi\.nlm/.test(host)) return 'PubMed';
  return '링크';
}

// 대표 논문 칸: 한 줄에 하나, '이름 주소' 또는 주소만 → [{ label, url }]
function parsePapers(s) {
  return String(s || '').split('\n').map(line => {
    const url = (line.match(/https?:\/\/\S+/) || [''])[0];
    const label = line.replace(url, '').replace(/[\s·:|,-]+$/, '').trim();
    return url ? { label: label || '논문', url } : null;
  }).filter(Boolean);
}
const papersText = papers => (papers || []).map(p => (p.label && p.label !== '논문' ? `${p.label} ${p.url}` : p.url)).join('\n');

// 내 프로필 고치기 칸의 처음 값: 저장한 적 있으면 그 값, 없으면 이름북 소개에서 가져옴
//   연구 축은 3칸, 발자취는 4칸으로 늘 같은 수 (빈 칸은 저장할 때 빠짐)
function profileForm(doc, old) {
  const mine = doc?.confirmedAt ? doc : null;
  const pad = (list, n, empty) => [...list, ...Array.from({ length: Math.max(0, n - list.length) }, empty)].slice(0, n);
  return {
    rank: doc?.rank || old?.rank || '',
    line: mine ? mine.line || '' : old?.line || '',
    question: mine?.question || '',
    keywords: (mine ? mine.keywords || [] : old?.keywords || []).join(', '),
    topics: [...(mine ? mine.topics || [] : old?.topics || [])],
    axes: pad((mine?.axes || []).map(a => ({ name: a.name || '', text: a.text || '', papers: papersText(a.papers) })), PROFILE_MAX.axes, () => ({ name: '', text: '', papers: '' })),
    timeline: pad((mine?.timeline || []).map(t => ({ years: t.years || '', text: t.text || '' })), PROFILE_MAX.timeline, () => ({ years: '', text: '' })),
    resources: Object.fromEntries(RESOURCE_KINDS.map(([k]) => [k, mine?.resources?.[k] || ''])),
    links: pad(mine ? (mine.links || []).map(l => ({ ...l })) : (old?.links || []).map(([url, label]) => ({ url, label })), PROFILE_MAX.links, () => ({ url: '', label: '' })),
  };
}

// 저장할 값으로 다듬기 (빈 줄은 빼고, 이름 없는 링크는 주소로 짐작)
function cleanProfile(v) {
  return {
    rank: v.rank.trim(), line: v.line.trim(), question: v.question.trim(),
    keywords: parseKeywords(v.keywords), topics: [...v.topics],
    axes: v.axes.map(a => ({ name: a.name.trim(), text: a.text.trim(), papers: parsePapers(a.papers) })).filter(a => a.name || a.text || a.papers.length),
    timeline: v.timeline.map(t => ({ years: t.years.trim(), text: t.text.trim() })).filter(t => t.years || t.text),
    resources: Object.fromEntries(RESOURCE_KINDS.map(([k]) => [k, (v.resources[k] || '').trim()])),
    links: v.links.map(l => ({ url: l.url.trim(), label: l.label.trim() })).filter(l => l.url).map(l => ({ ...l, label: l.label || linkLabel(l.url) })),
  };
}
function profileProblem(c) {
  const M = PROFILE_MAX;
  if (!c.line) return '한 줄 소개를 넣어 주세요';
  if (c.rank.length > M.rank) return `직위는 ${M.rank}자까지예요`;
  if (c.line.length > M.line) return `한 줄 소개는 ${M.line}자까지예요`;
  if (c.question.length > M.question) return `연구 질문은 ${M.question}자까지예요`;
  if (c.keywords.length > M.keywords) return `키워드는 ${M.keywords}개까지예요`;
  if (c.keywords.some(k => k.length > M.keyword)) return `키워드 하나는 ${M.keyword}자까지예요`;
  if (c.axes.length > M.axes) return `연구 축은 ${M.axes}개까지예요`;
  for (const [i, a] of c.axes.entries()) {
    if (!a.name) return `연구 축 ${i + 1}의 이름을 넣어 주세요`;
    if (a.name.length > M.axisName) return `연구 축 이름은 ${M.axisName}자까지예요`;
    if (a.text.length > M.axisText) return `연구 축 설명은 ${M.axisText}자까지예요`;
    if (a.papers.length > M.papers) return `대표 논문은 축마다 ${M.papers}편까지예요`;
    if (a.papers.some(p => p.url.length > M.url || p.label.length > M.label)) return '대표 논문 줄이 너무 길어요';
  }
  if (c.timeline.length > M.timeline) return `연구 발자취는 ${M.timeline}줄까지예요`;
  for (const t of c.timeline) {
    if (!t.years || !t.text) return '연구 발자취는 기간과 한 줄을 같이 넣어 주세요';
    if (t.years.length > M.years || t.text.length > M.step) return `연구 발자취 한 줄은 ${M.step}자까지예요`;
  }
  for (const [k, label] of RESOURCE_KINDS) if (c.resources[k].length > M.resource) return `${label} 칸은 ${M.resource}자까지예요`;
  if (c.links.length > M.links) return `링크는 ${M.links}개까지예요`;
  for (const l of c.links) {
    if (!isUrl(l.url) || l.url.length > M.url) return '링크 주소는 https://로 시작해요';
    if (l.label.length > M.label) return `링크 이름은 ${M.label}자까지예요`;
  }
  return '';
}

// 관리자: 명단 ↔ 이름북 프로필 잇기 제안
//   아직 프로필이 없는 명단 중, 명단과 이름북 모두에 그 이름이 딱 한 분이고 그 프로필을 아무도 안 쓰는 경우만 (동명이인은 사람이 직접)
function nameLinks(roster, people, taken) {
  const count = (list, name) => list.filter(x => x.name === name).length;
  return roster.filter(r => !r.profile && count(roster, r.name) === 1 && count(people, r.name) === 1)
    .map(r => ({ row: r, person: people.find(p => p.name === r.name) }))
    .filter(x => !taken.has(x.person.id));
}

// 새 프로필 번호: 메일과 상관없는 6글자 (이름북 번호와 같은 모양)
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function newProfileId(taken, rand = Math.random) {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ID_CHARS[Math.floor(rand() * ID_CHARS.length)];
    if (!taken.has(s)) return s;
  }
}
