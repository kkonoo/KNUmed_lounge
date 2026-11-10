'use strict';
// 화면 흐름 검사 준비 (flow.spec.js가 씀)
// - 사이트 파일을 내주는 작은 서버
// - 에뮬레이터 비우기와 규칙 올리기
// - 브라우저: 실제 Firebase SDK(npm firebase 12.19.0)를 gstatic 주소로 대신 내주고, 에뮬레이터에 붙임
//   사이트 코드는 그대로 두고, js/firebase-config.js만 가짜 프로젝트(demo-lounge)로 바꿔 내줌 → 실제 DB에는 절대 안 닿음
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const ROOT = path.join(__dirname, '..', '..');
const PROJECT = 'demo-lounge';
const AUTH = '127.0.0.1:9099';
const STORE = { host: '127.0.0.1', port: 8080 };
const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';
const SDK = path.join(__dirname, 'node_modules', 'firebase');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

let env;
async function resetEmulators() {
  env ||= await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'), ...STORE } });
  await env.clearFirestore();
  const r = await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`auth 에뮬레이터를 비우지 못함 ${r.status}`);
}
const closeEmulators = () => env?.cleanup();

// getAuth·getFirestore를 감싸 처음 부를 때 에뮬레이터에 붙임. 나머지는 실제 SDK 그대로
const WRAP = {
  'firebase-auth.js': `export * from './real/firebase-auth.js';
import { getAuth as get, connectAuthEmulator } from './real/firebase-auth.js';
export function getAuth(app) { const a = get(app); if (!a.emulatorConfig) connectAuthEmulator(a, 'http://${AUTH}', { disableWarnings: true }); return a; }`,
  'firebase-firestore.js': `export * from './real/firebase-firestore.js';
import { getFirestore as get, connectFirestoreEmulator } from './real/firebase-firestore.js';
const on = new WeakSet();
export function getFirestore(app) { const db = get(app); if (!on.has(db)) { connectFirestoreEmulator(db, '${STORE.host}', ${STORE.port}); on.add(db); } return db; }`,
};
const CONFIG = `'use strict';\nconst firebaseConfig = { apiKey: 'fake-api-key', authDomain: '${PROJECT}.firebaseapp.com', projectId: '${PROJECT}', appId: 'fake-app' };\n`;

function sdk(route) {
  const name = route.request().url().slice(FB.length);
  const headers = { 'access-control-allow-origin': '*' };
  if (WRAP[name]) return route.fulfill({ contentType: 'text/javascript', headers, body: WRAP[name] });
  const real = name.replace(/^real\//, '');
  const file = path.join(SDK, real);
  if (!/^firebase-[a-z]+\.js$/.test(real) || !fs.existsSync(file)) return route.fulfill({ status: 404, headers, body: '' });
  return route.fulfill({ contentType: 'text/javascript', headers, body: fs.readFileSync(file, 'utf8') });
}

// 사람 한 명 = 브라우저 창 하나 (로그인이 따로 유지됨). errors에 화면 오류를 모음
async function person(browser) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  // 나중에 등록한 것이 먼저 걸림: 바깥 주소는 모두 막고(글꼴 등), Firebase SDK와 설정만 대신 내줌
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(`${FB}**`, sdk);
  await ctx.route('**/js/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept()); // confirm()은 '예'
  return { ctx, page, errors };
}

module.exports = { serve, resetEmulators, closeEmulators, person };
