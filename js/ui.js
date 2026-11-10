'use strict';
// 공용 부품: 화면 만들기 · 이 기기에 저장 · 알림
// toy_box js/ui.js에서 가져옴 (원래 살림노트 everyday_notes)

// ---------- 화면 만들기 ----------
const $ = id => document.getElementById(id);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(label, onClick, cls = 'btn') {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
// 글자 앞에 Lucide 아이콘 (js/icons.js)
function withIcon(el, name) { el.prepend(icon(name)); return el; }
// ---------- 이 기기에만 저장 (화면마다 localStorage 'lounge-<화면>') ----------
// 저장을 못 하는 브라우저(사생활 보호 모드 등)면 기억만 못 하고 화면은 그대로 됨
function store(key, defaults) {
  const k = `lounge-${key}`;
  let v = { ...defaults };
  try { v = { ...defaults, ...JSON.parse(localStorage.getItem(k)) }; } catch { /* 처음 또는 못 읽음 */ }
  return {
    get: () => v,
    set(patch) {
      v = { ...v, ...patch };
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 못 씀 */ }
    },
  };
}

// ---------- 알림 ----------
let toastTimer;
function toast(text, ms = 2000) {
  let t = $('toast');
  if (!t) { t = h('div', 'toast'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
