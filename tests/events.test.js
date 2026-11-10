// 친목회 계산 확인: node --test (저장소 맨 위에서)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./load.js')('events/events-core.js');

const NOW = new Date(2026, 10, 10, 15, 0).getTime(); // 2026-11-10 (화) 15:00

test('날짜·시간 글자', () => {
  assert.equal(E.fmtDate('2026-11-24', NOW), '11월 24일 (화)');
  assert.equal(E.fmtDate('2027-01-05', NOW), '2027년 1월 5일 (화)');
  assert.equal(E.fmtDate('다음 주', NOW), '');
  assert.equal(E.fmtTime('18:30'), '오후 6:30');
  assert.equal(E.fmtTime('12:00'), '오후 12:00');
  assert.equal(E.fmtTime('00:10'), '오전 12:10');
  assert.equal(E.fmtTime(''), '');
  assert.equal(E.whenText({ date: '2026-11-24', time: '18:30' }, NOW), '11월 24일 (화) 오후 6:30');
  assert.equal(E.todayStr(NOW), '2026-11-10');
  const dl = new Date(2026, 10, 20, 18, 0).getTime();
  assert.equal(E.fmtStamp(dl, NOW), '11월 20일 (금) 오후 6:00');
  assert.equal(E.fromLocalInput(E.toLocalInput(dl)), dl);
  assert.equal(E.fromLocalInput(''), null);
});

test('열림·마감', () => {
  assert.equal(E.isOpen({ closed: false, deadline: null }, NOW), true);
  assert.equal(E.isOpen({ closed: true, deadline: null }, NOW), false);
  assert.equal(E.isOpen({ closed: false, deadline: NOW - 1 }, NOW), false);
  assert.equal(E.isOpen({ closed: false, deadline: NOW + 1 }, NOW), true);
});

test('다가오는 것·지난 것, 대상 거르기', () => {
  const ev = [
    { id: 'a', date: '2026-11-24', time: '18:30', audience: '기초' },
    { id: 'b', date: '2026-11-10', time: '', audience: '전체' },
    { id: 'c', date: '2026-10-20', time: '18:00', audience: '기초' },
    { id: 'd', date: '2026-12-01', time: '18:00', audience: '임상' },
  ];
  const mine = E.forMe(ev, '기초', false);
  assert.deepEqual(mine.map(e => e.id), ['a', 'b', 'c']);
  assert.equal(E.forMe(ev, '기초', true).length, 4);
  const { upcoming, past } = E.splitEvents(mine, '2026-11-10');
  assert.deepEqual(upcoming.map(e => e.id), ['b', 'a']);
  assert.deepEqual(past.map(e => e.id), ['c']);
});

test('응답 모으기와 아직 안 한 분', () => {
  const rsvps = [
    { uid: 'u2', status: 'yes', name: '홍길동', comment: '' },
    { uid: 'u1', status: 'yes', name: '가나다', comment: '늦어요' },
    { uid: 'u3', status: 'no', name: '김철수' },
  ];
  const t = E.tally(rsvps);
  assert.deepEqual(t.yes.map(r => r.name), ['가나다', '홍길동']);
  assert.equal(t.maybe.length, 0);
  assert.equal(t.no.length, 1);
  const members = [{ uid: 'u1', email: 'a@x' }, { uid: 'u2', email: 'B@x' }, { uid: 'u3', email: 'c@x' }, { uid: 'u9', email: 'd@x' }];
  const roster = [
    { email: 'a@x', name: '가나다', group: '기초', status: 'active' },  // 참석
    { email: 'b@x', name: '홍길동', group: '기초', status: 'active' },  // 참석 (메일 대소문자 달라도)
    { email: 'c@x', name: '김철수', group: '기초', status: 'active' },  // 불참
    { email: 'd@x', name: '라마바', group: '기초', status: 'active' },  // 가입했지만 아직
    { email: 'e@x', name: '사아자', group: '기초', status: 'active' },  // 가입도 아직
    { email: 'f@x', name: '차카타', group: '기초', status: 'inactive' },
    { email: 'g@x', name: '파하가', group: '임상', status: 'active' },
  ];
  assert.deepEqual(E.notYet(roster, rsvps, members, '기초').map(m => m.name), ['라마바', '사아자']);
  assert.deepEqual(E.notYet(roster, rsvps, members, '전체').map(m => m.name), ['라마바', '사아자', '파하가']);
});

test('만들기 확인과 공지 글', () => {
  const d = { title: '11월 기초친목회', date: '2026-11-24', time: '18:30', place: '복현동 ○○식당', mapUrl: '', deadline: null, note: '', audience: '기초' };
  assert.equal(E.eventProblem(d), '');
  assert.equal(E.eventProblem({ ...d, title: ' ' }), '제목을 넣어 주세요');
  assert.equal(E.eventProblem({ ...d, date: '' }), '날짜를 골라 주세요');
  assert.match(E.eventProblem({ ...d, mapUrl: 'naver.me/abc' }), /https/);
  assert.equal(E.defaultTitle('2026-11-24'), '11월 기초친목회');
  assert.equal(E.defaultTitle('2026-12-01', '전체'), '12월 친목회');
  const text = E.announceText({ ...d, deadline: new Date(2026, 10, 20, 18, 0).getTime(), note: '회비 3만 원' }, 'https://x/events/', NOW);
  assert.equal(text, '[11월 기초친목회]\n일시: 11월 24일 (화) 오후 6:30\n장소: 복현동 ○○식당\n참석 체크 마감: 11월 20일 (금) 오후 6:00\n\n회비 3만 원\n\n참석 체크: https://x/events/');
});
