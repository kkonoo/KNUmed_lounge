'use strict';
// Worker 확인 (node --test): Cloudflare 없이 worker/worker.js를 불러서
// 로그인 토큰 서명 확인, 교수님·관리자 확인, 키 넣기·감추기, 메뉴판 읽기 요청 모양, 하루 한도, PIN 초기화를 봐요
// Google 공개키·Firestore·Anthropic·Google 토큰·Firebase Auth는 가짜 fetch로 흉내 내요. 이름·메일·키는 모두 가짜
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PROJECT = 'knumed-lounge';
const ORIGIN = 'https://kkonoo.github.io';
const GOOD_KEY = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';
let W, keys, jwk;
const state = { members: {}, admins: [], anthropic: [], modelsStatus: 200, messagesReply: null, roster: {}, profiles: [], book: null, google: [], authUsers: {} };
// 공동연구 찾기용 가짜 프로필 (공개 데이터 + Firestore). 이름은 모두 가짜
const BOOK = {
  topics: [{ key: 'brain', emoji: '🧠', label: '뇌·신경·마음' }, { key: 'immune', emoji: '🛡️', label: '면역·염증·알레르기' }],
  people: [
    { id: 'zzzzzz', name: '홍길동', rank: '교수', dept: '가짜학교실', group: '기초', line: '호중구와 지방간', keywords: ['호중구'], topics: ['immune'], links: [['https://example.com/a', '연구실']], photo: 'photos/zzzzzz.jpg', status: 'namebook' },
    { id: 'aaaaaa', name: '김철수', rank: '부교수', dept: '예시학교실', group: '기초', line: '뇌 지질 신호', keywords: ['알츠하이머병'], topics: ['brain'], links: [], photo: 'photos/aaaaaa.jpg', status: 'namebook' },
  ],
  photos: { cccccc: 'photos/cccccc.jpg' },
  drafts: { aaaaaa: { question: '초안 질문', axes: [{ name: '지질 축', text: '스핑고지질 대사', papers: [{ label: 'J 2024 · 지질', url: 'https://doi.org/10.1/x' }] }], resources: { models: '5xFAD 마우스' } } },
};
const fsString = s => ({ stringValue: s });
const fsDoc = (id, f) => ({ name: `projects/${PROJECT}/databases/(default)/documents/profiles/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'boolean' ? { booleanValue: v } : fsString(v)])) });

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
async function sign(payload, { kid = 'k1', key = keys.privateKey, alg = 'RS256' } = {}) {
  const head = enc({ alg, kid, typ: 'JWT' }), body = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (uid, extra = {}) => ({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now() - 10, auth_time: now() - 10, exp: now() + 3600, ...extra });

function kv() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test.before(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'worker.js')).href);
  assert.deepEqual(Object.keys(mod), ['default']); // Workers 런타임은 다른 export가 있으면 시작하지 않음
  W = { ...mod.default, default: mod.default };
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith('https://www.googleapis.com/service_accounts/')) return json({ keys: [jwk] }, 200, { 'cache-control': 'public, max-age=3600' });
    if (url === 'https://kkonoo.github.io/KNUmed_lounge/data/people.json') return json(state.book);
    if (url.includes('/documents/profiles?')) return json({ documents: state.profiles });
    const fs = /documents\/(.+)$/.exec(url);
    if (fs) {
      if (fs[1].startsWith('roster/')) {
        const pid = state.roster[decodeURIComponent(fs[1].slice(7))];
        return pid ? json({ fields: { name: fsString('가짜'), profile: fsString(pid) } }) : json({ error: {} }, 404);
      }
      if (fs[1] === 'config/admins') return json({ fields: { uids: { arrayValue: { values: state.admins.map(stringValue => ({ stringValue })) } } } });
      const m = state.members[fs[1].replace('members/', '')];
      return m ? json({ fields: { active: { booleanValue: m.active } } }) : json({ error: {} }, 404);
    }
    if (url.startsWith('https://api.anthropic.com/v1/models/')) return json({}, state.modelsStatus);
    if (url === 'https://api.anthropic.com/v1/messages') {
      state.anthropic.push({ headers: opts.headers, body: JSON.parse(opts.body) });
      return state.messagesReply || json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ name: '아메리카노', temp: 'both' }, { name: '자몽에이드', temp: 'none' }] }) }] });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      state.google.push({ token: Object.fromEntries(new URLSearchParams(opts.body)) });
      return json({ access_token: 'ya29.fake', expires_in: 3599, token_type: 'Bearer' });
    }
    const idt = /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/projects\/([^/]+)\/accounts:(lookup|update)$/.exec(url);
    if (idt) {
      const body = JSON.parse(opts.body);
      state.google.push({ project: idt[1], what: idt[2], auth: opts.headers.authorization, body });
      if (idt[2] === 'lookup') { const uid = state.authUsers[body.email?.[0]]; return json(uid ? { users: [{ localId: uid, email: body.email[0] }] } : {}); }
      return json({ localId: body.localId });
    }
    throw new Error(`예상 못 한 주소 ${url}`);
  };
});

async function call(env, method, pathName, { uid, body, origin = ORIGIN, token } = {}) {
  const headers = { origin };
  if (uid) headers.authorization = `Bearer ${token || await sign(claims(uid))}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await W.default.fetch(new Request(`https://lounge-worker.example.workers.dev${pathName}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text, headers: res.headers };
}
function setup() {
  state.members = { prof: { active: true }, admin: { active: true }, stopped: { active: false } };
  state.admins = ['admin'];
  state.anthropic = [];
  state.modelsStatus = 200;
  state.messagesReply = null;
  state.book = BOOK;
  state.roster = { 'kim@example.com': 'aaaaaa' };
  state.profiles = [
    fsDoc('aaaaaa', { name: '김철수', dept: '예시학교실', group: '기초', rank: '부교수', hidden: false }),
    fsDoc('zzzzzz', { name: '홍길동', dept: '가짜학교실', group: '기초', rank: '교수', hidden: false }),
    fsDoc('cccccc', { name: '이영희', dept: '예시학교실', group: '기초', rank: '', hidden: false }),
    fsDoc('hhhhhh', { name: '숨은분', dept: '예시학교실', group: '기초', rank: '', hidden: true }),
  ];
  return { LOUNGE: kv() };
}

test('로그인 토큰: 서명·대상·발급처·만료를 모두 봄', async () => {
  const getKeys = async () => [jwk];
  assert.equal((await W.verifyIdToken(await sign(claims('prof')), PROJECT, getKeys)).uid, 'prof');
  const fails = async (tok, why) => assert.rejects(W.verifyIdToken(tok, PROJECT, getKeys), e => e.status === 401, why);
  await fails(await sign(claims('prof', { aud: 'other-project' })), '다른 프로젝트');
  await fails(await sign(claims('prof', { iss: 'https://evil.example' })), '다른 발급처');
  await fails(await sign(claims('prof', { exp: now() - 5 })), '만료');
  await fails(await sign(claims('prof', { sub: '' })), 'uid 없음');
  await fails(await sign(claims('prof'), { kid: 'unknown' }), '모르는 키');
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  await fails(await sign(claims('prof'), { key: other.privateKey }), '다른 키로 서명');
  const [h, , s] = (await sign(claims('prof'))).split('.');
  await fails(`${h}.${enc(claims('admin'))}.${s}`, '내용을 바꿈');
  await fails(`${enc({ alg: 'none', kid: 'k1' })}.${enc(claims('prof'))}.`, '서명 없음');
  await fails('', '빈 토큰');
});

test('Origin과 CORS: 라운지 주소만, 미리 묻기(OPTIONS)는 204', async () => {
  const env = setup();
  const pre = await W.default.fetch(new Request('https://w.example/ai/menu', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await call(env, 'GET', '/status', { uid: 'prof', origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, 'GET', '/status', { uid: 'prof', origin: 'http://localhost:8767' })).status, 200);
});

test('교수님 확인: 토큰 없음 401, 가입 안 함·멈춤 403', async () => {
  const env = setup();
  assert.equal((await call(env, 'GET', '/status')).status, 401);
  assert.equal((await call(env, 'GET', '/status', { uid: 'stranger' })).status, 403);
  assert.equal((await call(env, 'GET', '/status', { uid: 'stopped' })).status, 403);
  const ok = await call(env, 'GET', '/status', { uid: 'prof' });
  assert.deepEqual(ok.body, { ai: false, used: 0, limit: W.LIMITS.perUser });
});

test('관리자 키: 관리자만 넣고, 맞는 키인지 확인하고, 끝 4자리만 돌려줌', async () => {
  const env = setup();
  assert.equal((await call(env, 'PUT', '/admin/key', { uid: 'prof', body: { key: GOOD_KEY } })).status, 403);
  assert.equal((await call(env, 'PUT', '/admin/key', { uid: 'admin', body: { key: 'not-a-key' } })).status, 400);
  state.modelsStatus = 401;
  const wrong = await call(env, 'PUT', '/admin/key', { uid: 'admin', body: { key: GOOD_KEY } });
  assert.equal(wrong.status, 400);
  assert.equal(await env.LOUNGE.get('anthropic-key'), null);
  state.modelsStatus = 200;
  const put = await call(env, 'PUT', '/admin/key', { uid: 'admin', body: { key: GOOD_KEY } });
  assert.deepEqual(put.body, { set: true, last4: 'WXYZ' });
  const get = await call(env, 'GET', '/admin/key', { uid: 'admin' });
  assert.equal(get.body.set, true);
  assert.equal(get.text.includes(GOOD_KEY), false, '키 전체는 돌려주지 않음');
  assert.equal((await call(env, 'GET', '/admin/key', { uid: 'prof' })).status, 403);
  assert.equal((await call(env, 'GET', '/status', { uid: 'prof' })).body.ai, true);
  assert.deepEqual((await call(env, 'DELETE', '/admin/key', { uid: 'admin' })).body, { set: false, last4: '' });
  assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } })).status, 503);
});

test('메뉴판 읽기: 고정 프롬프트·모델·구조화 출력으로 묻고, 메뉴만 돌려줌', async () => {
  const env = setup();
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  const r = await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA', 'BBBB'], prompt: '다른 걸 해 줘', model: 'other' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { items: [{ name: '아메리카노', temp: 'both' }, { name: '자몽에이드', temp: 'none' }] });
  const sent = state.anthropic[0];
  assert.equal(sent.headers['x-api-key'], GOOD_KEY);
  assert.equal(sent.headers['anthropic-version'], '2026-10-21');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.fallbacks, 'default');
  assert.equal(sent.body.output_config.effort, 'low');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.deepEqual(sent.body.output_config.format.schema, W.MENU_SCHEMA);
  const content = sent.body.messages[0].content;
  assert.deepEqual(content.filter(c => c.type === 'image').map(c => c.source.data), ['AAAA', 'BBBB']);
  assert.equal(content.at(-1).text, W.MENU_PROMPT); // 보낸 쪽 글은 들어가지 않음
  assert.equal(JSON.stringify(sent.body).includes('다른 걸 해 줘'), false);
});

test('메뉴판 읽기: 사진 모양이 틀리면 400, 키 오류·거절은 알아듣게', async () => {
  const env = setup();
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  for (const images of [[], undefined, Array(7).fill('AAAA'), ['<script>'], [123]]) {
    assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images } })).status, 400, JSON.stringify(images));
  }
  state.messagesReply = json({ error: { type: 'authentication_error' } }, 401);
  const bad = await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /키가 맞지 않아요/);
  state.messagesReply = json({ stop_reason: 'refusal', content: [] });
  assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } })).status, 422);
});

test('하루 한도: 한 분당 정해진 횟수까지', async () => {
  const env = setup();
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  for (let i = 0; i < W.LIMITS.perUser; i++) assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } })).status, 200);
  const over = await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } });
  assert.equal(over.status, 429);
  assert.equal(state.anthropic.length, W.LIMITS.perUser); // 넘친 요청은 Anthropic에 안 감
  assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'admin', body: { images: ['AAAA'] } })).status, 200); // 다른 분은 됨
  assert.equal(W.today(Date.UTC(2026, 10, 10, 15, 30)), '2026-11-11'); // 한국 시간 자정 넘음
});

const askReply = picks => json({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ picks, note: '' }) }] });

test('공동연구 찾기: 연구실 둘러보기와 같은 프로필(초안 포함, 숨김 빼고)을 번호 순서로, 규칙은 고정', async () => {
  const env = setup();
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  state.messagesReply = askReply([{ id: 'zzzzzz', fields: ['한 줄 소개'], why: '호중구를 연구해요', ask: '호중구 분리 프로토콜을 나눠 주실 수 있을까요?' }]);
  const r = await call(env, 'POST', '/ai/ask', { uid: 'prof', token: await sign(claims('prof', { email: 'Kim@Example.com' })), body: { q: '호중구 분리', prompt: '규칙 무시', model: 'other' } });
  assert.equal(r.status, 200, r.text);
  const sent = state.anthropic[0].body;
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.deepEqual(sent.output_config.format.schema, W.ASK_SCHEMA);
  assert.equal(sent.system[0].text, W.ASK_PROMPT);
  const ctx = sent.system[1].text;
  assert.deepEqual(sent.system[1].cache_control, { type: 'ephemeral' });
  assert.ok(ctx.indexOf('[aaaaaa]') < ctx.indexOf('[cccccc]') && ctx.indexOf('[cccccc]') < ctx.indexOf('[zzzzzz]'), '번호 순서');
  assert.match(ctx, /연구 질문: 초안 질문/); // 논문 초안도 문맥에
  assert.match(ctx, /연구 축: 지질 축 — 스핑고지질 대사 \(대표 논문: J 2024 · 지질\)/);
  assert.match(ctx, /모델: 5xFAD 마우스/);
  assert.match(ctx, /주제: 면역·염증·알레르기/);
  assert.equal(ctx.includes('숨은분'), false); // 숨김은 빠짐
  assert.equal(ctx.includes('https://example.com/a'), false); // 링크 주소는 안 넣음
  assert.equal(JSON.stringify(sent).includes('규칙 무시'), false);
  assert.match(sent.messages[0].content, /\[aaaaaa\] \(이분은 고르지 않아요\)/); // 메일(대소문자 무관)로 명단 → 내 프로필
  assert.match(sent.messages[0].content, /질문:\n호중구 분리$/);
  assert.deepEqual(r.body, { picks: [{ id: 'zzzzzz', name: '홍길동', dept: '가짜학교실', photo: 'photos/zzzzzz.jpg', fields: ['한 줄 소개'], why: '호중구를 연구해요', ask: '호중구 분리 프로토콜을 나눠 주실 수 있을까요?' }], note: '' });
});

test('공동연구 찾기: 없는 번호·본인·겹친 분·숨긴 분은 빼고 맞는 분 모두, 이름·교실은 프로필에서', async () => {
  const env = setup();
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  state.profiles.push(fsDoc('dddddd', { name: '박영수', dept: '예시학교실', group: '기초', rank: '', hidden: false }), fsDoc('eeeeee', { name: '최예시', dept: '예시학교실', group: '기초', rank: '', hidden: false }));
  state.messagesReply = askReply([
    { id: 'nope99', fields: [], why: 'x', ask: 'x' }, { id: 'aaaaaa', fields: [], why: '본인', ask: 'x' },
    { id: 'cccccc', fields: ['보유 자원', '아무 칸'], why: 'a', ask: 'a' }, { id: 'cccccc', fields: [], why: 'b', ask: 'b' },
    { id: 'zzzzzz', fields: [], why: 'c', ask: 'c' }, { id: 'dddddd', fields: [], why: 'd', ask: 'd' }, { id: 'hhhhhh', fields: [], why: '숨김', ask: 'x' },
    { id: 'eeeeee', fields: [], why: 'e', ask: 'e' },
  ]);
  const r = await call(env, 'POST', '/ai/ask', { uid: 'prof', token: await sign(claims('prof', { email: 'kim@example.com' })), body: { q: '마우스' } });
  assert.deepEqual(r.body.picks.map(p => p.id), ['cccccc', 'zzzzzz', 'dddddd', 'eeeeee']); // 몇 분이든 순서 그대로
  assert.equal(r.body.picks[0].name, '이영희');
  assert.equal(r.body.picks[0].photo, 'photos/cccccc.jpg'); // 이름북에 없는 분 사진도
  assert.deepEqual(r.body.picks[0].fields, ['보유 자원']);
  assert.deepEqual(W.askPicks('답이 아니에요', [], ''), { picks: [], note: '답을 읽지 못했어요. 다시 해 주세요' });
});

test('공동연구 찾기: 빈 질문·긴 질문 400, 키 없음 503, 메뉴판 읽기와 하루 한도를 같이 씀', async () => {
  const env = setup();
  assert.equal((await call(env, 'POST', '/ai/ask', { uid: 'prof', body: { q: '마우스' } })).status, 503);
  await env.LOUNGE.put('anthropic-key', GOOD_KEY);
  assert.equal((await call(env, 'POST', '/ai/ask', { uid: 'prof', body: { q: '  ' } })).status, 400);
  assert.equal((await call(env, 'POST', '/ai/ask', { uid: 'prof', body: { q: 'ㄱ'.repeat(501) } })).status, 400);
  assert.equal((await call(env, 'POST', '/ai/ask', { uid: 'stopped', body: { q: '마우스' } })).status, 403);
  assert.equal(state.anthropic.length, 0);
  for (let i = 0; i < W.LIMITS.perUser - 1; i++) assert.equal((await call(env, 'POST', '/ai/menu', { uid: 'prof', body: { images: ['AAAA'] } })).status, 200);
  state.messagesReply = askReply([]);
  const last = await call(env, 'POST', '/ai/ask', { uid: 'prof', body: { q: '마우스' } }); // 메일 없는 토큰이면 본인 없이
  assert.equal(last.status, 200);
  assert.match(state.anthropic.at(-1).body.messages[0].content, /질문한 교수님: 프로필 없음/);
  assert.equal((await call(env, 'POST', '/ai/ask', { uid: 'prof', body: { q: '마우스' } })).status, 429);
});

test('Claude 답 읽기: name·temp만, 모르는 temp는 none, 모양이 다르면 빈 목록', () => {
  assert.deepEqual(W.menuItems(JSON.stringify({ items: [{ name: ' 라떼 ', temp: 'both' }, { name: '', temp: 'ice' }, { temp: 'hot' }, { name: '차', temp: 'warm' }] })),
    [{ name: '라떼', temp: 'both' }, { name: '차', temp: 'none' }]);
  assert.deepEqual(W.menuItems('메뉴판이 아니에요'), []);
  assert.deepEqual(W.menuItems('{"items":"x"}'), []);
});

// ---------- PIN 초기화 ----------
// 가짜 서비스 계정 키 (Firebase 콘솔에서 받는 JSON과 같은 모양)
async function fakeServiceAccount() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const sa = { type: 'service_account', project_id: PROJECT, client_email: `lounge-pin@${PROJECT}.iam.gserviceaccount.com`, private_key: pem };
  return { json: JSON.stringify(sa), publicKey: pair.publicKey, email: sa.client_email };
}

test('PIN 초기화: 관리자만, 명단에 있고 가입한 분만, 서비스 계정 키로 0000 규칙의 비밀번호', async () => {
  const A = require('./load')('js/account-core.js');
  const sa = await fakeServiceAccount();
  const env = { ...setup(), FIREBASE_SA: sa.json };
  state.roster['lee@example.com'] = 'cccccc'; // 명단에는 있지만 아직 가입 안 함
  state.authUsers = { 'kim@example.com': 'uid-kim' };
  state.google = [];
  const reset = (uid, email, e = env) => call(e, 'POST', '/admin/pin-reset', { uid, body: { email } });

  assert.equal((await reset('prof', 'kim@example.com')).status, 403); // 관리자만
  assert.equal((await reset('admin', 'kim@example.com', setup())).status, 503); // 서비스 계정 키 없음
  assert.match((await reset('admin', 'kim@example.com', setup())).body.error, /FIREBASE_SA/);
  assert.equal((await reset('admin', 'kim@example.com', { ...setup(), FIREBASE_SA: '{"client_email":"x","private_key":"깨짐"}' })).status, 503);
  state.roster['lee@example.com'] = 'cccccc';
  assert.equal((await reset('admin', 'not-an-email')).status, 400);
  assert.equal((await reset('admin', 'a/b@example.com')).status, 400);
  assert.equal((await reset('admin', 'nobody@example.com')).status, 404); // 명단에 없음
  const notJoined = await reset('admin', 'lee@example.com');
  assert.equal(notJoined.status, 404);
  assert.equal(notJoined.body.error, '아직 가입하지 않은 분이에요');
  assert.equal(state.google.filter(x => x.what === 'update').length, 0);

  const ok = await reset('admin', ' Kim@Example.com ');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { pin: '0000' });
  assert.ok(!ok.text.includes('PRIVATE KEY') && !ok.text.includes('ya29')); // 키·토큰은 돌려주지 않음
  const upd = state.google.filter(x => x.what === 'update');
  assert.equal(upd.length, 1);
  assert.deepEqual(upd[0].body, { localId: 'uid-kim', password: A.pinToPassword('0000') }); // 로그인 화면과 같은 규칙
  assert.equal(upd[0].project, PROJECT);
  assert.equal(upd[0].auth, 'Bearer ya29.fake');

  // Google 토큰 요청: 서비스 계정 키로 서명한 JWT (한 번 받으면 한 시간 다시 씀)
  const tokens = state.google.filter(x => x.token);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, b, s] = tokens[0].token.assertion.split('.');
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sa.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${b}`));
  assert.ok(verified);
  const claim = JSON.parse(Buffer.from(b, 'base64url'));
  assert.equal(claim.iss, sa.email);
  assert.equal(claim.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claim.exp - claim.iat, 3600);
});
