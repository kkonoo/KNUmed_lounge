// 교수 디렉터리 계산 확인: node --test (저장소 맨 위에서)
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
});
