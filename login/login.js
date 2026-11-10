'use strict';
// 로그인 화면: 로그인 · 처음 가입 · (로그인한 뒤) 내 계정 — PIN 바꾸기 · 로그아웃
// 계정 동작은 js/session.js, 계산은 js/account-core.js

const app = $('app');

// 다 되면 돌아갈 곳: ?next=/KNUmed_lounge/events/ (같은 사이트 주소만)
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '';
  return n.startsWith('/') && !n.startsWith('//') ? n : LOUNGE_ROOT;
}

// 입력 부품(field, textInput, pinInput, msgBox, say, busy)은 js/form.js

// ---------- 로그인 안 함: 로그인 · 처음 가입 ----------
function renderSignedOut(mode = 'in') {
  const seg = h('div', 'seg wide');
  for (const [m, label] of [['in', '로그인'], ['up', '처음 가입']]) {
    const b = button(label, () => renderSignedOut(m), m === mode ? 'on' : '');
    seg.append(b);
  }
  const panel = h('section', 'panel stack');
  const form = h('form', 'form');
  const msg = msgBox();
  const email = textInput('email', { autocomplete: 'username', inputMode: 'email', placeholder: '친목회 공지를 받는 메일', required: true });
  const pin = pinInput(mode === 'in' ? 'current-password' : 'new-password');
  const go = h('button', 'btn primary', mode === 'in' ? '들어가기' : '가입하고 들어가기');
  go.type = 'submit';
  const actions = h('div', 'form-actions');
  actions.append(go);

  if (mode === 'in') {
    form.append(field('메일', email), field('PIN', pin.wrap), msg, actions);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      say(msg, pinProblem(pin.input.value) || (isEmail(normEmail(email.value)) ? '' : '메일 주소를 다시 확인해 주세요'));
      if (!msg.hidden) return;
      try {
        await busy(go, '들어가는 중…', async () => {
          const s = await account.signIn(email.value, pin.input.value);
          if (!s.member) return renderSignedIn(s); // 가입을 덜 마침 → 가입 코드 받기
          location.href = nextUrl();
        });
      } catch (err) { say(msg, authMessage(err)); }
    });
    panel.append(form, h('p', 'hint', 'PIN을 잊으셨으면 관리자에게 초기화를 부탁해 주세요. 처음 오셨으면 위의 ‘처음 가입’을 눌러 주세요.'));
  } else {
    const code = textInput('text', { autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: '공지 메일에 있어요' });
    form.append(
      field('메일', email, '기초친목회 공지를 받는 주소로 해 주세요'),
      field('가입 코드', code),
      field('PIN 정하기', pin.wrap, '규칙 없어요. 숫자 4자리도 돼요. 이 기기에서는 다음부터 로그인이 그대로 유지돼요'),
      msg, actions,
    );
    form.addEventListener('submit', async e => {
      e.preventDefault();
      say(msg, (isEmail(normEmail(email.value)) ? '' : '메일 주소를 다시 확인해 주세요') || (normCode(code.value) ? '' : '가입 코드를 넣어 주세요') || pinProblem(pin.input.value));
      if (!msg.hidden) return;
      try {
        await busy(go, '가입하는 중…', async () => {
          await account.signUp(email.value, code.value, pin.input.value);
          location.href = nextUrl();
        });
      } catch (err) { say(msg, err.code ? authMessage(err) : err.message); }
    });
    panel.append(form);
  }
  panel.prepend(seg);
  app.replaceChildren(panel);
  email.focus();
}

// ---------- 로그인함: 내 계정 ----------
function renderSignedIn(s) {
  const panel = h('section', 'panel stack');
  const out = button('로그아웃', async () => { await account.signOut(); renderSignedOut(); }, 'btn');

  if (!s.member) { // 계정은 있는데 가입 코드를 안 넣음
    const form = h('form', 'form'), msg = msgBox();
    const code = textInput('text', { autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: '공지 메일에 있어요' });
    const go = h('button', 'btn primary', '가입 마치기');
    go.type = 'submit';
    const actions = h('div', 'form-actions');
    actions.append(go, out);
    form.append(h('p', 'hint', `${s.user.email} — 가입 코드만 넣으면 끝나요.`), field('가입 코드', code), msg, actions);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!normCode(code.value)) return say(msg, '가입 코드를 넣어 주세요');
      try { await busy(go, '확인하는 중…', async () => { await account.join(code.value); location.href = nextUrl(); }); } catch (err) { say(msg, err.code ? authMessage(err) : err.message); }
    });
    panel.append(form);
    app.replaceChildren(panel);
    code.focus();
    return;
  }

  const who = h('div', 'who');
  who.append(h('b', '', `${s.member.name} 교수님`), h('span', '', [s.member.dept, s.user.email].filter(Boolean).join(' · ')));
  panel.append(who);
  if (!s.member.active) panel.append(h('p', 'msg err', '사용이 멈춘 계정이에요. 관리자에게 알려 주세요.'));

  // PIN 바꾸기
  const pinBox = h('form', 'form');
  pinBox.hidden = true;
  const oldPin = pinInput('current-password'), newPin = pinInput('new-password'), msg = msgBox();
  const save = h('button', 'btn primary', 'PIN 바꾸기');
  save.type = 'submit';
  const pa = h('div', 'form-actions');
  pa.append(save);
  pinBox.append(field('지금 PIN', oldPin.wrap), field('새 PIN', newPin.wrap, '규칙 없어요. 숫자 4자리도 돼요'), msg, pa);
  pinBox.addEventListener('submit', async e => {
    e.preventDefault();
    say(msg, pinProblem(oldPin.input.value) || pinProblem(newPin.input.value));
    if (!msg.hidden) return;
    try {
      await busy(save, '바꾸는 중…', () => account.changePin(oldPin.input.value, newPin.input.value));
      say(msg, 'PIN을 바꿨어요', 'ok');
      oldPin.input.value = newPin.input.value = '';
    } catch (err) { say(msg, /invalid-credential|wrong-password/.test(err.code) ? '지금 PIN이 맞지 않아요' : authMessage(err)); }
  });

  const actions = h('div', 'form-actions');
  const home = h('a', 'btn primary', '라운지로');
  home.href = nextUrl();
  actions.append(home, button('PIN 바꾸기', () => { pinBox.hidden = !pinBox.hidden; if (!pinBox.hidden) oldPin.input.focus(); }, 'btn'));
  if (s.isAdmin) { const ad = h('a', 'btn', '🔧 관리자'); ad.href = `${LOUNGE_ROOT}admin/`; actions.append(ad); }
  actions.append(out);
  panel.append(actions, pinBox);
  app.replaceChildren(panel);
}

session()
  .then(s => (s.user ? renderSignedIn(s) : renderSignedOut()))
  .catch(() => { app.replaceChildren(h('p', 'msg err', '연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.')); });
