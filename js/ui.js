'use strict';
// 공용 부품: 화면 만들기 · 이 기기에 저장 · 소리·진동 · 알림
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
const svg = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
// [−] 숫자 [＋]
function stepper(value, min, max, onSet) {
  const box = h('span', 'stepper');
  const b = (label, v) => { const x = button(label, () => onSet(v), 'icon-btn small'); x.disabled = v < min || v > max; return x; };
  box.append(b('−', value - 1), h('b', '', value), b('＋', value + 1));
  return box;
}

// ---------- 이 기기에만 저장 (화면마다 localStorage 'lounge-<화면>') ----------
// 저장을 못 하는 브라우저(사생활 보호 모드 등)면 기억만 못 하고 게임은 그대로 됨
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

// ---------- 움직임·소리·진동 ----------
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (pattern = 80) => { if (navigator.vibrate) navigator.vibrate(pattern); };
// 소리를 낼지는 페이지가 정함 (게임마다 따로 기억, soundButton). 처음 소리는 누른 순간에 만들어야 폰에서 남
const sound = { on: false };
let audio = null;
function audioCtx() {
  audio = audio || new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function beep(freq, ms = 30, vol = 0.06, type = 'sine') {
  if (!sound.on) return;
  try {
    const a = audioCtx(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + ms / 1000);
  } catch { /* 소리를 못 내는 브라우저 */ }
}
const fanfare = () => { buzz(); beep(660, 140); setTimeout(() => beep(990, 200), 130); };
// 머리 줄의 🔊/🔇 단추. prefs = store(...) (sound 칸에 기억)
function soundButton(prefs) {
  sound.on = !!prefs.get().sound;
  const b = button('', () => {
    sound.on = !sound.on;
    prefs.set({ sound: sound.on });
    if (sound.on) beep(880, 60); // 켤 때 한 번 (누른 순간이라 폰도 소리가 열림)
    paint();
  }, 'btn small');
  const paint = () => { b.textContent = sound.on ? '🔊 소리 켬' : '🔇 소리 끔'; };
  paint();
  return b;
}
