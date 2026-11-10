'use strict';
// 입력 화면 부품 (로그인 · 관리자 · 친목회). 모양은 css/style.css(입력), 기본 부품(h, button, toast)은 js/ui.js

function field(label, input, hint) {
  const f = h('label', 'field');
  f.append(h('span', '', label), input);
  if (hint) f.append(h('small', '', hint));
  return f;
}
// 입력칸이 아닌 내용(단추·글)을 담는 칸: <label>로 감싸면 글자를 눌러도 단추가 눌려서 <div>로
function block(label, content, hint) {
  const f = h('div', 'field');
  f.append(h('span', '', label), content);
  if (hint) f.append(h('small', '', hint));
  return f;
}
function textInput(type, opts = {}) {
  const i = h('input', 'text-input');
  Object.assign(i, { type, ...opts });
  return i;
}
// PIN 칸: 가려서 쓰고 👁로 잠깐 보기
function pinInput(autocomplete) {
  const wrap = h('div', 'pin-wrap');
  const i = textInput('password', { autocomplete, maxLength: PIN_MAX, placeholder: '예: 1234' });
  const eye = button('👁', () => { i.type = i.type === 'password' ? 'text' : 'password'; }, 'icon-btn small');
  eye.title = 'PIN 보기';
  wrap.append(i, eye);
  return { wrap, input: i };
}
function select(options, value) {
  const s = h('select');
  for (const [v, label] of options) {
    const o = h('option', '', label);
    o.value = v;
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}
const msgBox = () => { const m = h('p', 'msg'); m.hidden = true; return m; };
function say(m, text, kind = 'err') { m.className = `msg ${kind}`; m.textContent = text; m.hidden = !text; }

// 누르는 동안 단추 막기
async function busy(btn, label, fn) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = was; }
}

// 글 복사 (못 하면 창에 띄워서 직접 복사)
async function copyText(text, done = '복사했어요') {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { prompt('복사해서 쓰세요', text); }
}

// 묻고 진행 (예/아니오)
function confirmBox(text) { return confirm(text); }
