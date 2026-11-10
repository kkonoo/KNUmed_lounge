'use strict';
// 화면 흐름 검사: 실제 Firebase SDK + 에뮬레이터 + Chromium으로 사이트를 눌러 봄
//   처음 설정 → 명단 65분 붙여 넣기 → 가입 코드로 가입(틀린 코드 먼저) → 친목회 올리기 → 참석 체크·한 번 더 눌러 취소
//   → 홈 한 줄 → 자유 게시판(글·새 글·댓글·고치기·지우기) → PIN 바꾸기·다시 로그인 → 멈춘 계정 막힘
// 실행: tests/emulator 에서 npm test. 이름·메일은 모두 가짜
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, resetEmulators, closeEmulators, person } = require('./harness');

const CODE = 'abc234';
const ADMIN = { name: '홍길동', dept: '가짜학교실', email: 'hong@example.com', pin: '1234' };
const PROF = { name: '김철수', email: 'kim@example.com', pin: '0000' };

// 기초친목회 메일 받는 사람 칸처럼 65분 (관리자·김철수 포함)
function fakeRosterText() {
  const fam = '김이박최정강조윤장임한오서신권황안송류전', given = ['민수', '영희', '지훈', '서연', '도윤', '하은', '준호', '수아', '태민', '유진'];
  const names = [ADMIN.name, PROF.name];
  for (const f of fam) for (const g of given) if (names.length < 65 && !names.includes(f + g)) names.push(f + g);
  return names.map((n, i) => {
    const email = n === ADMIN.name ? ADMIN.email : n === PROF.name ? PROF.email : `prof${String(i).padStart(2, '0')}@example.com`;
    return `${n} 교수님 <${email}>`;
  }).join(', ');
}
const inDays = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); };

let site, browser, admin, prof;
before(async () => {
  await resetEmulators();
  site = await serve();
  browser = await chromium.launch();
  admin = await person(browser);
  prof = await person(browser);
});
after(async () => {
  await browser?.close();
  site?.close();
  await closeEmulators();
});

const toast = (p, text) => p.locator('#toast.show', { hasText: text }).waitFor({ timeout: 15000 });

test('처음 설정 → 명단 → 가입 → 친목회 참석 체크', async t => {
  const A = admin.page, P = prof.page;

  await t.test('처음 설정: 첫 관리자가 됨', async () => {
    await A.goto(`${site.url}admin/`);
    await A.getByRole('heading', { name: '처음 설정' }).waitFor();
    await A.getByLabel('이름', { exact: true }).fill(ADMIN.name);
    await A.getByLabel('교실', { exact: true }).fill(ADMIN.dept);
    await A.getByLabel('메일', { exact: true }).fill(ADMIN.email);
    await A.getByLabel('PIN 정하기').fill(ADMIN.pin);
    await A.getByLabel('가입 코드').fill(CODE);
    await A.getByRole('button', { name: '첫 관리자로 시작하기' }).click();
    await toast(A, '첫 관리자가 됐어요');
    await A.locator('details.paste[open]').waitFor();
  });

  await t.test('명단 65분 붙여 넣기', async () => {
    await A.getByLabel('붙여 넣기').fill(fakeRosterText());
    await A.getByText('65분을 읽었어요 (새로 64 · 이미 있음 1)').waitFor();
    await A.getByRole('button', { name: '65분 명단에 넣기' }).click();
    await toast(A, '새로 64분, 고침 0분');
    await A.locator('.summary', { hasText: /명단\s*65\s*가입\s*1\s*아직\s*64/ }).waitFor(); // 알림 뒤 다시 읽어 그림
  });

  await t.test('가입: 틀린 코드는 막히고, 맞는 코드로 다시 하면 됨', async () => {
    await P.goto(`${site.url}events/`);
    await P.waitForURL(/\/login\/\?next=/);
    await P.getByRole('button', { name: '처음 가입' }).click();
    await P.getByLabel('메일').fill(PROF.email);
    await P.getByLabel('가입 코드').fill('wrong9');
    await P.getByLabel('PIN 정하기').fill(PROF.pin);
    await P.getByRole('button', { name: '가입하고 들어가기' }).click();
    await P.getByText('가입 코드가 맞지 않아요').waitFor();
    await P.getByLabel('가입 코드').fill(` ${CODE.toUpperCase()} `); // 공지 메일에서 옮기다 대문자·띄어쓰기가 섞여도 됨
    await P.getByRole('button', { name: '가입하고 들어가기' }).click();
    await P.waitForURL(/\/events\/$/);
    await P.getByText('다음 친목회가 아직 안 올라왔어요').waitFor();
  });

  await t.test('관리자가 친목회를 올림', async () => {
    await A.goto(`${site.url}events/`);
    await A.getByRole('button', { name: '새 친목회' }).click();
    await A.getByLabel('날짜').fill(inDays(14));
    await A.getByLabel('장소').fill('가짜 식당');
    await A.getByRole('button', { name: '올리기' }).click();
    await toast(A, '올렸어요');
    await A.locator('.ev h2').waitFor();
  });

  await t.test('참석 체크: 고르고, 한 번 더 누르면 취소, 한마디와 함께 미정', async () => {
    const row = label => P.locator('.t-row b', { hasText: new RegExp(`^${label} \\d+$`) });
    const yes = P.getByRole('button', { name: '🙋 참석', exact: true });
    await yes.waitFor(); // 화면을 새로 고치지 않아도 올라온 친목회가 보임
    await yes.click();
    await toast(P, '체크했어요');
    await P.locator('.t-row', { hasText: '참석 1' }).getByText(PROF.name).waitFor();
    assert.equal(await yes.getAttribute('aria-pressed'), 'true');
    await yes.click();
    await toast(P, '체크를 취소했어요');
    await row('참석').filter({ hasText: '참석 0' }).waitFor();
    assert.equal(await yes.getAttribute('aria-pressed'), 'false');
    await P.getByPlaceholder('한마디').fill('30분 늦어요');
    await P.getByRole('button', { name: '🤔 미정', exact: true }).click();
    await P.locator('.t-row', { hasText: '미정 1' }).getByText('(30분 늦어요)').waitFor();
    await A.locator('.t-row.yet b', { hasText: '아직 64' }).waitFor(); // 관리자 화면: 김철수가 빠짐
  });

  await t.test('홈: 다음 친목회 한 줄에 내 체크', async () => {
    await P.goto(site.url);
    await P.locator('#nextEvent:not([hidden])', { hasText: '미정' }).waitFor();
  });

  await t.test('자유 게시판: 글쓰기 → 홈 새 글 → 댓글 → 고치기 → 지우기', async () => {
    await P.goto(`${site.url}board/`);
    await P.getByText('아직 글이 없어요').waitFor();
    await P.getByRole('button', { name: '글쓰기' }).click();
    await P.getByLabel('제목').fill('원심분리기 나눠요');
    await P.getByLabel('내용').fill('필요하신 분 연락 주세요\n사진: https://example.com/photo.');
    await P.getByRole('button', { name: '올리기' }).click();
    await toast(P, '올렸어요');
    await P.getByRole('heading', { name: '원심분리기 나눠요' }).waitFor();
    assert.equal(await P.locator('.post-body a').getAttribute('href'), 'https://example.com/photo');
    assert.match(await P.locator('.post-meta').innerText(), new RegExp(`^${PROF.name} · `));

    await A.goto(site.url);
    await A.locator('#boardFoot', { hasText: '새 글 1' }).waitFor();
    await A.goto(`${site.url}board/`);
    await A.locator('.post-item', { hasText: '원심분리기 나눠요' }).locator('.badge.new').waitFor();
    await A.locator('.post-item', { hasText: '원심분리기 나눠요' }).click();
    await A.getByLabel('댓글').fill('저요');
    await A.getByRole('button', { name: '달기' }).click();
    await P.locator('.comment-list li', { hasText: '저요' }).getByText(ADMIN.name).waitFor(); // 글쓴이 화면에 바로 보임
    await P.getByRole('heading', { name: '댓글 1' }).waitFor();
    await A.locator('.topbar a.icon-btn').click(); // 목록으로
    await A.locator('.post-item .pi-count', { hasText: '1' }).waitFor();
    await A.goto(site.url);
    await A.locator('.door[href="board/"]').waitFor();
    assert.equal(await A.locator('#boardFoot').innerText(), '로그인'); // 이미 봤으니 새 글 없음

    await P.getByRole('button', { name: '고치기' }).click();
    await P.getByLabel('제목').fill('원심분리기 나눠요 (끝)');
    await P.getByRole('button', { name: '저장' }).click();
    await toast(P, '고쳤어요');
    await P.getByRole('heading', { name: '원심분리기 나눠요 (끝)' }).waitFor();
    await P.locator('.post-meta', { hasText: '고침' }).waitFor();
    await P.locator('.post .form-actions').getByRole('button', { name: '지우기' }).click();
    await toast(P, '지웠어요');
    await P.getByText('아직 글이 없어요').waitFor(); // 남의 댓글이 있어도 글쓴이가 글째 지움
  });

  await t.test('PIN 바꾸기 → 로그아웃 → 새 PIN으로 로그인', async () => {
    await P.goto(`${site.url}login/`);
    await P.getByText(`${PROF.name} 교수님`).waitFor();
    await P.getByRole('button', { name: 'PIN 바꾸기' }).click();
    await P.getByLabel('지금 PIN').fill(PROF.pin);
    await P.getByLabel('새 PIN').fill('9876');
    await P.locator('form button[type=submit]', { hasText: 'PIN 바꾸기' }).click();
    await P.getByText('PIN을 바꿨어요').waitFor();
    await P.getByRole('button', { name: '로그아웃' }).click();
    await P.getByLabel('메일').fill(PROF.email);
    await P.getByLabel('PIN').fill(PROF.pin);
    await P.getByRole('button', { name: '들어가기' }).click();
    await P.getByText('메일 주소나 PIN이 맞지 않아요').waitFor();
    await P.getByLabel('PIN').fill('9876');
    await P.getByRole('button', { name: '들어가기' }).click();
    await P.waitForURL(site.url);
  });

  await t.test('멈춘 계정은 친목회를 못 봄', async () => {
    await A.goto(`${site.url}admin/`);
    await A.getByPlaceholder('이름·메일·교실로 찾기').fill(PROF.name);
    await A.locator('.r-row', { hasText: PROF.email }).getByRole('button', { name: '멈추기' }).click();
    await A.locator('.r-row', { hasText: PROF.email }).getByText('멈춤').waitFor();
    await P.goto(`${site.url}events/`);
    await P.getByText('사용이 멈춘 계정이에요').waitFor();
  });

  assert.deepEqual([...admin.errors, ...prof.errors], []);
});
