// 주문 모으기 계산 확인: node --test (저장소 맨 위에서). 장난감 상자 tests/order.test.js에서 가져옴
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./load.js')('order/order-core.js');

test('메뉴 글 → 줄: 빈 줄·앞뒤 빈칸·겹치는 이름 빼기', () => {
  assert.deepEqual(P.parseMenu(' 아메리카노 \n\n카페라떼\n아메리카노\n  바닐라   라떼 '), ['아메리카노', '카페라떼', '바닐라 라떼']);
  assert.deepEqual(P.parseMenu(''), []);
  assert.equal(P.parseMenu(Array.from({ length: 200 }, (_, i) => `메뉴${i}`).join('\n')).length, P.MENU_MAX);
  assert.equal(P.parseMenu('가'.repeat(100))[0].length, P.NAME_MAX);
});

test('온도 표시: 여러 꼴을 알아듣고 (아이스/따뜻한) · (아이스만) · (따뜻한만)으로 맞추기', () => {
  for (const s of ['아메리카노 (아이스/따뜻한)', '아메리카노 HOT/ICE', '아메리카노(ice/hot)', '아메리카노 [핫/아이스]', '아메리카노 따뜻한·아이스', '아메리카노 아이스 / 핫']) {
    assert.deepEqual(P.readEntry(s), { name: '아메리카노', temp: 'both' }, s);
    assert.deepEqual(P.parseMenu(s), ['아메리카노 (아이스/따뜻한)'], s);
  }
  for (const s of ['아인슈페너 (아이스만)', '아인슈페너 ICE ONLY', '아인슈페너(ice only)', '아인슈페너 아이스 전용', '아인슈페너 only ice']) {
    assert.deepEqual(P.readEntry(s), { name: '아인슈페너', temp: 'ice' }, s);
    assert.deepEqual(P.parseMenu(s), ['아인슈페너 (아이스만)'], s);
  }
  for (const s of ['뱅쇼 (따뜻한만)', '뱅쇼 HOT ONLY', '뱅쇼 핫 전용']) assert.deepEqual(P.parseMenu(s), ['뱅쇼 (따뜻한만)'], s);
  for (const s of ['아이스티', '아이스 아메리카노', '핫초코', '아이스/핫초코', '자몽에이드', '아이스만두']) assert.equal(P.readEntry(s).temp, '', s);
  // 같은 이름이 두 번 나오면 온도를 합쳐 한 번만
  assert.deepEqual(P.parseMenu('카페라떼\n카페라떼 HOT/ICE'), ['카페라떼 (아이스/따뜻한)']);
  assert.deepEqual(P.parseMenu('라떼 (아이스만)\n라떼 (따뜻한만)'), ['라떼 (아이스/따뜻한)']);
  assert.deepEqual(P.parseMenu('라떼\n라떼 (아이스만)'), ['라떼 (아이스만)']);
  // 나누는 메뉴가 있으면 따로 적은 아이스·따뜻한 줄은 빼서 한 칸을 두 번 세지 않음
  assert.deepEqual(P.parseMenu('아이스 아메리카노\n아메리카노 HOT/ICE\n따뜻한 아메리카노\n아이스티'), ['아메리카노 (아이스/따뜻한)', '아이스티']);
  assert.deepEqual(P.parseMenu('아인슈페너 (아이스만)\n아이스 아인슈페너'), ['아인슈페너 (아이스만)']);
});

test('세는 칸: 둘 다면 아이스·따뜻한, 하나만이면 그 하나', () => {
  assert.deepEqual(P.entryKeys('아메리카노 (아이스/따뜻한)'), [{ key: '아이스 아메리카노', temp: 'ice' }, { key: '따뜻한 아메리카노', temp: 'hot' }]);
  assert.deepEqual(P.entryKeys('아인슈페너 (아이스만)'), [{ key: '아이스 아인슈페너', temp: 'ice' }]);
  assert.deepEqual(P.entryKeys('뱅쇼 (따뜻한만)'), [{ key: '따뜻한 뱅쇼', temp: 'hot' }]);
  assert.deepEqual(P.entryKeys('자몽에이드'), [{ key: '자몽에이드', temp: '' }]);
  assert.equal(P.entryTotal('아메리카노 (아이스/따뜻한)', { '아이스 아메리카노': 3, '따뜻한 아메리카노': 2, 아메리카노: 9 }), 5);
});

test('읽은 메뉴 붙이기: 있던 메뉴 뒤에, 겹치는 건 한 번만', () => {
  assert.equal(P.addNames('아메리카노\n카페라떼', ['카페라떼', '녹차라떼']), '아메리카노\n카페라떼\n녹차라떼');
  assert.equal(P.addNames('', [{ name: '아메리카노', temp: 'both' }, { name: '아인슈페너', temp: 'ice' }]), '아메리카노 (아이스/따뜻한)\n아인슈페너 (아이스만)');
  assert.equal(P.addNames('아메리카노', [{ name: '아메리카노', temp: 'both' }]), '아메리카노 (아이스/따뜻한)');
});

test('바를 정: 다섯 획씩 묶기', () => {
  assert.deepEqual(P.tallyGroups(0), []);
  assert.deepEqual(P.tallyGroups(1), [1]);
  assert.deepEqual(P.tallyGroups(5), [5]);
  assert.deepEqual(P.tallyGroups(12), [5, 5, 2]);
  assert.deepEqual(P.tallyGroups(-3), []);
  for (let n = 0; n <= 60; n++) assert.equal(P.tallyGroups(n).reduce((s, g) => s + g, 0), n);
});

test('메뉴를 고치면: 남은 칸은 개수 그대로, 빠진 칸은 dropped', () => {
  const r = P.keepCounts({ 아메리카노: 3, 카페라떼: 0, 녹차라떼: 2 }, ['아메리카노', '카페라떼']);
  assert.deepEqual(r.counts, { 아메리카노: 3 });
  assert.deepEqual(r.dropped, [['녹차라떼', 2]]);
  // 나누던 메뉴를 안 나누게 바꾸면 아이스·따뜻한 개수는 빠짐
  const s = P.keepCounts({ '아이스 아메리카노': 4, '따뜻한 아메리카노': 1 }, ['아메리카노']);
  assert.deepEqual(s.counts, {});
  assert.deepEqual(s.dropped, [['아이스 아메리카노', 4], ['따뜻한 아메리카노', 1]]);
  assert.deepEqual(P.keepCounts({ '아이스 아메리카노': 4 }, ['아메리카노 (아이스/따뜻한)']).counts, { '아이스 아메리카노': 4 });
});

test('주문 글: 메뉴 순서대로, 아이스 먼저, 0개는 빼고, 모두 몇 잔', () => {
  const menu = ['아메리카노 (아이스/따뜻한)', '카페라떼', '아인슈페너 (아이스만)', '녹차라떼'];
  assert.equal(P.orderText(menu, { 녹차라떼: 1, '따뜻한 아메리카노': 2, '아이스 아메리카노': 5, 카페라떼: 0, '아이스 아인슈페너': 3 }),
    '카페 주문 (모두 11잔)\n아이스 아메리카노 5\n따뜻한 아메리카노 2\n아이스 아인슈페너 3\n녹차라떼 1');
  assert.equal(P.orderText(['김치찌개', '된장찌개'], { 김치찌개: 4, 된장찌개: 2 }, 'meal'), '식당 주문 (모두 6개)\n김치찌개 4\n된장찌개 2');
  assert.equal(P.totalOf({}), 0);
});

test('사진 줄이기: 긴 쪽을 맞추고 비율 그대로, 작은 사진은 그대로', () => {
  assert.deepEqual(P.fitSize(4000, 3000, 2000), [2000, 1500]);
  assert.deepEqual(P.fitSize(3000, 4000, 2000), [1500, 2000]);
  assert.deepEqual(P.fitSize(800, 600, 2000), [800, 600]);
});

test('Claude 답 읽기: items의 name·temp만, 모르는 temp는 나누지 않고, 모양이 다르면 빼거나 빈 목록', () => {
  assert.deepEqual(P.parseMenuReply(JSON.stringify({ items: [
    { name: '아메리카노', temp: 'both' }, { name: ' 자몽에이드 ', temp: 'none' }, { name: '아메리카노', temp: 'none' },
    { name: '아인슈페너', temp: 'ice' }, { name: '뱅쇼', temp: 'hot' }, { name: '카페라떼 HOT/ICE', temp: 'none' },
    { name: '녹차라떼', temp: 'warm' }, { temp: 'both' }, '바닐라라떼',
  ] })), ['아메리카노 (아이스/따뜻한)', '자몽에이드', '아인슈페너 (아이스만)', '뱅쇼 (따뜻한만)', '카페라떼 (아이스/따뜻한)', '녹차라떼']);
  assert.deepEqual(P.parseMenuReply('{"items":"아메리카노"}'), []);
  assert.deepEqual(P.parseMenuReply('메뉴판이 아니에요'), []);
  assert.deepEqual(P.parseMenuReply(''), []);
});
