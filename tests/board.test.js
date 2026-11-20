'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('./load')('board/board-core.js');

test('글 확인: 제목·내용 필수, 한도', () => {
  assert.equal(B.postProblem({ title: ' ', body: '내용' }), '제목을 넣어 주세요');
  assert.equal(B.postProblem({ title: '제목', body: '\n' }), '내용을 넣어 주세요');
  assert.equal(B.postProblem({ title: 'ㄱ'.repeat(81), body: '내용' }), '제목은 80자까지예요');
  assert.equal(B.postProblem({ title: '제목', body: 'ㄱ'.repeat(4001) }), '내용은 4000자까지예요');
  assert.equal(B.postProblem({ title: '장비 나눔', body: '원심분리기 하나 나눠요' }), '');
});

test('새 글 수: 지난번 본 뒤의 남의 글만', () => {
  const posts = [{ at: 300, by: 'a' }, { at: 200, by: 'me' }, { at: 150, by: 'b' }, { at: 100, by: 'c' }];
  assert.equal(B.newCount(posts, 120, 'me'), 2);
  assert.equal(B.newCount(posts, 0, 'me'), 3);
  assert.equal(B.newCount(posts, 300, 'me'), 0);
});

test('글 시각: 오늘은 시각, 올해는 날짜, 그 전은 연도까지', () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime();
  assert.equal(B.fmtWhen(new Date(2026, 10, 10, 9, 5).getTime(), now), '오전 9:05');
  assert.equal(B.fmtWhen(new Date(2026, 10, 10, 12, 30).getTime(), now), '오후 12:30');
  assert.equal(B.fmtWhen(new Date(2026, 10, 9, 23, 0).getTime(), now), '11월 9일');
  assert.equal(B.fmtWhen(new Date(2025, 0, 2).getTime(), now), '2025. 1. 2.');
  assert.equal(B.fmtWhen(0, now), '');
});

test('본문 링크: http(s) 주소만, 끝 문장부호는 글자로', () => {
  assert.deepEqual(B.linkParts('세미나 https://example.com/a?b=1. 많이 와 주세요'), [
    ['t', '세미나 '], ['a', 'https://example.com/a?b=1'], ['t', '. 많이 와 주세요'],
  ]);
  assert.deepEqual(B.linkParts('(http://example.com)'), [['t', '('], ['a', 'http://example.com'], ['t', ')']]);
  assert.deepEqual(B.linkParts('javascript:alert(1) ftp://x'), [['t', 'javascript:alert(1) ftp://x']]);
  assert.deepEqual(B.linkParts(''), []);
});

test('목록 페이지: 공지는 빼고 20개씩, 번호 단추는 가운데에', () => {
  const posts = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, pinned: i === 3 }));
  assert.equal(B.pagePosts(posts, 1).length, 20);
  assert.equal(B.pagePosts(posts, 1).some(p => p.pinned), false);
  assert.deepEqual(B.pagePosts(posts, 3).map(p => p.id), ['p41', 'p42', 'p43', 'p44']);
  assert.equal(B.pageCount(45, 1), 3);
  assert.equal(B.pageCount(0, 0), 1);
  assert.equal(B.pageCount(20, 0), 1);
  assert.equal(B.pageCount(21, 0), 2);
  assert.deepEqual(B.pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(B.pageNumbers(6, 12), [4, 5, 6, 7, 8]);
  assert.deepEqual(B.pageNumbers(12, 12), [8, 9, 10, 11, 12]);
  assert.deepEqual(B.pageNumbers(1, 12), [1, 2, 3, 4, 5]);
  assert.deepEqual(B.readList('#page=3'), { cat: '', page: 3 });
  assert.deepEqual(B.readList(''), { cat: '', page: 1 });
  assert.deepEqual(B.readList('#page=0'), { cat: '', page: 1 });
  assert.deepEqual(B.readList('#page=abc'), { cat: '', page: 1 });
  assert.deepEqual(B.readList('#p=abc'), { cat: '', page: 1 });
});

test('말머리: 넷 중 하나, 주소에 남아요 (#cat=meet&page=2)', () => {
  assert.deepEqual(B.BOARD_CATS.map(([, label]) => label), ['소식', '번개', '일상', '기타']);
  assert.equal(B.catLabel(B.BOARD_CAT_DEFAULT), '기타');
  assert.equal(B.catLabel('meet'), '번개');
  assert.equal(B.catLabel(undefined), ''); // 말머리 전에 쓴 글
  assert.equal(B.catLabel('toString'), '');
  assert.deepEqual(B.readList('#cat=meet&page=2'), { cat: 'meet', page: 2 });
  assert.deepEqual(B.readList('#cat=bad'), { cat: '', page: 1 });
  assert.equal(B.writeList({ cat: 'meet', page: 2 }), '#cat=meet&page=2');
  assert.equal(B.writeList({ cat: 'daily' }), '#cat=daily');
  assert.equal(B.writeList({ page: 3 }), '#page=3');
  assert.equal(B.writeList({ cat: '', page: 1 }), '');
  for (const s of [{ cat: 'news', page: 4 }, { cat: '', page: 2 }]) assert.deepEqual(B.readList(B.writeList(s)), s);
});

test('사진: 긴 쪽을 맞춰 비율대로 줄이고, 작으면 그대로. 줄일수록 작게', () => {
  assert.deepEqual(B.photoSize(4032, 3024, 1600), [1600, 1200]);
  assert.deepEqual(B.photoSize(3024, 4032, 1600), [1200, 1600]);
  assert.deepEqual(B.photoSize(800, 600, 1600), [800, 600]);
  assert.equal(B.BOARD_PHOTO.max, 3);
  const edges = B.BOARD_PHOTO.steps.map(([e]) => e);
  assert.deepEqual(edges, [...edges].sort((a, b) => b - a));
  assert.ok(B.BOARD_PHOTO.chars < 1000000); // Firestore 문서 하나는 1MB까지
});

test('반응: 번개 글은 손들기만, 다른 글은 여섯 가지. 먼저 누른 분부터, 내 것 표시, 켜고 끄기', () => {
  assert.deepEqual(B.reactionsFor('meet').map(r => r[0]), ['hand']);
  assert.deepEqual(B.reactionsFor('news').map(r => r[0]), ['like', 'heart', 'party', 'lol', 'sad', 'ribbon']);
  assert.deepEqual(B.reactionsFor(undefined).map(r => r[0]), ['like', 'heart', 'party', 'lol', 'sad', 'ribbon']); // 말머리 없는 예전 글
  const list = [
    { uid: 'b', name: '김철수', kinds: ['like', 'heart'], at: 20 },
    { uid: 'a', name: '홍길동', kinds: ['like', 'hand'], at: 10 },
  ];
  const t = B.tallyReactions(list, 'news', 'b');
  assert.deepEqual(t.find(x => x.key === 'like'), { key: 'like', emoji: '👍', label: '따봉', names: ['홍길동', '김철수'], mine: true });
  assert.deepEqual(t.find(x => x.key === 'heart').names, ['김철수']);
  assert.equal(t.find(x => x.key === 'sad').names.length, 0);
  assert.equal(t.some(x => x.key === 'hand'), false); // 번개가 아니면 손들기는 안 보임
  assert.deepEqual(B.tallyReactions(list, 'meet', 'b').map(x => [x.key, x.names, x.mine]), [['hand', ['홍길동'], false]]);
  assert.deepEqual(B.toggleKind(['like'], 'heart'), ['like', 'heart']);
  assert.deepEqual(B.toggleKind(['like', 'heart'], 'like'), ['heart']);
});
