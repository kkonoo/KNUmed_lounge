// 경북의대 라운지 Worker (Cloudflare Workers): 브라우저가 할 수 없는 일만 해요. 배포는 worker/README.md
//   GET    /status       Claude를 쓸 수 있는지 (교수님)
//   POST   /ai/menu      메뉴판 사진 → 메뉴 이름 { images: [JPEG base64] } → { items: [{ name, temp }] } (교수님, 하루 한도)
//   GET    /admin/key    키가 있는지, 끝 4자리, 오늘 쓴 횟수 (관리자)
//   PUT    /admin/key    Claude API 키 넣기 { key } (관리자, 넣기 전에 Anthropic에 맞는 키인지 확인)
//   DELETE /admin/key    키 지우기 (관리자)
//
// 지키는 것
// - 요청마다 Firebase 로그인 토큰(ID 토큰)의 서명·발급처·대상·만료를 확인해요. Origin 확인만으로는 브라우저 밖에서 흉내 낼 수 있어서요
// - 그 토큰으로 Firestore를 읽어 교수님(members/{uid}.active)·관리자(config/admins)인지 봐요. firestore.rules가 그대로 적용돼요
// - Claude API 키는 KV(LOUNGE)에만 두고 브라우저로 돌려주지 않아요(끝 4자리만)
// - 프롬프트는 여기 고정이에요. 아무 질문이나 대신 보내는 통로가 되지 않게
// - 한 분당 하루, 모두 합쳐 하루 한도가 있어요. 사진과 답은 저장하지 않아요

const PROJECT = 'knumed-lounge';
const ORIGINS = ['https://kkonoo.github.io', 'http://localhost:8767'];
const MODEL = 'claude-opus-5-5';
const LIMITS = { perUser: 20, all: 300 }; // 하루 (한국 시간)
const PHOTO_MAX = 6, PHOTO_CHARS = 4_000_000; // 사진 수, 사진 한 장 base64 글자 수 (화면이 긴 쪽 2000px로 줄여 보냄)
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const KEY = 'anthropic-key';

// ---------- 메뉴판 읽기: Claude에게 보내는 글과 받을 모양 (장난감 상자 주문 모으기와 같음) ----------
const MENU_PROMPT = `이 사진은 카페나 식당의 메뉴판이에요. 주문할 수 있는 메뉴를 모두 뽑아 items에 넣어 주세요.
- 메뉴판에 보이는 순서대로, 같은 메뉴는 한 번만
- name은 메뉴판에 적힌 이름 그대로. 한국어와 영어가 같이 적혀 있으면 한국어 이름만
- 가격, 용량, 설명, HOT/ICE 표시, 분류 제목(예: COFFEE, 음료, 디저트)은 name에 넣지 않기
- temp는 고를 수 있는 온도
  - both: 따뜻하게도 차갑게도 고를 수 있는 음료. 메뉴판에 HOT/ICE, H/I가 둘 다 적혀 있거나 HOT·ICE 가격이 둘 다 있으면 both. 표시가 없어도 커피·라떼·차처럼 보통 둘 다 파는 음료면 both
  - ice: ICE ONLY, 아이스만, 아이스 전용처럼 차갑게만 된다고 적혀 있거나, HOT·ICE 칸 중 ICE에만 가격이 있는 음료
  - hot: HOT ONLY, 따뜻한 것만처럼 따뜻하게만 된다고 적혀 있거나, HOT에만 가격이 있는 음료
  - none: 표시 없이 원래 차갑게만 마시는 에이드·스무디·프라페·주스, 이름에 이미 아이스·핫이 들어간 음료, 디저트·음식
- 메뉴판이 아니거나 읽을 수 있는 메뉴가 없으면 빈 목록`;
const MENU_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, temp: { type: 'string', enum: ['both', 'ice', 'hot', 'none'] } },
        required: ['name', 'temp'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

class Fail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Firebase ID 토큰 확인 (RS256) ----------
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const readPart = s => JSON.parse(new TextDecoder().decode(b64url(s)));

let jwks = { keys: [], until: 0 };
async function googleKeys() {
  if (Date.now() < jwks.until) return jwks.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Fail(502, '로그인을 확인하지 못했어요. 잠시 뒤에 다시 해 주세요');
  const age = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  jwks = { keys: (await res.json()).keys || [], until: Date.now() + age * 1000 };
  return jwks.keys;
}

async function verifyIdToken(token, projectId, getKeys = googleKeys, now = Date.now() / 1000) {
  const bad = new Fail(401, '다시 로그인해 주세요');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw bad;
  let head, body;
  try { head = readPart(parts[0]); body = readPart(parts[1]); } catch { throw bad; }
  if (head.alg !== 'RS256' || !head.kid) throw bad;
  const jwk = (await getKeys()).find(k => k.kid === head.kid);
  if (!jwk) throw bad;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad;
  if (body.aud !== projectId || body.iss !== `https://securetoken.google.com/${projectId}`) throw bad;
  if (typeof body.sub !== 'string' || !body.sub || body.sub.length > 128) throw bad;
  if (!(body.exp > now) || !(body.iat <= now + 60) || !(body.auth_time <= now + 60)) throw bad;
  return { uid: body.sub, token };
}

// ---------- Firestore (그 사람의 토큰으로 읽어서 규칙이 그대로 적용) ----------
async function firestoreGet(projectId, path, idToken) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Fail(502, '확인하지 못했어요. 잠시 뒤에 다시 해 주세요');
  return (await res.json()).fields || {};
}
async function who(req, projectId) {
  const token = (/^Bearer (.+)$/.exec(req.headers.get('authorization') || '') || [])[1];
  const me = await verifyIdToken(token, projectId);
  const [member, admins] = await Promise.all([
    firestoreGet(projectId, `members/${me.uid}`, me.token),
    firestoreGet(projectId, 'config/admins', me.token),
  ]);
  const isAdmin = (admins?.uids?.arrayValue?.values || []).some(v => v.stringValue === me.uid);
  const isMember = member?.active?.booleanValue === true;
  if (!isMember && !isAdmin) throw new Fail(403, '가입을 마친 교수님만 쓸 수 있어요');
  return { uid: me.uid, isAdmin };
}

// ---------- 하루 한도 (한국 시간 날짜) ----------
const today = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
async function used(kv, uid) {
  const d = today();
  const [mine, all] = await Promise.all([kv.get(`use:${d}:${uid}`), kv.get(`use:${d}:all`)]);
  return { mine: Number(mine) || 0, all: Number(all) || 0, day: d };
}
async function count(kv, uid) {
  const u = await used(kv, uid), ttl = { expirationTtl: 3 * 86400 };
  if (u.mine >= LIMITS.perUser) throw new Fail(429, `오늘은 ${LIMITS.perUser}번까지 썼어요. 내일 다시 해 주세요`);
  if (u.all >= LIMITS.all) throw new Fail(429, '오늘 라운지 전체 한도를 다 썼어요. 내일 다시 해 주세요');
  await Promise.all([kv.put(`use:${u.day}:${uid}`, String(u.mine + 1), ttl), kv.put(`use:${u.day}:all`, String(u.all + 1), ttl)]);
}

// ---------- Claude ----------
const claudeError = status => new Fail(502, {
  401: '관리자가 넣은 Claude API 키가 맞지 않아요. 관리자에게 알려 주세요',
  402: 'Claude API 크레딧이 모자라요. 관리자에게 알려 주세요',
  403: '관리자가 넣은 Claude API 키로 이 모델을 쓸 수 없어요. 관리자에게 알려 주세요',
  413: '사진이 너무 커요. 장수를 줄여 다시 해 보세요',
  429: '요청이 많아요. 조금 뒤에 다시 해 보세요',
  529: 'Claude가 붐벼요. 조금 뒤에 다시 해 보세요',
}[status] || `읽지 못했어요 (${status})`);

async function askMenu(apiKey, images) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01', // 안전 필터에 걸리면 서버가 다른 모델로 이어서 읽음
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: MENU_SCHEMA } }, // 글자 읽기라 짧게 생각하고 빨리
      messages: [{ role: 'user', content: [
        ...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
        { type: 'text', text: MENU_PROMPT },
      ] }],
    }),
  });
  if (!res.ok) throw claudeError(res.status);
  const body = await res.json();
  if (body.stop_reason === 'refusal') throw new Fail(422, 'Claude가 이 사진은 읽지 않았어요. 메뉴판만 보이게 다시 찍어 보세요');
  return menuItems(body.content?.filter(b => b.type === 'text').at(-1)?.text || '');
}
// Claude 답 → 메뉴 목록 (모양이 다른 것은 빼고)
function menuItems(text) {
  try {
    const items = JSON.parse(text)?.items;
    if (!Array.isArray(items)) return [];
    return items.filter(v => typeof v?.name === 'string' && v.name.trim()).slice(0, 80)
      .map(v => ({ name: v.name.trim().slice(0, 40), temp: ['both', 'ice', 'hot'].includes(v.temp) ? v.temp : 'none' }));
  } catch { return []; }
}
// 관리자가 넣는 키가 맞는지: 모델 정보 읽기 (토큰을 쓰지 않음)
async function checkKey(apiKey) {
  const res = await fetch(`https://api.anthropic.com/v1/models/${MODEL}`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2026-10-21' } });
  if (res.status === 401) throw new Fail(400, 'Anthropic이 이 키를 받지 않아요. 키를 다시 확인해 주세요');
  if (!res.ok) throw claudeError(res.status);
}

// ---------- 길 나누기 ----------
async function route(req, env) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
  const projectId = env.FIREBASE_PROJECT || PROJECT;
  const kv = env.LOUNGE;
  if (!kv) throw new Fail(500, 'Worker에 KV(LOUNGE)가 연결되지 않았어요. worker/README.md를 봐 주세요');
  const me = await who(req, projectId);

  if (path === '/status' && req.method === 'GET') {
    const u = await used(kv, me.uid);
    return { ai: !!(await kv.get(KEY)), used: u.mine, limit: LIMITS.perUser };
  }
  if (path === '/ai/menu' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    const images = body?.images;
    if (!Array.isArray(images) || !images.length || images.length > PHOTO_MAX
      || images.some(s => typeof s !== 'string' || !s || s.length > PHOTO_CHARS || !/^[A-Za-z0-9+/=]+$/.test(s))) {
      throw new Fail(400, `사진은 JPEG로 한 번에 ${PHOTO_MAX}장까지 보내 주세요`);
    }
    const apiKey = await kv.get(KEY);
    if (!apiKey) throw new Fail(503, '관리자가 아직 Claude API 키를 넣지 않았어요');
    await count(kv, me.uid);
    return { items: await askMenu(apiKey, images) };
  }
  if (path === '/admin/key') {
    if (!me.isAdmin) throw new Fail(403, '관리자만 할 수 있어요');
    if (req.method === 'GET') {
      const k = await kv.get(KEY), u = await used(kv, me.uid);
      return { set: !!k, last4: k ? k.slice(-4) : '', today: u.all, limits: LIMITS };
    }
    if (req.method === 'PUT') {
      const key = String((await req.json().catch(() => null))?.key || '').trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Fail(400, 'Claude API 키는 sk-ant-로 시작해요');
      await checkKey(key);
      await kv.put(KEY, key);
      return { set: true, last4: key.slice(-4) };
    }
    if (req.method === 'DELETE') {
      await kv.delete(KEY);
      return { set: false, last4: '' };
    }
  }
  throw new Fail(404, '없는 주소예요');
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const origins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : ORIGINS;
    if (!origins.includes(origin)) return new Response(JSON.stringify({ error: '허용되지 않은 곳에서 온 요청이에요' }), { status: 403, headers: { 'content-type': 'application/json', vary: 'Origin' } });
    const cors = {
      'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    try {
      return reply(200, await route(req, env));
    } catch (e) {
      if (e instanceof Fail) return reply(e.status, { error: e.message });
      console.error(e);
      return reply(500, { error: '잠시 문제가 생겼어요. 다시 해 주세요' });
    }
  },
  // 검사용 (tests/worker.test.js). Workers 런타임은 default 말고 다른 export(글자·객체)가 있으면 시작하지 않아서 여기에 둠
  LIMITS, MENU_PROMPT, MENU_SCHEMA, verifyIdToken, today, menuItems,
};
