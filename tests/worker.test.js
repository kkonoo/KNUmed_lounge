'use strict';
// Worker 확인 (node --test): Cloudflare 없이 worker/worker.js를 불러서
// 로그인 토큰 서명 확인, 교수님·관리자 확인, 키 넣기·감추기, 메뉴판 읽기 요청 모양, 하루 한도를 봐요
// Google 공개키·Firestore·Anthropic은 가짜 fetch로 흉내 내요. 이름·메일·키는 모두 가짜
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PROJECT = 'knumed-lounge';
const ORIGIN = 'https://kkonoo.github.io';
const GOOD_KEY = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';
let W, keys, jwk;
const state = { members: {}, admins: [], anthropic: [], modelsStatus: 200, messagesReply: null };

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
  W = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'worker.js')).href);
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith('https://www.googleapis.com/service_accounts/')) return json({ keys: [jwk] }, 200, { 'cache-control': 'public, max-age=3600' });
    const fs = /documents\/(.+)$/.exec(url);
    if (fs) {
      if (fs[1] === 'config/admins') return json({ fields: { uids: { arrayValue: { values: state.admins.map(stringValue => ({ stringValue })) } } } });
      const m = state.members[fs[1].replace('members/', '')];
      return m ? json({ fields: { active: { booleanValue: m.active } } }) : json({ error: {} }, 404);
    }
    if (url.startsWith('https://api.anthropic.com/v1/models/')) return json({}, state.modelsStatus);
    if (url === 'https://api.anthropic.com/v1/messages') {
      state.anthropic.push({ headers: opts.headers, body: JSON.parse(opts.body) });
      return state.messagesReply || json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ name: '아메리카노', temp: 'both' }, { name: '자몽에이드', temp: 'none' }] }) }] });
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

test('Claude 답 읽기: name·temp만, 모르는 temp는 none, 모양이 다르면 빈 목록', () => {
  assert.deepEqual(W.menuItems(JSON.stringify({ items: [{ name: ' 라떼 ', temp: 'both' }, { name: '', temp: 'ice' }, { temp: 'hot' }, { name: '차', temp: 'warm' }] })),
    [{ name: '라떼', temp: 'both' }, { name: '차', temp: 'none' }]);
  assert.deepEqual(W.menuItems('메뉴판이 아니에요'), []);
  assert.deepEqual(W.menuItems('{"items":"x"}'), []);
});
