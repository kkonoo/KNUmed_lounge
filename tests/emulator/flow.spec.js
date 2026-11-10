'use strict';
// 화면 흐름 검사: 실제 Firebase SDK + 에뮬레이터 + Chromium으로 사이트를 눌러 봄
//   처음 설정 → 명단 65분 붙여 넣기 → 가입 코드로 가입(틀린 코드 먼저) → 친목회 올리기 → 참석 체크·한 번 더 눌러 취소
//   → 홈 한 줄 → 자유 게시판(글·새 글·댓글·고치기·지우기) → PIN 바꾸기·다시 로그인 → 멈춘 계정 막힘 → 한 분 더하기
// 실행: tests/emulator 에서 npm test. 이름·메일은 모두 가짜
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, resetEmulators, closeEmulators, person, seed } = require('./harness');
const { doc, setDoc, Timestamp } = require('firebase/firestore');

const CODE = 'abc234';
const ADMIN = { name: '홍길동', dept: '가짜학교실', email: 'hong@example.com', pin: '1234' };
const PROF = { name: '김철수', email: 'kim@example.com', pin: '0000' };

// 기초친목회 메일 받는 사람 칸처럼 65분 (관리자·김철수 포함). 이름북(data/people.json)의 실제 이름과는 겹치지 않게
const BOOK_NAMES = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/people.json'), 'utf8')).people.map(p => p.name));
function fakeRosterText() {
  const fam = '김이박최정강조윤장임한오서신권황안송류전', given = ['민수', '영희', '지훈', '서연', '도윤', '하은', '준호', '수아', '태민', '유진'];
  const names = [ADMIN.name, PROF.name];
  for (const f of fam) for (const g of given) if (names.length < 65 && !names.includes(f + g) && !BOOK_NAMES.has(f + g)) names.push(f + g);
  return names.map((n, i) => {
    const email = n === ADMIN.name ? ADMIN.email : n === PROF.name ? PROF.email : `prof${String(i).padStart(2, '0')}@example.com`;
    return `${n} 교수님 <${email}>`;
  }).join(', ');
}
const inDays = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); };

let site, browser, admin, prof, guest;
before(async () => {
  await resetEmulators();
  site = await serve();
  browser = await chromium.launch();
  admin = await person(browser);
  prof = await person(browser);
  guest = await person(browser); // 로그인 안 한 사람
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

  await t.test('명단을 넣으면 프로필이 저절로 생기고, 붙여 넣기 칸은 사라짐', async () => {
    assert.equal(await A.locator('details.paste summary', { hasText: '명단 붙여 넣기' }).count(), 0);
    await A.locator('details.roster-list summary', { hasText: '교수님 65분' }).click();
    await A.locator('.r-row', { hasText: PROF.email }).waitFor();
    assert.equal(await A.locator('.r-row', { hasText: '프로필 없음' }).count(), 0);
    await guest.page.goto(`${site.url}people/`);
    await guest.page.locator('.prof', { hasText: PROF.name }).waitFor(); // 연구실 둘러보기에 이름·교실로
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
    assert.equal(await P.locator('#myProfileBtn').count(), 0); // 친목회 화면엔 '내 프로필' 없음
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

  await t.test('식당 메뉴 미리 고르기: 관리자가 메뉴를 넣고 켜면 참석 체크 때 하나', async () => {
    await A.locator('.ev').getByRole('button', { name: '고치기' }).click();
    await A.getByLabel('식당 메뉴', { exact: true }).fill('김치찌개\n된장찌개');
    await A.getByLabel('참석 체크 때 식당 메뉴를 하나씩 미리 고르기').check();
    await A.locator('dialog').getByRole('button', { name: '저장' }).click();
    await toast(A, '고쳤어요');
    const pick = P.locator('.ev-meal').getByRole('button', { name: '된장찌개' });
    await pick.click();
    await P.locator('.ev-meals .t-row', { hasText: '된장찌개 1' }).getByText(PROF.name).waitFor();
    await A.locator('.ev-meals .t-row', { hasText: '된장찌개 1' }).waitFor(); // 관리자 화면에도 바로
    await pick.click(); // 한 번 더 누르면 풀림
    await P.locator('.ev-meals .t-row', { hasText: '된장찌개 0' }).waitFor();
  });

  await t.test('주문판: 카페 메뉴를 적고, 두 폰에서 ＋ 하면 같이 쌓임', async () => {
    await P.locator('.ev-orders').getByRole('link', { name: '카페 주문' }).click();
    await P.getByRole('heading', { name: '카페 주문' }).waitFor();
    await P.getByLabel('메뉴').fill('아메리카노 HOT/ICE\n자몽에이드');
    await P.getByRole('button', { name: '주문 받기 시작' }).click();
    await P.getByRole('button', { name: '아이스 아메리카노 하나 추가' }).click();
    await P.getByText('모두 1잔').waitFor();
    await A.goto(P.url());
    await A.getByText('모두 1잔').waitFor();
    await A.getByRole('button', { name: '자몽에이드 하나 추가' }).click();
    await P.getByText('모두 2잔').waitFor(); // 다른 폰에서 누른 것도 바로
    await P.getByRole('button', { name: '아이스 아메리카노 하나 취소' }).click();
    await P.getByText('모두 1잔').waitFor();
    await P.getByPlaceholder('메뉴에 없는 것 주문하기').fill('밀크티');
    await P.getByRole('button', { name: '＋ 넣기' }).click();
    await P.getByText('모두 2잔').waitFor();
    await P.getByRole('button', { name: '식당 주문' }).click(); // 판 바꾸기
    await P.getByRole('heading', { name: '식당 주문' }).waitFor();
    await P.getByRole('button', { name: '김치찌개 하나 추가' }).click(); // 관리자가 친목회에 넣어 둔 메뉴로 바로
    await P.getByText('모두 1개').waitFor();
    await P.goto(`${site.url}events/`);
  });

  await t.test('홈: 다음 친목회 한 줄에 내 체크', async () => {
    await P.goto(site.url);
    await P.locator('#nextEvent:not([hidden])', { hasText: '미정' }).waitFor();
    assert.equal(await P.locator('.topbar #myProfileBtn').getAttribute('href'), `${site.url}people/me/`); // 계정 단추 옆 '내 프로필' (대문·연구실 둘러보기에만)
  });

  await t.test('내 프로필: 고치고 저장하면 연구실 둘러보기에 보임, 로그인 칸은 교수님만', async () => {
    const G = guest.page;
    await G.goto(`${site.url}people/`);
    await G.getByPlaceholder('이름·교실·키워드로 찾기').fill(PROF.name);
    await G.locator('a.prof', { hasText: PROF.name }).getByText('아직 소개를 준비하고 있어요').waitFor(); // 이름·교실만
    await P.goto(`${site.url}login/`);
    await P.locator('main').getByRole('link', { name: '내 프로필' }).click();
    await P.waitForURL(/\/people\/me\/$/);
    await P.getByText('아직 확인 전이에요').waitFor();
    await P.getByLabel('직위').fill('부교수');
    await P.getByLabel('한 줄 소개').fill('가짜 세포가 늙는 원리를 연구해요');
    await P.getByLabel('키워드').fill('노화, 가짜 RNA');
    await P.getByRole('button', { name: /감염·미생물/ }).click();
    const open = title => P.locator('details.me-sec > summary', { hasText: title }).click(); // 처음엔 '소개'만 펼쳐져 있음
    assert.equal(await P.getByPlaceholder('축 이름').first().isVisible(), false);
    await open('연구 축');
    await P.getByPlaceholder('축 이름').first().fill('가짜 노화 축');
    await P.getByPlaceholder('이 축에서 묻는 것 한 문장').first().fill('노화는 어떻게 시작될까요');
    await P.getByPlaceholder(/대표 논문/).first().fill('예시 2024 https://example.com/p1');
    await open('연구 발자취');
    await P.getByPlaceholder('2016–2020').first().fill('2016–2020');
    await P.getByPlaceholder('그때 한 일 한 줄').first().fill('가짜 모델 확립');
    await open('보유 자원');
    await P.getByLabel('장비').fill('가짜 공초점 현미경');
    await P.locator('details.me-sec > summary', { hasText: '보유 자원' }).getByText('1/5칸').waitFor(); // 접어도 채운 칸 수가 보임
    await open('로그인한 교수님만');
    await P.getByLabel('찾는 것').fill('가짜 환자 PBMC');
    await P.getByLabel('연락처·담당자').fill('연구실 내선 0000');
    await P.getByRole('button', { name: '확인하고 저장' }).click();
    await toast(P, '저장했어요');
    await P.getByText(/마지막 확인 /).waitFor();

    await G.reload();
    await G.getByPlaceholder('이름·교실·키워드로 찾기').fill('공초점'); // 보유 자원으로도 찾음
    const card = G.locator('a.prof', { hasText: PROF.name });
    await card.getByText('가짜 세포가 늙는 원리를 연구해요').waitFor();
    await card.click();
    await G.getByRole('heading', { name: /김철수/ }).waitFor();
    await G.locator('.axis', { hasText: '가짜 노화 축' }).getByRole('link', { name: '예시 2024' }).waitFor();
    await G.locator('.d-sec', { hasText: '연구 발자취' }).getByText('가짜 모델 확립').waitFor();
    await G.locator('.d-sec', { hasText: '보유 자원' }).getByText('가짜 공초점 현미경').waitFor();
    await G.locator('.d-private').getByText('로그인한 교수님만 봐요').waitFor();
    assert.equal(await G.getByText('가짜 환자 PBMC').count(), 0); // 로그인 칸은 안 보임
    await G.locator('.topbar a.icon-btn').click(); // 목록으로
    await G.locator('a.prof').first().waitFor();

    await P.getByRole('link', { name: '연구실 둘러보기에서 보기' }).click();
    await P.locator('.d-private').getByText('가짜 환자 PBMC').waitFor();
    await P.getByRole('link', { name: '내 프로필 고치기' }).waitFor();
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
    await A.locator('.post-item', { hasText: '원심분리기 나눠요' }).locator('.badge.cat', { hasText: '기타' }).waitFor(); // 말머리는 처음에 기타
    const chips = A.locator('.board-cats');
    await chips.getByRole('button', { name: '번개' }).click();
    await A.waitForURL(/#cat=meet$/);
    await A.getByText('아직 번개 글이 없어요.').waitFor();
    await chips.getByRole('button', { name: '기타' }).click();
    await A.locator('.post-item', { hasText: '원심분리기 나눠요' }).waitFor();
    await chips.getByRole('button', { name: '기타' }).click(); // 한 번 더 누르면 전체
    await chips.getByRole('button', { name: '전체', pressed: true }).waitFor();
    await A.locator('.post-item', { hasText: '원심분리기 나눠요' }).click();
    await A.getByLabel('댓글').fill('저요');
    await A.getByRole('button', { name: '달기' }).click();
    await P.locator('.comment-list li', { hasText: '저요' }).getByText(ADMIN.name).waitFor(); // 글쓴이 화면에 바로 보임
    await P.getByRole('heading', { name: '댓글 1' }).waitFor();
    await A.locator('.topbar a.icon-btn').click(); // 목록으로
    await A.locator('.post-item .pi-count', { hasText: '1' }).waitFor();
    await A.goto(site.url);
    await A.locator('.door[href="board/"]').waitFor();
    assert.equal(await A.locator('#boardFoot').innerText(), ''); // 이미 봤으니 새 글 없음 (꼬리표 없이 빈 칸)

    await P.getByRole('button', { name: '고치기' }).click();
    await P.getByLabel('제목').fill('원심분리기 나눠요 (끝)');
    await P.locator('dialog .seg').getByRole('button', { name: '소식' }).click();
    await P.getByRole('button', { name: '저장' }).click();
    await toast(P, '고쳤어요');
    await P.getByRole('heading', { name: '원심분리기 나눠요 (끝)' }).waitFor();
    await P.locator('.post h2 .badge.cat', { hasText: '소식' }).waitFor();
    await P.locator('.post-meta', { hasText: '고침' }).waitFor();
    await P.locator('.post .form-actions').getByRole('button', { name: '지우기' }).click();
    await toast(P, '지웠어요');
    await P.getByText('아직 글이 없어요').waitFor(); // 남의 댓글이 있어도 글쓴이가 글째 지움
  });

  await t.test('게시판 공지와 페이지: 25개면 2페이지, 관리자가 공지로 올리면 맨 위', async () => {
    await seed(async db => {
      for (let i = 1; i <= 25; i++) await setDoc(doc(db, 'posts', `seed${String(i).padStart(2, '0')}`), { title: `가짜 글 ${i}`, body: '내용', by: 'x', name: '가짜', at: Timestamp.fromMillis(Date.now() - (30 - i) * 60e3), editedAt: null });
    });
    await A.goto(`${site.url}board/`);
    await A.locator('.post-item', { hasText: '가짜 글 25' }).waitFor(); // 새것부터
    assert.equal(await A.locator('.post-list:not(.pinned) .post-item').count(), 20);
    await A.locator('.pager').getByRole('button', { name: '2', exact: true }).click();
    await A.waitForURL(/#page=2$/);
    await A.locator('.post-item', { hasText: '가짜 글 5' }).waitFor();
    assert.equal(await A.locator('.post-list:not(.pinned) .post-item').count(), 5);
    await A.locator('.post-item', { hasText: '가짜 글 3' }).click();
    await A.getByRole('button', { name: '공지로 올리기' }).click();
    await toast(A, '공지로 올렸어요');
    await A.locator('.topbar a.icon-btn').click(); // 목록으로 → 2페이지 그대로
    await A.waitForURL(/#page=2$/);
    await A.locator('.post-list.pinned .post-item', { hasText: '가짜 글 3' }).getByText('공지').waitFor();
    assert.equal(await A.locator('.post-list:not(.pinned) .post-item').count(), 4); // 공지는 페이지에서 빠짐
    await A.evaluate(() => { location.hash = 'cat=etc'; }); // 말머리 전에 쓴 글은 전체에서만, 공지는 늘 맨 위
    await A.getByText('아직 기타 글이 없어요.').waitFor();
    await A.locator('.post-list.pinned .post-item', { hasText: '가짜 글 3' }).waitFor();
    await P.goto(`${site.url}board/`);
    await P.locator('.post-list.pinned .post-item', { hasText: '가짜 글 3' }).waitFor(); // 교수님 화면에도 맨 위
    assert.equal(await P.getByRole('button', { name: '공지로 올리기' }).count(), 0);
  });

  await t.test('공동연구 찾기: 질문을 보내면 고른 분·근거·첫 질문이 보이고, 이름은 프로필로', async () => {
    // Worker는 가짜로 (실제 Worker·Anthropic에는 안 감). 보낸 질문만 확인
    const sent = [];
    await P.context().route(/workers\.dev\//, async r => {
      const u = new URL(r.request().url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (u.pathname === '/status') return r.fulfill({ headers: cors, json: { ai: true, used: 2, limit: 20 } });
      sent.push(r.request().postDataJSON());
      return r.fulfill({ headers: cors, json: { picks: [{ id: 'abc234', name: '나가짜', dept: '가짜학교실', photo: '', fields: ['보유 자원'], why: '보유 자원에 마우스 호중구 분리가 있어요', ask: '호중구 분리 방법을 여쭤봐도 될까요?' }], note: '' } });
    });
    await P.goto(`${site.url}ask/`);
    await P.getByText('오늘 2/20번 썼어요').waitFor();
    await P.getByRole('button', { name: '찾아 보기' }).click();
    await P.getByText('무엇을 찾는지 적어 주세요').waitFor(); // 빈 질문은 안 보냄
    await P.getByLabel('찾는 것').fill('마우스 호중구 분리');
    await P.getByRole('button', { name: '찾아 보기' }).click();
    await P.locator('.ask-pick', { hasText: '나가짜' }).getByText('근거: 보유 자원').waitFor();
    await P.getByText('호중구 분리 방법을 여쭤봐도 될까요?').waitFor();
    await P.getByText('오늘 3/20번 썼어요').waitFor();
    assert.deepEqual(sent, [{ q: '마우스 호중구 분리' }]);
    assert.equal(await P.locator('.ask-who').getAttribute('href'), `${site.url}people/#p=abc234`);
    await P.context().unroute(/workers\.dev\//);
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

  await t.test('관리자 PIN 초기화: 0000으로 바뀌고 0000으로 들어감', async () => {
    // Worker는 가짜로: 받은 메일의 로그인 계정 비밀번호를 Auth 에뮬레이터에서 바꿈 (실제 Worker 코드는 tests/worker.test.js가 확인)
    const { pinToPassword } = require('../load')('js/account-core.js');
    const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-lounge/accounts';
    const admin = (what, body) => fetch(`${AUTH}:${what}`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    const sent = [];
    await A.context().route(/workers\.dev\//, async r => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      const { email } = r.request().postDataJSON();
      sent.push([new URL(r.request().url()).pathname, email]);
      const uid = (await admin('lookup', { email: [email] })).users[0].localId;
      await admin('update', { localId: uid, password: pinToPassword('0000') });
      return r.fulfill({ headers: cors, json: { pin: '0000' } });
    });
    await A.goto(`${site.url}admin/`);
    await A.getByPlaceholder('이름·메일·교실로 찾기').fill(PROF.name);
    await A.locator('.r-row', { hasText: PROF.email }).getByRole('button', { name: 'PIN 초기화' }).click();
    await toast(A, `${PROF.name} 교수님 PIN을 0000으로 바꿨어요`);
    assert.deepEqual(sent, [['/admin/pin-reset', PROF.email]]);
    await A.context().unroute(/workers\.dev\//);

    await P.goto(`${site.url}login/`);
    const out = P.getByRole('button', { name: '로그아웃' }), mail = P.getByLabel('메일');
    await out.or(mail).first().waitFor();
    if (await out.isVisible()) await out.click(); // 비밀번호가 바뀌면 그 기기 로그인이 먼저 풀리기도 해요 (Firebase가 정하는 때)
    await mail.fill(PROF.email);
    await P.getByLabel('PIN').fill('9876'); // 바꾸기 전 PIN은 이제 안 됨
    await P.getByRole('button', { name: '들어가기' }).click();
    await P.getByText('메일 주소나 PIN이 맞지 않아요').waitFor();
    await P.getByLabel('PIN').fill('0000');
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
    await guest.page.goto(`${site.url}people/#q=${encodeURIComponent(PROF.name)}`); // 연구실 둘러보기에서도 숨김
    await guest.page.reload(); // # 뒤만 바뀌면 새로 읽지 않으니까
    await guest.page.getByText('맞는 분이 없어요').waitFor();
  });

  await t.test('교수님 한 분 더하기: 명단에 들어가고 프로필도 저절로', async () => {
    const box = A.locator('details', { hasText: '교수님 한 분 더하기' });
    await box.locator('summary').click();
    await box.getByLabel('이름').fill('나예시');
    await box.getByLabel('메일').fill('Na@Example.com');
    await box.getByLabel('교실').fill('가짜학교실');
    await box.getByRole('button', { name: '더하기' }).click();
    await toast(A, '나예시 교수님을 더했어요');
    await A.locator('.summary', { hasText: /명단\s*66/ }).waitFor();
    await box.locator('summary').click(); // 다시 그려져 접혀 있음
    await box.getByLabel('이름').fill('나예시'); // 같은 메일은 다시 못 넣음
    await box.getByLabel('메일').fill('na@example.com');
    await box.getByRole('button', { name: '더하기' }).click();
    await box.getByText('이미 명단에 있는 메일이에요').waitFor();
    await guest.page.goto(`${site.url}people/#q=${encodeURIComponent('나예시')}`);
    await guest.page.reload();
    await guest.page.locator('.prof', { hasText: '가짜학교실' }).waitFor();
  });

  assert.deepEqual([...admin.errors, ...prof.errors, ...guest.errors], []);
});
