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
