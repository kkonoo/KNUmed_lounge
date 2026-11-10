// 계정 계산 확인: node --test (저장소 맨 위에서)
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./load.js')('js/account-core.js');

test('PIN → 비밀번호: 규칙 없이, Firebase 6자 제한은 넘게, 모양은 고정', () => {
  assert.equal(A.pinToPassword('1234'), 'lounge:1234:knumed'); // ⚠️ 바뀌면 모든 PIN이 안 맞아요
  assert.equal(A.pinToPassword(' 1 '), 'lounge:1:knumed');
  assert.ok(A.pinToPassword('1').length >= 6);
  assert.equal(A.pinProblem('1'), '');
  assert.equal(A.pinProblem('0000'), '');
  assert.notEqual(A.pinProblem('  '), '');
  assert.notEqual(A.pinProblem('x'.repeat(41)), '');
});

test('메일·가입 코드 다듬기', () => {
  assert.equal(A.normEmail('  Hong@KNU.ac.kr '), 'hong@knu.ac.kr');
  assert.equal(A.isEmail('hong@knu.ac.kr'), true);
  assert.equal(A.isEmail('hong@knu'), false);
  assert.equal(A.isEmail('홍길동'), false);
  assert.equal(A.normCode(' Ab 12 '), 'ab12');
  assert.equal(A.codeProblem('가을1124'), '');
  assert.equal(A.codeProblem('k'), '가입 코드는 영어·숫자·한글로 2~20자예요');
  assert.notEqual(A.codeProblem('ab-12'), '');
  assert.match(A.suggestCode(), /^[a-z2-9]{6}$/);
  assert.equal(A.codeProblem(A.suggestCode()), '');
});

test('명단 붙여 넣기: 메일 프로그램 받는 사람 칸 그대로', () => {
  const src = `* 홍길동 교수님 <a1@example.kr>,
* 김철수 교수님 <A2@Example.com>,
* 이영희 교수님 <lee@example.kr>, 
* 박민수 교수님 <park@example.kr>, 최지은 교수님 <choi@example.kr>`;
  const r = A.parseRoster(src);
  assert.deepEqual(r.rows.map(x => [x.name, x.email]), [
    ['홍길동', 'a1@example.kr'], ['김철수', 'a2@example.com'], ['이영희', 'lee@example.kr'], ['박민수', 'park@example.kr'], ['최지은', 'choi@example.kr'],
  ]);
  assert.deepEqual([...r.bad], []);
});

test('명단 붙여 넣기: 한 줄에 한 분 (이름, 메일, 교실), 겹치는 메일은 한 번', () => {
  const r = A.parseRoster('홍길동, hong@knu.ac.kr, 생리학교실\nkim@knu.ac.kr\t김철수\n이영희 교수님, lee@knu.ac.kr\n메일 없는 줄\nhong@knu.ac.kr, 홍길동2');
  assert.deepEqual(r.rows.map(x => [x.name, x.email, x.dept]), [
    ['홍길동', 'hong@knu.ac.kr', '생리학교실'], ['김철수', 'kim@knu.ac.kr', ''], ['이영희', 'lee@knu.ac.kr', ''],
  ]);
  assert.deepEqual([...r.bad], ['메일 없는 줄']);
});

test('관리자 화면 명단: 가입 상태와 예전 계정', () => {
  const roster = [
    { email: 'a@x.kr', name: '나', status: 'active' },
    { email: 'b@x.kr', name: '가', status: 'active' },
    { email: 'c@x.kr', name: '다', status: 'inactive' },
  ];
  const members = [{ uid: 'u1', email: 'a@x.kr', at: 1 }, { uid: 'u2', email: 'A@x.kr', at: 5 }, { uid: 'u3', email: 'c@x.kr', at: 2 }];
  const { rows, count } = A.rosterView(roster, members);
  assert.deepEqual(rows.map(r => [r.name, r.state]), [['가', 'waiting'], ['나', 'joined'], ['다', 'stopped']]);
  assert.deepEqual(rows[1].mems.map(m => m.uid), ['u2', 'u1']); // 새 계정부터
  assert.deepEqual({ ...count }, { all: 3, joined: 1, waiting: 1, stopped: 1 });
});

test('마지막 관리자는 못 뺌', () => {
  assert.equal(A.canRemoveAdmin(['a'], 'a'), false);
  assert.equal(A.canRemoveAdmin(['a', 'b'], 'a'), true);
  assert.equal(A.canRemoveAdmin(['a', 'b'], 'c'), false);
});

test('Firebase 오류 → 읽을 말', () => {
  assert.equal(A.authMessage({ code: 'auth/invalid-credential' }), '메일 주소나 PIN이 맞지 않아요');
  assert.match(A.authMessage({ code: 'auth/too-many-requests' }), /잠시 막혔어요/);
  assert.match(A.authMessage({ code: 'permission-denied' }), /권한/);
});
