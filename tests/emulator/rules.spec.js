'use strict';
// firestore.rules 검사: Firestore 에뮬레이터에 규칙을 올리고, 화면이 하는 쓰기·읽기가 되는지(되면 안 되는 건 막히는지) 확인
// 실행: tests/emulator 에서 npm run rules (에뮬레이터를 켜고 끔). 이름·메일은 모두 가짜
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after, beforeEach } = require('node:test');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, writeBatch, query, orderBy, limit, where,
  serverTimestamp, Timestamp, increment, FieldPath,
} = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
const CODE = 'abc234';
const ADMIN = { uid: 'u-admin', email: 'hong@example.com', name: '홍길동', dept: '가짜학교실' };
const PROF = { uid: 'u-prof', email: 'kim@example.com', name: '김철수', dept: '예시학교실' };
const OTHER = { uid: 'u-other', email: 'lee@example.com', name: '이영희', dept: '예시학교실' };
const STRANGER = { uid: 'u-stranger', email: 'nobody@example.com' }; // 명단에 없는 사람

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-lounge', firestore: { rules: RULES, host: '127.0.0.1', port: 8080 } });
});
after(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

const as = u => env.authenticatedContext(u.uid, { email: u.email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seed = fn => env.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
const now = () => Timestamp.now();
const rosterDoc = (u, extra = {}) => ({ name: u.name, dept: u.dept, group: '기초', status: 'active', at: now(), ...extra });
const memberDoc = (u, extra = {}) => ({ email: u.email, name: u.name, dept: u.dept, group: '기초', active: true, at: now(), ...extra });

// 처음 설정이 끝나고 명단에 세 분이 있는 상태. member: 가입까지 마친 분
async function base({ members = [ADMIN, PROF] } = {}) {
  await seed(async db => {
    await setDoc(doc(db, 'config/admins'), { uids: [ADMIN.uid] });
    await setDoc(doc(db, 'config/signup'), { code: CODE });
    for (const u of [ADMIN, PROF, OTHER]) await setDoc(doc(db, 'roster', u.email), rosterDoc(u));
    for (const u of members) await setDoc(doc(db, 'members', u.uid), memberDoc(u));
  });
}
const eventData = (extra = {}) => ({
  title: '12월 기초친목회', date: '2026-12-02', time: '18:30', place: '가짜 식당', mapUrl: '', deadline: null, note: '',
  audience: '기초', closed: false, at: now(), by: ADMIN.uid, ...extra,
});
async function withEvent(extra) {
  await base();
  await seed(db => setDoc(doc(db, 'events/e1'), eventData(extra)));
}
const rsvp = (u, extra = {}) => ({ status: 'yes', name: u.name, comment: '', at: serverTimestamp(), ...extra });

// ---------- 처음 설정 ----------
test('처음 설정: 관리자가 없으면 로그인한 사람이 자기 하나만 넣어 첫 관리자가 됨 (admin-db.js setup 순서 그대로)', async () => {
  const db = as(ADMIN);
  await assertSucceeds(getDoc(doc(anon(), 'config/admins')));
  await assertSucceeds(setDoc(doc(db, 'config/admins'), { uids: [ADMIN.uid] }));
  const b = writeBatch(db), t = serverTimestamp();
  b.set(doc(db, 'config/signup'), { code: CODE });
  b.set(doc(db, 'roster', ADMIN.email), { name: ADMIN.name, dept: ADMIN.dept, group: '기초', status: 'active', at: t });
  b.set(doc(db, 'members', ADMIN.uid), { email: ADMIN.email, name: ADMIN.name, dept: ADMIN.dept, group: '기초', active: true, at: t });
  await assertSucceeds(b.commit());
  await assertSucceeds(addDoc(collection(db, 'adminLog'), { at: serverTimestamp(), by: ADMIN.uid, byName: ADMIN.name, action: '처음 설정', target: ADMIN.email }));
});

test('처음 설정: 남을 넣거나 두 명을 넣을 수 없고, 이미 있으면 다른 사람이 다시 못 함', async () => {
  await assertFails(setDoc(doc(as(PROF), 'config/admins'), { uids: [ADMIN.uid] }));
  await assertFails(setDoc(doc(as(PROF), 'config/admins'), { uids: [PROF.uid, ADMIN.uid] }));
  await assertFails(setDoc(doc(anon(), 'config/admins'), { uids: ['x'] }));
  await base();
  await assertFails(setDoc(doc(as(PROF), 'config/admins'), { uids: [PROF.uid] }));
});

// ---------- 관리자 ----------
test('관리자 지정·해제: 관리자만, 마지막 한 분은 못 뺌', async () => {
  await base();
  await assertFails(setDoc(doc(as(PROF), 'config/admins'), { uids: [ADMIN.uid, PROF.uid] }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'config/admins'), { uids: [ADMIN.uid, PROF.uid] }));
  await assertSucceeds(setDoc(doc(as(PROF), 'config/admins'), { uids: [PROF.uid] }));
  await assertFails(setDoc(doc(as(PROF), 'config/admins'), { uids: [] }));
  await assertFails(deleteDoc(doc(as(PROF), 'config/admins')));
});

test('가입 코드: 관리자만 읽고 바꿈, 모양이 틀리면 막힘', async () => {
  await base();
  await assertFails(getDoc(doc(as(PROF), 'config/signup')));
  await assertFails(getDoc(doc(anon(), 'config/signup')));
  await assertSucceeds(getDoc(doc(as(ADMIN), 'config/signup')));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'config/signup'), { code: '새코드22' }));
  await assertFails(setDoc(doc(as(ADMIN), 'config/signup'), { code: 'A' }));
  await assertFails(setDoc(doc(as(PROF), 'config/signup'), { code: 'mine22' }));
});

// ---------- 명단 ----------
test('명단: 관리자만 목록을 읽고, 본인은 자기 메일 한 줄만', async () => {
  await base();
  await assertSucceeds(getDocs(collection(as(ADMIN), 'roster')));
  await assertFails(getDocs(collection(as(PROF), 'roster')));
  await assertSucceeds(getDoc(doc(as(STRANGER), 'roster', STRANGER.email)));
  await assertSucceeds(getDoc(doc(as(PROF), 'roster', PROF.email)));
  await assertFails(getDoc(doc(as(PROF), 'roster', OTHER.email)));
  await assertFails(getDoc(doc(anon(), 'roster', PROF.email)));
});

test('명단 넣기·고치기·멈추기·지우기 (admin-db.js가 쓰는 모양)', async () => {
  await base();
  const db = as(ADMIN);
  const b = writeBatch(db);
  b.set(doc(db, 'roster', 'park@example.com'), { name: '박가짜', dept: '', group: '기초', status: 'active', at: serverTimestamp() });
  b.update(doc(db, 'roster', OTHER.email), { name: '이영희', dept: '새교실', at: serverTimestamp() });
  await assertSucceeds(b.commit());
  const e = writeBatch(db);
  e.update(doc(db, 'roster', PROF.email), { name: '김철수', dept: '바뀐교실', group: '기초', at: serverTimestamp() });
  e.update(doc(db, 'members', PROF.uid), { name: '김철수', dept: '바뀐교실', group: '기초' });
  await assertSucceeds(e.commit());
  const s = writeBatch(db);
  s.update(doc(db, 'roster', PROF.email), { status: 'inactive', at: serverTimestamp() });
  s.update(doc(db, 'members', PROF.uid), { active: false });
  await assertSucceeds(s.commit());
  const d = writeBatch(db);
  d.delete(doc(db, 'roster', PROF.email));
  d.delete(doc(db, 'members', PROF.uid));
  await assertSucceeds(d.commit());
});

test('명단: 회원은 못 쓰고, 대문자 메일·이상한 구분·빈 이름은 막힘', async () => {
  await base();
  await assertFails(setDoc(doc(as(PROF), 'roster', 'x@example.com'), rosterDoc({ name: '가짜', dept: '' })));
  await assertFails(setDoc(doc(as(ADMIN), 'roster', 'Up@example.com'), rosterDoc({ name: '가짜', dept: '' })));
  await assertFails(setDoc(doc(as(ADMIN), 'roster', 'x@example.com'), rosterDoc({ name: '가짜', dept: '' }, { group: '외부' })));
  await assertFails(setDoc(doc(as(ADMIN), 'roster', 'x@example.com'), rosterDoc({ name: '', dept: '' })));
  await assertFails(setDoc(doc(as(ADMIN), 'roster', 'x@example.com'), rosterDoc({ name: '가짜', dept: '' }, { extra: 1 })));
});

// ---------- 처음 가입 ----------
const joinDoc = (u, code = CODE, extra = {}) => ({ email: u.email, name: u.name, dept: u.dept, group: '기초', active: true, joinCode: code, at: serverTimestamp(), ...extra });

test('처음 가입: 명단에 있고 가입 코드가 맞으면 회원이 됨 (session.js join 순서 그대로)', async () => {
  await base({ members: [ADMIN] });
  const db = as(PROF);
  await assertSucceeds(getDoc(doc(db, 'members', PROF.uid)));
  await assertSucceeds(getDoc(doc(db, 'roster', PROF.email)));
  await assertSucceeds(setDoc(doc(db, 'members', PROF.uid), joinDoc(PROF)));
  await assertSucceeds(getDocs(collection(db, 'members')));
});

test('처음 가입: 코드가 틀리거나, 남의 메일·이름·교실을 쓰거나, 명단에 없거나 멈췄으면 막힘', async () => {
  await base({ members: [ADMIN] });
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF, 'wrong1')));
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF, CODE, { name: '다른이름' })));
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF, CODE, { dept: '다른교실' })));
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF, CODE, { email: OTHER.email, name: OTHER.name })));
  await assertFails(setDoc(doc(as(PROF), 'members', OTHER.uid), joinDoc(PROF)));
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF, CODE, { at: now() })));
  await assertFails(setDoc(doc(as(STRANGER), 'members', STRANGER.uid), joinDoc({ ...STRANGER, name: '가짜', dept: '' })));
  await seed(db => updateDoc(doc(db, 'roster', PROF.email), { status: 'inactive' }));
  await assertFails(setDoc(doc(as(PROF), 'members', PROF.uid), joinDoc(PROF)));
});

test('회원 문서: 가입 전에는 남의 것을 못 읽고, 본인은 고칠 수 없음 (활성 켜기 등)', async () => {
  await base({ members: [ADMIN] });
  await assertFails(getDoc(doc(as(PROF), 'members', ADMIN.uid)));
  await assertFails(getDocs(collection(as(PROF), 'members')));
  await seed(db => setDoc(doc(db, 'members', PROF.uid), memberDoc(PROF, { active: false })));
  await assertFails(updateDoc(doc(as(PROF), 'members', PROF.uid), { active: true }));
  await assertFails(getDocs(collection(as(PROF), 'members')));
  await assertFails(getDocs(collection(anon(), 'members')));
});

// ---------- 친목회 ----------
test('친목회: 관리자만 만들고 고치고 마감, 회원은 읽기만 (events-db.js 모양)', async () => {
  await base();
  const db = as(ADMIN);
  const data = { title: '1월 기초친목회', date: '2027-01-06', time: '18:30', place: '가짜 식당', mapUrl: 'https://naver.me/example', deadline: Timestamp.fromMillis(Date.now() + 864e5), note: '', audience: '기초' };
  const ref = await assertSucceeds(addDoc(collection(db, 'events'), { ...data, closed: false, at: serverTimestamp(), by: ADMIN.uid }));
  await assertSucceeds(updateDoc(ref, { ...data, title: '1월 친목회', deadline: null }));
  await assertSucceeds(updateDoc(ref, { closed: true }));
  await assertFails(addDoc(collection(as(PROF), 'events'), { ...data, closed: false, at: serverTimestamp(), by: PROF.uid }));
  await assertFails(updateDoc(doc(as(PROF), 'events', ref.id), { closed: false }));
  await assertSucceeds(getDocs(query(collection(as(PROF), 'events'), orderBy('date', 'desc'), limit(30))));
  await assertSucceeds(getDocs(query(collection(as(PROF), 'events'), where('date', '>=', '2026-01-01'), orderBy('date'), limit(5))));
  await assertFails(getDocs(collection(anon(), 'events')));
  await assertFails(getDocs(collection(as(OTHER), 'events'))); // 명단엔 있지만 가입 전
  await assertFails(addDoc(collection(db, 'events'), { ...data, mapUrl: 'javascript:alert(1)', closed: false, at: serverTimestamp(), by: ADMIN.uid }));
});

test('참석 체크: 본인 것만, 이름은 회원 이름 그대로, 한 번 더 누르면 취소(지우기)', async () => {
  await withEvent();
  const db = as(PROF);
  await assertSucceeds(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { comment: '30분 늦어요' })));
  await assertSucceeds(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { status: 'maybe' })));
  await assertSucceeds(getDocs(collection(db, 'events/e1/rsvps')));
  await assertSucceeds(deleteDoc(doc(db, 'events/e1/rsvps', PROF.uid)));
  await assertFails(setDoc(doc(db, 'events/e1/rsvps', ADMIN.uid), rsvp(PROF)));
  await assertFails(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { name: '다른이름' })));
  await assertFails(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { status: 'later' })));
  await assertFails(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { comment: 'ㄱ'.repeat(61) })));
  await assertFails(setDoc(doc(as(OTHER), 'events/e1/rsvps', OTHER.uid), rsvp(OTHER))); // 가입 전
});

test('참석 체크: 마감했거나 마감 시각이 지나면 못 바꿈 (관리자는 지울 수 있음)', async () => {
  await withEvent({ closed: true });
  await seed(db => setDoc(doc(db, 'events/e1/rsvps', PROF.uid), { status: 'yes', name: PROF.name, comment: '', at: now() }));
  await assertFails(setDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid), rsvp(PROF, { status: 'no' })));
  await assertFails(deleteDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid)));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'events/e1/rsvps', PROF.uid)));
  await seed(db => setDoc(doc(db, 'events/e1'), eventData({ deadline: Timestamp.fromMillis(Date.now() - 60e3) })));
  await assertFails(setDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid), rsvp(PROF)));
});

test('참석 체크: 대상이 아닌 모임(임상)에는 못 하고, 전체 모임에는 됨', async () => {
  await withEvent({ audience: '임상' });
  await assertFails(setDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid), rsvp(PROF)));
  await seed(db => setDoc(doc(db, 'events/e1'), eventData({ audience: '전체' })));
  await assertSucceeds(setDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid), rsvp(PROF)));
});

test('친목회 지우기: 응답을 먼저 지우고 행사 (관리자만)', async () => {
  await withEvent();
  await seed(db => setDoc(doc(db, 'events/e1/rsvps', PROF.uid), { status: 'yes', name: PROF.name, comment: '', at: now() }));
  await assertFails(deleteDoc(doc(as(PROF), 'events/e1')));
  const db = as(ADMIN);
  const rs = await getDocs(collection(db, 'events/e1/rsvps'));
  const b = writeBatch(db);
  rs.docs.forEach(d => b.delete(d.ref));
  b.delete(doc(db, 'events/e1'));
  await assertSucceeds(b.commit());
});

test('멈춘 회원은 친목회를 못 봄', async () => {
  await withEvent();
  await seed(db => updateDoc(doc(db, 'members', PROF.uid), { active: false }));
  await assertFails(getDocs(collection(as(PROF), 'events')));
  await assertFails(setDoc(doc(as(PROF), 'events/e1/rsvps', PROF.uid), rsvp(PROF)));
});

// ---------- 작업 기록 ----------
test('작업 기록: 관리자만 읽고 더하기만', async () => {
  await base();
  const db = as(ADMIN);
  const ref = await assertSucceeds(addDoc(collection(db, 'adminLog'), { at: serverTimestamp(), by: ADMIN.uid, byName: ADMIN.name, action: '명단 넣기', target: '새로 1명' }));
  await assertSucceeds(getDocs(query(collection(db, 'adminLog'), orderBy('at', 'desc'), limit(60))));
  await assertFails(updateDoc(ref, { action: '고침' }));
  await assertFails(deleteDoc(ref));
  await assertFails(addDoc(collection(db, 'adminLog'), { at: serverTimestamp(), by: PROF.uid, byName: '김철수', action: '남인 척', target: '' }));
  await assertFails(getDocs(collection(as(PROF), 'adminLog')));
  await assertFails(addDoc(collection(as(PROF), 'adminLog'), { at: serverTimestamp(), by: PROF.uid, byName: PROF.name, action: 'x', target: '' }));
});

// ---------- 자유 게시판 ----------
const post = (u, extra = {}) => ({ title: '장비 나눔', body: '원심분리기 하나 나눠요', by: u.uid, name: u.name, at: serverTimestamp(), editedAt: null, ...extra });
const comment = (u, extra = {}) => ({ body: '저요', by: u.uid, name: u.name, at: serverTimestamp(), ...extra });
async function withPost() {
  await base();
  await seed(async db => {
    await setDoc(doc(db, 'posts/p1'), { ...post(PROF), at: now() });
    await setDoc(doc(db, 'posts/p1/comments/c1'), { ...comment(ADMIN), at: now() });
  });
}

test('게시판: 회원만 읽고 씀, 이름은 회원 이름 그대로', async () => {
  await base();
  const ref = await assertSucceeds(addDoc(collection(as(PROF), 'posts'), post(PROF)));
  await assertSucceeds(getDocs(query(collection(as(ADMIN), 'posts'), orderBy('at', 'desc'), limit(30))));
  await assertSucceeds(getDocs(query(collection(as(ADMIN), 'posts'), where('at', '>', Timestamp.fromMillis(0)), orderBy('at', 'desc'), limit(30))));
  await assertFails(getDocs(collection(anon(), 'posts')));
  await assertFails(getDoc(doc(as(OTHER), 'posts', ref.id))); // 가입 전
  await assertFails(addDoc(collection(as(OTHER), 'posts'), post(OTHER)));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { name: '익명' })));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { by: ADMIN.uid, name: ADMIN.name })));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { at: now() })));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { title: '' })));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { body: 'ㄱ'.repeat(4001) })));
  await assertSucceeds(addDoc(collection(as(PROF), 'posts'), post(PROF, { body: '가'.repeat(4000) }))); // 한글도 글자 수로 셈
  const { editedAt, ...noEdited } = post(PROF);
  await assertFails(addDoc(collection(as(PROF), 'posts'), noEdited));
});

test('게시판: 고치기는 쓴 사람만, 제목·내용만', async () => {
  await withPost();
  await assertSucceeds(updateDoc(doc(as(PROF), 'posts/p1'), { title: '장비 나눔 (끝)', body: '가져가셨어요', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as(ADMIN), 'posts/p1'), { title: '관리자가 고침', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as(PROF), 'posts/p1'), { name: '다른이름', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as(PROF), 'posts/p1'), { title: '시각 없이' }));
  await assertFails(updateDoc(doc(as(PROF), 'posts/p1'), { by: ADMIN.uid, editedAt: serverTimestamp() }));
});

test('게시판 댓글: 회원만 달고, 지우기는 쓴 사람·관리자', async () => {
  await withPost();
  const ref = await assertSucceeds(addDoc(collection(as(PROF), 'posts/p1/comments'), comment(PROF)));
  await assertSucceeds(getDocs(query(collection(as(PROF), 'posts/p1/comments'), orderBy('at'))));
  await assertFails(addDoc(collection(as(OTHER), 'posts/p1/comments'), comment(OTHER)));
  await assertFails(addDoc(collection(as(PROF), 'posts/p1/comments'), comment(PROF, { name: '익명' })));
  await assertFails(addDoc(collection(as(PROF), 'posts/p1/comments'), comment(PROF, { body: 'ㄱ'.repeat(1001) })));
  await assertFails(addDoc(collection(as(PROF), 'posts/none/comments'), comment(PROF)));
  await assertFails(updateDoc(ref, { body: '고침' }));
  await assertFails(deleteDoc(doc(as(PROF), 'posts/p1/comments/c1'))); // 내 글이어도 남의 댓글 하나만은 못 지움
  await assertSucceeds(deleteDoc(ref));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'posts/p1/comments/c1')));
});

test('게시판: 글쓴이는 남의 댓글까지 한 번에 지우며 글을 지움, 남의 글은 관리자만', async () => {
  await withPost();
  const tryRemove = async (u) => {
    const db = as(u);
    const b = writeBatch(db);
    (await getDocs(collection(db, 'posts/p1/comments'))).docs.forEach(d => b.delete(d.ref));
    b.delete(doc(db, 'posts/p1'));
    return b.commit();
  };
  await seed(db => setDoc(doc(db, 'members', OTHER.uid), memberDoc(OTHER)));
  await assertFails(tryRemove(OTHER));
  await assertSucceeds(tryRemove(PROF));
  await withPost();
  await assertSucceeds(tryRemove(ADMIN));
});

// ---------- 연구실 둘러보기 프로필 ----------
const base0 = { name: PROF.name, dept: PROF.dept, group: '기초', rank: '', hidden: false };
const content = (u, extra = {}) => ({
  rank: '교수', line: '세포가 늙는 원리를 연구해요', question: '세포 노화는 어떻게 시작될까요?', keywords: ['노화', 'RNA'], topics: ['cancer'],
  axes: [{ name: '세포 노화', text: '노화는 어떻게 시작될까', papers: [{ label: '예시 2024', url: 'https://example.com/p1' }] }],
  timeline: [{ years: '2016–2020', text: '부임, 노화 모델 확립' }],
  resources: { models: '노화 마우스', samples: '', equipment: '공초점 현미경', data: '', techniques: 'RNA-seq' },
  links: [{ label: '연구실 홈페이지', url: 'https://example.com/lab' }], confirmedAt: serverTimestamp(), by: u.uid, ...extra,
});
const priv = (extra = {}) => ({ seeking: '환자 PBMC', now: '단일세포 분석을 배워요', contact: '연구실 내선 0000', at: serverTimestamp(), ...extra });
async function withProfile({ link = true } = {}) {
  await base();
  await seed(async db => {
    await setDoc(doc(db, 'profiles/abc234'), base0);
    if (link) await updateDoc(doc(db, 'roster', PROF.email), { profile: 'abc234' });
  });
}

test('프로필 연결: 관리자가 명단에 번호를 넣고 기본 칸으로 만듦', async () => {
  await base();
  const db = as(ADMIN);
  const b = writeBatch(db);
  b.update(doc(db, 'roster', PROF.email), { profile: 'abc234', at: serverTimestamp() });
  b.set(doc(db, 'profiles/abc234'), base0);
  await assertSucceeds(b.commit());
  await assertSucceeds(updateDoc(doc(db, 'profiles/abc234'), { name: '김철수', dept: '바뀐교실', group: '기초', hidden: true }));
  await assertFails(updateDoc(doc(db, 'roster', OTHER.email), { profile: 'BAD!!!' }));
  await assertFails(setDoc(doc(db, 'profiles/ABCDEF'), base0));
  await assertFails(setDoc(doc(db, 'profiles/xyz234'), { ...base0, line: '관리자가 쓴 소개' }));
  await assertFails(setDoc(doc(as(PROF), 'profiles/xyz234'), base0));
  await assertFails(updateDoc(doc(as(PROF), 'roster', PROF.email), { profile: 'xyz234' })); // 본인이 남의 번호로 바꿀 수 없음
});

test('프로필: 누구나 읽음, 본인만 소개 칸을 씀 (저장 = 확인)', async () => {
  await withProfile();
  await assertSucceeds(getDocs(collection(anon(), 'profiles')));
  await assertSucceeds(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF)));
  await assertFails(updateDoc(doc(as(OTHER), 'profiles/abc234'), content(OTHER))); // 가입 전, 연결 안 됨
  await seed(db => setDoc(doc(db, 'members', OTHER.uid), memberDoc(OTHER)));
  await assertFails(updateDoc(doc(as(OTHER), 'profiles/abc234'), content(OTHER))); // 회원이지만 남의 프로필
  await assertFails(updateDoc(doc(as(ADMIN), 'profiles/abc234'), content(ADMIN))); // 관리자도 남의 소개는 못 씀
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { name: '다른이름' })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { hidden: true })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { confirmedAt: now() })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { line: 'ㄱ'.repeat(161) })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { resources: { models: '', secret: 'x' } })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { keywords: Array(11).fill('k') })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { axes: Array(4).fill({ name: 'x', text: '', papers: [] }) })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { timeline: Array(5).fill({ years: '2020', text: 'x' }) })));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF, { firstReads: [] })));
  await assertFails(deleteDoc(doc(as(PROF), 'profiles/abc234')));
});

test('프로필: 멈춘 회원이나 연결이 풀린 분은 못 고침', async () => {
  await withProfile();
  await seed(db => updateDoc(doc(db, 'members', PROF.uid), { active: false }));
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF)));
  await withProfile({ link: false });
  await assertFails(updateDoc(doc(as(PROF), 'profiles/abc234'), content(PROF)));
});

test('프로필 로그인 칸: 회원만 읽고 본인만 씀', async () => {
  await withProfile();
  const ref = db => doc(db, 'profiles/abc234/private/info');
  const db = as(PROF), b = writeBatch(db);
  b.update(doc(db, 'profiles/abc234'), content(PROF));
  b.set(ref(db), priv());
  await assertSucceeds(b.commit());
  await assertSucceeds(getDoc(ref(as(ADMIN))));
  await assertFails(getDoc(ref(anon())));
  await assertFails(getDoc(ref(as(OTHER)))); // 가입 전
  await assertFails(setDoc(ref(as(ADMIN)), priv()));
  await assertFails(setDoc(ref(as(PROF)), priv({ seeking: 'ㄱ'.repeat(301) })));
  await assertFails(setDoc(doc(as(PROF), 'profiles/abc234/private/other'), priv()));
  await assertFails(deleteDoc(ref(as(PROF))));
});

// ---------- 주문 모으기 ----------
test('식당 메뉴 미리 고르기: 친목회 meals 중 하나만', async () => {
  await withEvent({ meals: ['김치찌개', '된장찌개'] });
  const db = as(PROF);
  await assertSucceeds(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { meal: '김치찌개' })));
  await assertSucceeds(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { meal: '' })));
  await assertFails(setDoc(doc(db, 'events/e1/rsvps', PROF.uid), rsvp(PROF, { meal: '스테이크' })));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'events/e1'), { meals: ['김치찌개', '된장찌개', '비빔밥'] }));
  await assertFails(updateDoc(doc(as(ADMIN), 'events/e1'), { meals: Array.from({ length: 81 }, (_, i) => `메뉴${i}`) }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'events/e1'), { cafeMenu: ['아메리카노 (아이스/따뜻한)'], mealPick: true }));
  await assertFails(updateDoc(doc(as(ADMIN), 'events/e1'), { mealPick: 'yes' }));
  await assertFails(updateDoc(doc(as(PROF), 'events/e1'), { meals: ['몰래'] }));
});

test('주문판: 교수님 누구나 메뉴를 적고 ＋/−, 관리자만 지움', async () => {
  await withEvent();
  const db = as(PROF), ref = doc(db, 'events/e1/orders/cafe');
  await assertSucceeds(setDoc(ref, { menu: ['아메리카노 (아이스/따뜻한)', '자몽에이드'], counts: {}, at: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, new FieldPath('counts', '아이스 아메리카노'), increment(1), 'at', serverTimestamp()));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'events/e1/orders/cafe'), new FieldPath('counts', '아이스 아메리카노'), increment(-1), 'at', serverTimestamp()));
  await assertSucceeds(getDoc(doc(as(ADMIN), 'events/e1/orders/cafe')));
  await assertFails(updateDoc(ref, new FieldPath('counts', '자몽에이드'), increment(1))); // 시각 없이
  await assertFails(setDoc(doc(db, 'events/e1/orders/bar'), { menu: [], counts: {}, at: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'events/none/orders/cafe'), { menu: [], counts: {}, at: serverTimestamp() }));
  await assertFails(setDoc(ref, { menu: Array.from({ length: 81 }, (_, i) => `메뉴${i}`), counts: {}, at: serverTimestamp() }));
  await assertFails(getDoc(doc(as(OTHER), 'events/e1/orders/cafe'))); // 가입 전
  await assertFails(getDoc(doc(anon(), 'events/e1/orders/cafe')));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'events/e1/orders/cafe')));
});

test('지난 메뉴: 교수님 누구나 읽고 씀', async () => {
  await base();
  await assertSucceeds(setDoc(doc(as(PROF), 'menus/cafe'), { text: '아메리카노\n라떼', at: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(as(ADMIN), 'menus/cafe')));
  await assertFails(getDoc(doc(anon(), 'menus/cafe')));
  await assertFails(setDoc(doc(as(OTHER), 'menus/cafe'), { text: 'x', at: serverTimestamp() }));
  await assertFails(setDoc(doc(as(PROF), 'menus/other'), { text: 'x', at: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as(PROF), 'menus/cafe')));
});

test('게시판 공지: 관리자만 정하고 바꿈, 글쓴이가 고쳐도 그대로', async () => {
  await withPost();
  await assertSucceeds(addDoc(collection(as(ADMIN), 'posts'), post(ADMIN, { pinned: true })));
  await assertFails(addDoc(collection(as(PROF), 'posts'), post(PROF, { pinned: true })));
  await assertSucceeds(addDoc(collection(as(PROF), 'posts'), post(PROF, { pinned: false })));
  await assertSucceeds(updateDoc(doc(as(ADMIN), 'posts/p1'), { pinned: true })); // 남의 글도 공지로
  await assertFails(updateDoc(doc(as(PROF), 'posts/p1'), { pinned: false }));
  await assertFails(updateDoc(doc(as(ADMIN), 'posts/p1'), { pinned: 'yes' }));
  await assertFails(updateDoc(doc(as(ADMIN), 'posts/p1'), { pinned: false, title: '관리자가 고침' }));
  await assertSucceeds(getDocs(query(collection(as(PROF), 'posts'), where('pinned', '==', true))));
  await assertSucceeds(updateDoc(doc(as(PROF), 'posts/p1'), { title: '고친 제목', body: '고친 내용', editedAt: serverTimestamp() }));
});
