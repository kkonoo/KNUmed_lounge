// 연구실 둘러보기 계산 확인: node --test (저장소 맨 위에서)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('./load.js')('people/people-core.js');

const PEOPLE = [
  { id: 'a', name: '홍길동', rank: '교수', dept: '생리학교실', line: '지방간과 호중구', keywords: ['호중구', '선천면역'], topics: ['immune', 'metabolic'] },
  { id: 'b', name: '김철수', rank: '부교수', dept: '생화학·세포생물학교실', line: '세포 노화 연구', keywords: ['노화', 'RNA'], topics: ['cancer'] },
  { id: 'c', name: '가나다', rank: '조교수', dept: '생리학교실', line: 'Alzheimer 지질 신호', keywords: ['알츠하이머병'], topics: ['brain'] },
];

test('찾기: 띄어쓰기·대소문자·가운뎃점 무시, 낱말은 모두 맞아야', () => {
  const ids = q => P.filterPeople(PEOPLE, { q }).map(p => p.id);
  assert.deepEqual(ids(''), ['a', 'b', 'c']);
  assert.deepEqual(ids('호중구'), ['a']);
  assert.deepEqual(ids('생화학 세포'), ['b']);
  assert.deepEqual(ids('생화학·세포생물학'), ['b']);
  assert.deepEqual(ids('alzheimer'), ['c']);
  assert.deepEqual(ids('생리학 지질'), ['c']);
  assert.deepEqual(ids('생리학 노화'), []);
  assert.deepEqual(ids('부교수'), ['b']);
});

test('거르기: 교실 · 주제 · 찾는 말을 같이', () => {
  const ids = f => P.filterPeople(PEOPLE, f).map(p => p.id);
  assert.deepEqual(ids({ dept: '생리학교실' }), ['a', 'c']);
  assert.deepEqual(ids({ topic: 'brain' }), ['c']);
  assert.deepEqual(ids({ dept: '생리학교실', topic: 'metabolic' }), ['a']);
  assert.deepEqual(ids({ dept: '생리학교실', q: '알츠하이머' }), ['c']);
  assert.deepEqual(ids({ dept: '해부학교실' }), []);
});

test('교실별 묶기: 교실·이름 가나다', () => {
  const g = P.groupByDept(PEOPLE);
  assert.deepEqual(g.map(([d]) => d), ['생리학교실', '생화학·세포생물학교실']);
  assert.deepEqual(g[0][1].map(p => p.name), ['가나다', '홍길동']);
  assert.deepEqual([...P.deptCounts(PEOPLE)], [['생리학교실', 2], ['생화학·세포생물학교실', 1]]);
  assert.equal(P.shortDept('분자의학교실'), '분자의학');
});

test('주제 인원: 아무도 없는 주제는 빼기', () => {
  const t = P.topicCounts([{ key: 'brain', label: '뇌' }, { key: 'sense', label: '눈·귀' }], PEOPLE);
  assert.deepEqual(t.map(x => [x.key, x.n]), [['brain', 1]]);
});

test('주소 #: 거르기 상태를 오가며 그대로', () => {
  const f = { q: '호중구 지방간', dept: '생리학교실', topic: 'immune' };
  assert.deepEqual(P.readHash(P.writeHash(f)), f);
  assert.equal(P.writeHash({ q: '  ' }), '');
  assert.deepEqual(P.readHash(''), { q: '', dept: '', topic: '' });
});

test('공개 데이터(data/people.json)에 메일·연락처가 없음', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'people.json'), 'utf8');
  assert.equal(/@/.test(raw), false, '메일 주소처럼 보이는 글자가 있어요');
  const data = JSON.parse(raw);
  for (const p of data.people) {
    for (const k of ['email', 'contact', 'phone']) assert.equal(k in p, false, `${p.id}: ${k}`);
    assert.match(p.id, /^[a-z2-9]{6}$/);
    if (p.photo) assert.equal(p.photo, `photos/${p.id}.jpg`);
  }
  // 논문 초안: 교수님이 그대로 저장해도 통과하는 값 (칸 수가 넘쳐 잘리는 것도 없음)
  for (const [id, d] of Object.entries(data.drafts || {})) {
    assert.match(id, /^[a-z2-9]{6}$/);
    for (const k of Object.keys(d)) assert.ok(['line', 'question', 'keywords', 'topics', 'axes', 'timeline', 'resources'].includes(k), `${id}: ${k}`);
    assert.ok((d.axes || []).length <= P.PROFILE_MAX.axes && (d.timeline || []).length <= P.PROFILE_MAX.timeline, id);
    for (const a of d.axes || []) assert.ok(a.papers.length <= P.PROFILE_MAX.papers && a.papers.every(x => /^https:\/\//.test(x.url)), id);
    const base = data.people.find(p => p.id === id) || {};
    assert.ok(base.line || d.line, `${id}: 이름북에 없는 분은 초안에 한 줄 소개가 있어야 해요`);
    assert.equal(P.profileProblem(P.cleanProfile(P.profileForm(null, { ...base, ...d }))), '', id);
  }
  // 이름북에 없는 분 사진: 번호 → 파일만 (이름은 적지 않음), 파일이 실제로 있음
  for (const [id, file] of Object.entries(data.photos || {})) {
    assert.match(id, /^[a-z2-9]{6}$/);
    assert.equal(file, `photos/${id}.jpg`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
  }
});

// ---------- 프로필 ----------
const BOOK = [
  { id: 'aaaaaa', name: '홍길동', rank: '교수', dept: '가짜학교실', line: '이름북 소개', keywords: ['가짜'], topics: ['brain'], links: [['https://example.com/a', '교수 소개 페이지']], photo: 'photos/aaaaaa.jpg', status: 'namebook' },
  { id: 'bbbbbb', name: '김철수', rank: '부교수', dept: '예시학교실', line: '다른 소개', keywords: [], topics: [], links: [], photo: 'photos/bbbbbb.jpg', status: 'namebook' },
];

test('공개 목록 합치기: 본인 저장 → 그 내용, 아직 → 이름북, 이름북에 없으면 이름·교실만, 숨김은 빼기', () => {
  const docs = [
    { id: 'aaaaaa', name: '홍길동', dept: '가짜학교실', group: '기초', rank: '교수', hidden: false, line: '본인이 쓴 소개', question: '질문', keywords: ['새'], topics: [], axes: [{ name: '축', text: '설명', papers: [] }], timeline: [], resources: { models: '마우스' }, links: [{ url: 'https://example.com/lab', label: '연구실' }], confirmedAt: 1000 },
    { id: 'bbbbbb', name: '김철수', dept: '바뀐교실', group: '기초', rank: '', hidden: true },
    { id: 'cccccc', name: '이영희', dept: '예시학교실', group: '기초', rank: '', hidden: false },
    { id: 'dddddd', name: '박영수', dept: '예시학교실', group: '기초', rank: '', hidden: false },
  ];
  const m = new Map(P.mergeProfiles(BOOK, docs, { dddddd: 'photos/dddddd.jpg' }).map(p => [p.id, p]));
  assert.equal(m.size, 3);
  assert.equal(m.get('aaaaaa').status, 'confirmed');
  assert.equal(m.get('aaaaaa').line, '본인이 쓴 소개');
  assert.equal(m.get('aaaaaa').photo, 'photos/aaaaaa.jpg');
  assert.deepEqual(m.get('aaaaaa').links, [['https://example.com/lab', '연구실']]);
  assert.equal(m.has('bbbbbb'), false);
  assert.equal(m.get('cccccc').status, 'listed');
  assert.equal(m.get('cccccc').line, '');
  assert.equal(m.get('cccccc').photo, '');
  assert.equal(m.get('dddddd').photo, 'photos/dddddd.jpg'); // 이름북에 없는 분은 photos에서
  const before = P.mergeProfiles(BOOK, [{ id: 'bbbbbb', name: '김철수', dept: '바뀐교실', group: '기초', rank: '', hidden: false }]);
  assert.equal(before.find(p => p.id === 'bbbbbb').line, '다른 소개'); // 확인 전엔 이름북 소개 그대로
  assert.equal(before.find(p => p.id === 'bbbbbb').dept, '바뀐교실'); // 교실은 관리자가 고친 값
  assert.equal(before.find(p => p.id === 'bbbbbb').rank, '부교수');
});

test('논문 초안: 확인 전에만 보이고, 이름북 한 줄은 그대로. 이름북에 없는 분은 초안의 한 줄로', () => {
  const drafts = {
    bbbbbb: { question: '초안 질문', axes: [{ name: '초안 축', text: '설명', papers: [{ label: 'J 2024', url: 'https://doi.org/10.1/x' }] }], timeline: [{ years: '2010–2015', text: '시작' }], resources: { techniques: '단일세포' } },
    aaaaaa: { question: '쓰이면 안 됨' },
    eeeeee: { line: '초안 한 줄', keywords: ['초안'], topics: ['brain'], question: '초안 질문' },
  };
  const docs = [
    { id: 'aaaaaa', name: '홍길동', dept: '가짜학교실', group: '기초', rank: '교수', hidden: false, line: '본인이 쓴 소개', question: '본인 질문', keywords: [], topics: [], axes: [], timeline: [], resources: {}, links: [], confirmedAt: 1000 },
    { id: 'bbbbbb', name: '김철수', dept: '예시학교실', group: '기초', rank: '', hidden: false },
    { id: 'eeeeee', name: '박영수', dept: '예시학교실', group: '기초', rank: '', hidden: false },
  ];
  const m = new Map(P.mergeProfiles(BOOK, docs, {}, drafts).map(p => [p.id, p]));
  assert.equal(m.get('aaaaaa').question, '본인 질문'); // 저장했으면 초안은 안 씀
  assert.equal(m.get('aaaaaa').drafted, undefined);
  assert.equal(m.get('bbbbbb').line, '다른 소개'); // 이름북 한 줄은 그대로
  assert.equal(m.get('bbbbbb').question, '초안 질문');
  assert.equal(m.get('bbbbbb').drafted, true);
  assert.equal(m.get('eeeeee').line, '초안 한 줄');
  assert.equal(m.get('eeeeee').status, 'draft');
  assert.equal(P.mergeProfiles(BOOK, [], {}, drafts).find(p => p.id === 'bbbbbb').question, '초안 질문'); // Firestore 전에도
  const f = P.profileForm(null, { ...BOOK[1], ...drafts.bbbbbb }); // 내 프로필 칸도 초안으로 채워짐
  assert.equal(f.question, '초안 질문');
  assert.equal(f.axes[0].papers, 'J 2024 https://doi.org/10.1/x');
  assert.equal(f.timeline[0].years, '2010–2015');
  assert.equal(f.resources.techniques, '단일세포');
  assert.equal(f.line, '다른 소개');
});

test('찾기: 본인이 쓴 연구 축·보유 자원도 찾음', () => {
  const p = { name: '홍길동', dept: '', line: '', axes: [{ name: '지질 신호', text: '' }], resources: { equipment: '공초점 현미경' } };
  assert.equal(P.matches(p, '공초점'), true);
  assert.equal(P.matches(p, '지질신호'), true);
});

test('1년 넘게 확인 안 한 프로필', () => {
  const now = Date.UTC(2026, 10, 10);
  assert.equal(P.isStale(now - 400 * 864e5, now), true);
  assert.equal(P.isStale(now - 30 * 864e5, now), false);
  assert.equal(P.isStale(null, now), false);
});

test('고치기 칸: 처음엔 이름북에서, 저장한 뒤엔 내 값. 축 3칸·발자취 4칸·링크 4칸', () => {
  const f = P.profileForm(null, BOOK[0]);
  assert.equal(f.line, '이름북 소개');
  assert.equal(f.keywords, '가짜');
  assert.deepEqual(f.topics, ['brain']);
  assert.equal(f.axes.length, 3);
  assert.equal(f.timeline.length, 4);
  assert.equal(f.links.length, 4);
  assert.deepEqual(f.links[0], { url: 'https://example.com/a', label: '교수 소개 페이지' });
  const g = P.profileForm({ confirmedAt: 1, rank: '교수', line: '내 소개', keywords: ['a', 'b'], topics: [], axes: [{ name: '축', text: '설명', papers: [{ label: 'Brain 2023', url: 'https://example.com/p' }] }], timeline: [{ years: '2010–2015', text: '시작' }], resources: { data: '코호트' }, links: [] }, BOOK[0]);
  assert.equal(g.line, '내 소개');
  assert.equal(g.keywords, 'a, b');
  assert.equal(g.axes[0].papers, 'Brain 2023 https://example.com/p');
  assert.equal(g.resources.data, '코호트');
  assert.equal(g.resources.models, '');
});

test('저장 값 다듬기와 확인', () => {
  const v = P.profileForm(null, BOOK[0]);
  v.keywords = '노화, RNA, 노화,  ';
  v.axes[0] = { name: '세포 노화', text: '어떻게 시작될까', papers: 'Brain 2023 https://example.com/p1\nhttps://example.com/p2' };
  v.timeline[1] = { years: '2016–2020', text: '부임' };
  v.links[1] = { url: 'https://scholar.google.com/citations?user=x', label: '' };
  const c = P.cleanProfile(v);
  assert.deepEqual(c.keywords, ['노화', 'RNA']);
  assert.equal(c.axes.length, 1);
  assert.deepEqual(c.axes[0].papers, [{ label: 'Brain 2023', url: 'https://example.com/p1' }, { label: '논문', url: 'https://example.com/p2' }]);
  assert.deepEqual(c.timeline, [{ years: '2016–2020', text: '부임' }]);
  assert.equal(c.links[1].label, 'Google Scholar');
  assert.equal(P.profileProblem(c), '');
  assert.equal(P.profileProblem({ ...c, line: '' }), '한 줄 소개를 넣어 주세요');
  assert.equal(P.profileProblem({ ...c, axes: [{ name: '', text: '설명만', papers: [] }] }), '연구 축 1의 이름을 넣어 주세요');
  assert.equal(P.profileProblem({ ...c, axes: [{ name: '축', text: '', papers: [{ label: 'a', url: 'https://x.y/1' }, { label: 'b', url: 'https://x.y/2' }, { label: 'c', url: 'https://x.y/3' }] }] }), '대표 논문은 축마다 2편까지예요');
  assert.equal(P.profileProblem({ ...c, timeline: [{ years: '2010', text: '' }] }), '연구 발자취는 기간과 한 줄을 같이 넣어 주세요');
  assert.equal(P.profileProblem({ ...c, links: [{ url: 'javascript:alert(1)', label: 'x' }] }), '링크 주소는 https://로 시작해요');
  assert.equal(P.profileProblem({ ...c, keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }), '키워드는 10개까지예요');
});

test('관리자: 이름이 같은 이름북 프로필 잇기 제안 (동명이인·이미 쓰는 번호는 빼기)', () => {
  const roster = [
    { email: 'hong@example.com', name: '홍길동' },
    { email: 'kim1@example.com', name: '김철수' }, { email: 'kim2@example.com', name: '김철수' },
    { email: 'lee@example.com', name: '이영희' },
    { email: 'park@example.com', name: '박가짜', profile: 'aaaaaa' },
  ];
  assert.deepEqual(P.nameLinks(roster, BOOK, new Set()).map(x => [x.row.email, x.person.id]), [['hong@example.com', 'aaaaaa']]);
  assert.deepEqual(P.nameLinks(roster, BOOK, new Set(['aaaaaa'])), []);
  // 새 번호: 이미 있는 번호면 다시 뽑음 (첫 6글자 'aaaaaa'는 있어서 다음 'bbbbbb')
  const seq = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1].map(n => (n + 0.01) / 31);
  let i = 0;
  assert.equal(P.newProfileId(new Set(['aaaaaa']), () => seq[i++]), 'bbbbbb');
  assert.match(P.newProfileId(new Set()), /^[a-z2-9]{6}$/);
});
