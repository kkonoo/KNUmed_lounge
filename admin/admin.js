'use strict';
// 관리자 화면: 처음 설정 · 명단 · 관리자 · 가입 코드 · 기록
// 데이터는 admin-db.js, 계산은 js/account-core.js, 입력 부품은 js/form.js

const app = $('app');
const CONSOLE_USERS = 'https://console.firebase.google.com/project/knumed-lounge/authentication/users';
let S = null, D = null, tab = 'roster', find = '', editing = '';

const fmtTime = ms => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const fail = (msg, e) => { console.error(e); toast(`${msg}: ${authMessage(e)}`, 3500); };

async function start() {
  try { S = await session(); } catch (e) {
    console.error(e);
    app.replaceChildren(h('p', 'msg err', '연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.'));
    return;
  }
  if (S.setupNeeded) return renderSetup();
  if (!S.user) return goLogin();
  mountAccountChip(S);
  if (!S.isAdmin) {
    app.replaceChildren(h('p', 'msg err', '관리자만 볼 수 있는 화면이에요.'));
    return;
  }
  adminDb.setMe(S.user.uid, S.member?.name || S.user.email);
  await reload();
}
async function reload() {
  try { D = await adminDb.loadAll(); } catch (e) { fail('읽지 못했어요', e); return; }
  render();
}

// ---------- 처음 설정 (관리자가 아무도 없을 때 한 번) ----------
function renderSetup() {
  const panel = h('section', 'panel stack');
  const form = h('form', 'form'), msg = msgBox();
  const name = textInput('text', { maxLength: 20, placeholder: '홍길동' });
  const dept = textInput('text', { maxLength: 30, placeholder: '분자의학교실' });
  const email = textInput('email', { autocomplete: 'username', placeholder: '친목회 공지를 받는 메일' });
  const pin = pinInput('new-password');
  const code = textInput('text', { value: suggestCode(), autocapitalize: 'off', spellcheck: false });
  const go = h('button', 'btn primary', '첫 관리자로 시작하기');
  go.type = 'submit';
  const actions = h('div', 'form-actions');
  actions.append(go);
  form.append(
    h('p', 'hint', '아직 관리자가 없어요. 처음 한 번만 하는 설정이에요. 여기서 만드는 계정이 첫 관리자가 되고, 그다음부터 이 화면은 잠겨요.'),
    field('이름', name), field('교실', dept), field('메일', email), field('PIN 정하기', pin.wrap, '관리자 PIN은 조금 길게 하시길 권해요'),
    field('가입 코드', code, '교수님들이 처음 가입할 때 넣는 코드예요. 공지 메일에 넣어 보내요. 나중에 바꿀 수 있어요'),
    msg, actions,
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    say(msg, (name.value.trim() ? '' : '이름을 넣어 주세요') || (isEmail(normEmail(email.value)) ? '' : '메일 주소를 다시 확인해 주세요') || pinProblem(pin.input.value) || codeProblem(code.value));
    if (!msg.hidden) return;
    try {
      await busy(go, '설정하는 중…', () => adminDb.setup({ name: name.value.trim(), dept: dept.value.trim(), email: email.value, pin: pin.input.value, code: code.value }));
      toast('첫 관리자가 됐어요');
      start();
    } catch (err) { say(msg, err.code ? authMessage(err) : err.message); }
  });
  panel.append(h('h2', '', '처음 설정'), form);
  app.replaceChildren(panel);
}

// ---------- 틀 ----------
function render() {
  const tabs = h('div', 'seg tabs');
  for (const [t, label] of [['roster', '명단'], ['admins', '관리자'], ['code', '가입 코드'], ['log', '기록']]) {
    tabs.append(button(label, () => { tab = t; render(); }, t === tab ? 'on' : ''));
  }
  const body = h('div', '');
  app.replaceChildren(tabs, body);
  ({ roster: renderRoster, admins: renderAdmins, code: renderCode, log: renderLog })[tab](body);
}

// ---------- 명단 ----------
function renderRoster(body) {
  const { rows, count } = rosterView(D.roster, D.members);

  const summary = h('div', 'summary');
  const n = (label, v) => { const s = h('span'); s.append(`${label} `, h('b', '', v)); return s; };
  summary.append(n('명단', count.all), n('가입', count.joined), n('아직', count.waiting), n('멈춤', count.stopped));
  if (count.waiting) {
    summary.append(withIcon(button('아직 안 한 분 메일 복사', () => copyText(rows.filter(r => r.state === 'waiting').map(r => r.email).join(', '), `${count.waiting}분 메일을 복사했어요`), 'btn small'), 'copy'));
  }

  // 붙여 넣어 넣기
  const paste = h('details', 'paste');
  if (D.roster.length <= 1) paste.open = true; // 처음(관리자 한 분뿐)엔 열어 둠
  paste.append(h('summary', '', '명단 붙여 넣기'));
  const pform = h('div', 'form');
  const ta = h('textarea');
  ta.rows = 5;
  ta.placeholder = "메일 받는 사람 칸을 그대로 붙여 넣어도 돼요\n홍길동 교수님 <hong@knu.ac.kr>, 김철수 교수님 <kim@knu.ac.kr>\n또는 한 줄에 한 분: 홍길동, hong@knu.ac.kr, 생리학교실";
  const grp = select([['기초', '기초'], ['임상', '임상']], '기초');
  const preview = h('div', 'preview');
  const put = button('명단에 넣기', null, 'btn primary');
  put.hidden = true;
  let parsed = null;
  const look = () => {
    parsed = parseRoster(ta.value);
    const have = new Set(D.roster.map(r => r.email));
    const fresh = parsed.rows.filter(r => !have.has(r.email)).length;
    preview.replaceChildren();
    if (!ta.value.trim()) { put.hidden = true; return; }
    const p = h('p', '', '');
    p.append(h('b', '', `${parsed.rows.length}분`), `을 읽었어요 (새로 ${fresh} · 이미 있음 ${parsed.rows.length - fresh})`);
    preview.append(p);
    if (parsed.bad.length) {
      const ul = h('ul', 'bad');
      for (const b of parsed.bad.slice(0, 8)) ul.append(h('li', '', `못 읽음: ${b}`));
      preview.append(ul);
    }
    put.hidden = !parsed.rows.length;
    put.textContent = `${parsed.rows.length}분 명단에 넣기`;
  };
  ta.addEventListener('input', look);
  put.addEventListener('click', async () => {
    try {
      const r = await busy(put, '넣는 중…', () => adminDb.addRoster(parsed.rows, grp.value, D.roster));
      toast(`새로 ${r.added}분, 고침 ${r.changed}분`);
      ta.value = '';
      await reload();
    } catch (e) { fail('넣지 못했어요', e); }
  });
  const acts = h('div', 'form-actions');
  acts.append(put);
  pform.append(field('붙여 넣기', ta, '교실은 비워 둬도 돼요. 나중에 고치기로 넣을 수 있어요'), field('구분', grp), preview, acts);
  paste.append(pform);

  const search = textInput('search', { value: find, placeholder: '이름·메일·교실로 찾기' });
  search.addEventListener('input', () => { find = search.value; paintRows(); });

  const list = h('div', 'rows');
  const paintRows = () => {
    const q = find.trim().toLowerCase();
    const shown = rows.filter(r => !q || `${r.name} ${r.email} ${r.dept}`.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map(rosterRow) : [h('p', 'empty-note', D.roster.length ? '맞는 분이 없어요' : '아직 명단이 비어 있어요. 위에서 붙여 넣어 주세요.')]));
  };
  paintRows();
  const top = h('div', 'stack');
  top.append(summary, paste, search, list);
  body.append(top);
}

function rosterRow(r) {
  const row = h('div', 'r-row');
  if (editing === r.email) return editRow(r, row);
  const who = h('div', 'r-who');
  const name = h('b', '', r.name);
  name.append(h('small', '', [r.dept, r.group === '임상' ? '임상' : ''].filter(Boolean).join(' · ')));
  who.append(name, h('span', '', r.email));
  const badge = h('span', `badge ${r.state}`, { joined: '가입함', waiting: '아직', stopped: '멈춤' }[r.state]);
  const acts = h('div', 'r-acts');
  acts.append(button('고치기', () => { editing = r.email; render(); }, 'btn small'));
  acts.append(button(r.state === 'stopped' ? '다시 쓰기' : '멈추기', async () => {
    const on = r.state === 'stopped';
    if (!on && !confirmBox(`${r.name} 교수님 계정을 멈출까요? 그 순간부터 로그인해도 아무것도 못 봐요.`)) return;
    try { await adminDb.setActive(r.email, on, r.mems, r.name); await reload(); } catch (e) { fail('바꾸지 못했어요', e); }
  }, 'btn small'));
  if (r.state === 'joined') acts.append(button('PIN 초기화', () => pinResetHelp(r), 'btn small'));
  if (r.mems.length > 1) {
    acts.append(button(`예전 계정 ${r.mems.length - 1}개 정리`, async () => {
      try { for (const m of r.mems.slice(1)) await adminDb.removeMember(m.uid, `${r.name} (${r.email})`); toast('정리했어요'); await reload(); } catch (e) { fail('정리하지 못했어요', e); }
    }, 'btn small'));
  }
  acts.append(button('지우기', async () => {
    if (!confirmBox(`${r.name} 교수님을 명단에서 지울까요? 가입 정보도 같이 지워져요.`)) return;
    try { await adminDb.removeRoster(r.email, r.mems, r.name); await reload(); } catch (e) { fail('지우지 못했어요', e); }
  }, 'btn small danger'));
  row.append(who, badge, acts);
  return row;
}

function editRow(r, row) {
  row.classList.add('editing');
  const form = h('form', 'form');
  const name = textInput('text', { value: r.name, maxLength: 20 });
  const dept = textInput('text', { value: r.dept || '', maxLength: 30, placeholder: '예: 생리학교실' });
  const grp = select([['기초', '기초'], ['임상', '임상']], r.group);
  const two = h('div', 'row2');
  two.append(field('이름', name), field('구분', grp));
  const save = h('button', 'btn primary', '저장');
  save.type = 'submit';
  const acts = h('div', 'form-actions');
  acts.append(save, button('취소', () => { editing = ''; render(); }, 'btn'));
  form.append(h('p', 'hint', r.email), two, field('교실', dept), acts);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!name.value.trim()) return toast('이름을 넣어 주세요');
    try {
      await busy(save, '저장 중…', () => adminDb.editRoster(r.email, { name: name.value.trim(), dept: dept.value.trim(), group: grp.value }, r.mems));
      editing = '';
      await reload();
    } catch (err) { fail('저장하지 못했어요', err); }
  });
  row.append(form);
  setTimeout(() => name.focus());
  return row;
}

// PIN 초기화: Worker를 붙이기 전까지는 Firebase 콘솔에서 로그인 계정을 지우고 다시 가입
function pinResetHelp(r) {
  const dlg = h('dialog');
  dlg.append(
    h('h2', '', `${r.name} 교수님 PIN 초기화`),
    h('p', '', '지금은 Firebase 콘솔에서 해요.'),
  );
  const ol = h('ol', 'hint');
  for (const s of [
    `Firebase 콘솔 › Authentication › 사용자에서 ${r.email} 을 찾아 ⋮ › 계정 삭제`,
    '교수님께 “처음 가입”에서 새 PIN으로 다시 가입하시라고 알려 드려요 (가입 코드는 지금 코드)',
    '다시 가입하시면 이 명단에 ‘예전 계정 정리’ 단추가 생겨요. 눌러서 정리해요',
  ]) ol.append(h('li', '', s));
  const go = h('a', 'btn primary', 'Firebase 콘솔 열기');
  Object.assign(go, { href: CONSOLE_USERS, target: '_blank', rel: 'noopener' });
  const acts = h('div', 'dialog-actions');
  acts.append(withIcon(button('메일 복사', () => copyText(r.email), 'btn'), 'copy'), go, button('닫기', () => dlg.close(), 'btn'));
  dlg.append(ol, acts);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- 관리자 ----------
function renderAdmins(body) {
  const byUid = new Map(D.members.map(m => [m.uid, m]));
  const list = h('div', 'rows');
  for (const uid of D.admins) {
    const m = byUid.get(uid);
    const row = h('div', 'r-row');
    const who = h('div', 'r-who');
    const name = h('b', '', m ? m.name : '(가입 정보 없음)');
    if (uid === S.user.uid) name.append(h('small', '', '나'));
    who.append(name, h('span', '', m ? m.email : uid));
    const off = button('해제', async () => {
      if (!confirmBox(`${m ? m.name : uid} 교수님을 관리자에서 뺄까요?${uid === S.user.uid ? ' 나를 빼면 이 화면을 더 못 봐요.' : ''}`)) return;
      try {
        await adminDb.setAdmins(D.admins.filter(x => x !== uid), '관리자 해제', m ? `${m.name} (${m.email})` : uid);
        if (uid === S.user.uid) { location.href = LOUNGE_ROOT; return; }
        await reload();
      } catch (e) { fail('바꾸지 못했어요', e); }
    }, 'btn small');
    off.disabled = !canRemoveAdmin(D.admins, uid);
    if (off.disabled) off.title = '마지막 관리자는 뺄 수 없어요. 다른 분을 먼저 지정해 주세요';
    row.append(who, off);
    list.append(row);
  }

  const candidates = D.members.filter(m => m.active && !D.admins.includes(m.uid)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const add = h('div', 'form');
  if (candidates.length) {
    const pick = select(candidates.map(m => [m.uid, `${m.name} · ${m.dept || m.email}`]), candidates[0].uid);
    const go = button('관리자로 지정', async () => {
      const m = candidates.find(x => x.uid === pick.value);
      try { await adminDb.setAdmins([...D.admins, m.uid], '관리자 지정', `${m.name} (${m.email})`); toast(`${m.name} 교수님을 관리자로 지정했어요`); await reload(); } catch (e) { fail('지정하지 못했어요', e); }
    }, 'btn primary');
    const row = h('div', 'inline');
    row.append(pick, go);
    add.append(field('관리자 더하기', row, '가입을 마친 교수님 중에서 골라요'));
  } else {
    add.append(h('p', 'hint', '관리자로 지정할 수 있는 교수님이 아직 없어요. 가입을 마친 분만 지정할 수 있어요.'));
  }
  const wrap = h('div', 'stack');
  wrap.append(list, add, h('p', 'hint', '관리자는 명단·계정·가입 코드·친목회를 고칠 수 있어요. 마지막 한 분은 뺄 수 없어요.'));
  body.append(wrap);
}

// ---------- 가입 코드 ----------
function renderCode(body) {
  const wrap = h('div', 'stack');
  const now = h('div', 'code-now');
  now.append(h('b', '', D.code || '(없음)'), withIcon(button('복사', () => copyText(D.code), 'btn small'), 'copy'));

  const input = textInput('text', { placeholder: '새 코드', autocapitalize: 'off', spellcheck: false });
  const dice = withIcon(button('', () => { input.value = suggestCode(); }, 'btn icon-only'), 'dices');
  dice.title = '아무 코드나 만들기';
  const save = button('바꾸기', async () => {
    const p = codeProblem(input.value);
    if (p) return toast(p);
    if (!confirmBox('가입 코드를 바꿀까요? 이미 가입한 분들은 그대로이고, 새로 가입하는 분만 새 코드를 넣어요.')) return;
    try { await adminDb.setCode(input.value); toast('바꿨어요'); await reload(); } catch (e) { fail('바꾸지 못했어요', e); }
  }, 'btn primary');
  const row = h('div', 'inline');
  row.append(input, dice, save);

  const notice = signupNotice(LOUNGE_ROOT, D.code);
  const pre = h('pre', 'notice', notice);
  wrap.append(
    block('지금 가입 코드', now, '처음 가입할 때만 써요. 한 번 가입하면 다시 안 넣어요'),
    field('코드 바꾸기', row),
    block('공지 메일에 붙일 문구', pre),
  );
  const acts = h('div', 'form-actions');
  acts.append(withIcon(button('문구 복사', () => copyText(notice), 'btn'), 'copy'));
  wrap.append(acts);
  body.append(wrap);
}

// ---------- 기록 ----------
async function renderLog(body) {
  const list = h('div', 'rows');
  list.append(h('p', 'hint', '불러오는 중…'));
  body.append(list);
  try {
    const logs = await adminDb.logs();
    list.replaceChildren(...(logs.length ? logs.map(l => {
      const row = h('div', 'log-row');
      row.append(h('time', '', fmtTime(l.at)), h('span', 'by', l.byName), h('span', '', [l.action, l.target].filter(Boolean).join(' · ')));
      return row;
    }) : [h('p', 'empty-note', '아직 기록이 없어요')]));
  } catch (e) { fail('기록을 읽지 못했어요', e); }
}

start();
