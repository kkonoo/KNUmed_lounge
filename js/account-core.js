'use strict';
// 계정 계산 (화면 없음): 로그인·가입·관리자 화면이 쓰고, tests/account.test.js 가 Node에서 확인

// 메일 주소: 앞뒤 공백 빼고 소문자 (Firebase도 소문자로 저장하고, 명단 문서 이름도 소문자)
const normEmail = s => String(s || '').trim().toLowerCase();
const isEmail = s => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);

// PIN → Firebase 비밀번호. 규칙 없음(숫자 4자리도 됨). Firebase가 6자 이상만 받아서 앞뒤에 정해진 글자를 붙임
// ⚠️ 이 모양을 바꾸면 모든 교수님의 PIN이 안 맞게 돼요. 바꾸지 마세요 (worker/에서도 같은 계산)
const PIN_MAX = 40;
const cleanPin = s => String(s ?? '').trim();
const pinToPassword = pin => `lounge:${cleanPin(pin)}:knumed`;
const pinProblem = pin => (!cleanPin(pin) ? 'PIN을 넣어 주세요' : cleanPin(pin).length > PIN_MAX ? `PIN은 ${PIN_MAX}자까지예요` : '');

// 가입 코드: 띄어쓰기 빼고 소문자 (친목회 공지 메일에서 옮겨 적을 때 대소문자·공백이 달라도 맞게)
const normCode = s => String(s || '').replace(/\s+/g, '').toLowerCase();
// 관리자가 정할 때: 영어 소문자·숫자·한글 2~20자 (firestore.rules와 같은 규칙)
const codeProblem = s => (/^[a-z0-9가-힣]{2,20}$/.test(normCode(s)) ? '' : '가입 코드는 영어·숫자·한글로 2~20자예요');
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // 헷갈리는 i l o 0 1 뺌
function suggestCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

// 명단 붙여 넣기: 메일 프로그램 받는 사람 칸을 그대로 복사한 것도, 한 줄에 한 분씩 쓴 것도 받음
//   '홍길동 교수님 <hong@example.kr>, 김철수 교수님 <…>'   (줄바꿈·쉼표·글머리 * - 상관없음)
//   '홍길동, hong@knu.ac.kr, 생리학교실'                  (이름·메일·교실, 쉼표나 탭으로)
// → { rows: [{ name, email, dept }], bad: [못 읽은 줄] }. 같은 메일은 한 번만
const cleanName = s => String(s || '').replace(/^[\s*\-•·"'“”]+|[\s"'“”]+$/g, '').replace(/\s*(교수님|교수|선생님|님)$/, '').trim();
function parseRoster(text) {
  const rows = [], bad = [], seen = new Set();
  const add = (name, email, dept = '') => {
    email = normEmail(email);
    name = cleanName(name);
    if (!isEmail(email) || !name) return false;
    if (!seen.has(email)) { seen.add(email); rows.push({ name, email, dept: String(dept).trim() }); }
    return true;
  };
  const src = String(text || '');
  const angled = [...src.matchAll(/([^<>,;\n]*?)<\s*([^<>\s]+)\s*>/g)];
  if (angled.length) {
    for (const [whole, name, email] of angled) if (!add(name, email)) bad.push(whole.trim());
    return { rows, bad };
  }
  for (const line of src.split('\n').map(l => l.trim()).filter(Boolean)) {
    const parts = line.split(/[,\t]/).map(p => p.trim()).filter(Boolean);
    const email = parts.find(p => isEmail(normEmail(p)));
    const rest = parts.filter(p => p !== email);
    const dept = rest.find(p => /교실$|센터$/.test(p)) || '';
    const name = rest.find(p => p !== dept) || '';
    if (!email || !add(name, email, dept)) bad.push(line);
  }
  return { rows, bad };
}

// 관리자 화면 명단: 명단마다 그 메일로 가입한 회원 문서(새것부터)와 상태를 붙임
//   state: 'joined' 가입함 · 'waiting' 아직 · 'stopped' 멈춤
function rosterView(roster, members) {
  const byEmail = new Map();
  for (const m of members) {
    const e = normEmail(m.email);
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(m);
  }
  const rows = roster.map(r => {
    const mems = (byEmail.get(r.email) || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    return { ...r, mems, state: r.status !== 'active' ? 'stopped' : mems.length ? 'joined' : 'waiting' };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const count = { all: rows.length, joined: 0, waiting: 0, stopped: 0 };
  for (const r of rows) count[r.state]++;
  return { rows, count };
}

// 공지 메일에 붙일 가입 안내
const signupNotice = (url, code) =>
  `경북의대 라운지: ${url}\n처음이시면 '처음 가입'에서 이 메일 주소, 가입 코드 ${code}, PIN(숫자 4자리도 돼요)을 넣어 주세요. 한 번 로그인하면 그 기기에서는 계속 유지돼요.`;

// 관리자 해제: 마지막 한 분은 못 내림 (firestore.rules도 같은 규칙)
const canRemoveAdmin = (uids, uid) => uids.includes(uid) && uids.length > 1;

// Firebase 오류 → 교수님이 읽을 말
function authMessage(err) {
  const code = err?.code || err?.message || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return '메일 주소나 PIN이 맞지 않아요';
  if (/too-many-requests/.test(code)) return '여러 번 틀려서 잠시 막혔어요. 몇 분 뒤에 다시 해 주세요';
  if (/network-request-failed|unavailable/.test(code)) return '인터넷 연결을 확인해 주세요';
  if (/operation-not-allowed/.test(code)) return '아직 로그인을 쓸 수 없어요. 관리자에게 알려 주세요 (Firebase에서 이메일/비밀번호 로그인이 꺼져 있음)';
  if (/invalid-email/.test(code)) return '메일 주소를 다시 확인해 주세요';
  if (/permission-denied|insufficient permissions/i.test(code)) return '권한이 없어요';
  return '잠시 문제가 생겼어요. 다시 해 주세요';
}
