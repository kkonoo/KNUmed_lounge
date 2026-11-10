'use strict';
// 주문 모으기: 친목회마다 카페·식당 주문판. 장난감 상자 주문 모으기와 같은 모양
//   메뉴를 적고(지난번 메뉴가 미리 채워짐) → 메뉴마다 ＋ 추가 / − 취소 → 개수는 바를 정(正)과 숫자로
//   커피처럼 나누는 메뉴는 아이스 · 따뜻한을 따로(하나만 되는 메뉴는 그 하나만)
//   개수는 Firestore에 같이 쌓여서, 각자 폰으로 눌러도 되고 폰 한 대를 돌려도 돼요
//   관리자가 친목회에 메뉴를 미리 넣어 두었으면(cafeMenu·meals) 그 메뉴로 바로 세기 화면이 열려요
// 데이터는 order-db.js, 계산은 order-core.js (장난감 상자에서 가져옴)

const app = $('app');
const query = new URLSearchParams(location.search);
const eid = query.get('e') || '';
let kind = BOARDS[query.get('k')] ? query.get('k') : 'cafe';
let S = null, ev = null, board, stopBoard = null, lastText = '';
let editing = false; // 메뉴 고치는 중 (메뉴가 있어도 적는 화면)
let only = false; // 주문한 것만 보기
let draft = null; // 메뉴 칸에 적던 글 (다른 폰에서 개수가 바뀌어 다시 그려도 그대로)
let fresh = ''; // 방금 ＋한 칸 (正 마지막 획을 그려지듯)
// 正 쓰는 순서: 위 가로 → 가운데 세로 → 가운데 짧은 가로 → 왼쪽 세로 → 아래 가로 (20×20 칸)
const STROKES = [[3, 3, 17, 3], [10, 3, 10, 17], [10, 10, 15, 10], [5, 10, 5, 17], [2, 17, 18, 17]];
const TEMP_LABEL = { ice: ['snowflake', '아이스'], hot: ['flame', '따뜻한'] };

const fail = (msg, e) => { console.error(e); toast(`${msg}: ${authMessage(e)}`, 3500); };
const stop = text => app.replaceChildren(h('p', 'msg err', text));
const svgEl = (tag, attrs) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch { /* 진동 없음 */ } };
const eventMenu = () => parseMenu(((kind === 'cafe' ? ev?.cafeMenu : ev?.meals) || []).join('\n'));
const menuOf = () => board?.menu || (board ? [] : eventMenu());
const countsOf = () => board?.counts || {};

async function start() {
  try { S = await session(); } catch (e) { console.error(e); return stop('연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.'); }
  if (!S.user) return goLogin();
  mountAccountChip(S);
  if (!S.isAdmin && !isActiveMember(S)) return stop(S.member ? '사용이 멈춘 계정이에요. 관리자에게 알려 주세요.' : '가입을 마쳐야 볼 수 있어요.');
  if (!eid) return stop('어느 친목회 주문판인지 모르겠어요. 기초친목회에서 들어와 주세요.');
  try { ev = await orderDb.event(eid); } catch (e) { console.error(e); return stop(`읽지 못했어요: ${authMessage(e)}`); }
  if (!ev) return stop('지워졌거나 없는 친목회예요.');
  listen();
}

function listen() {
  stopBoard?.();
  stopBoard = null;
  board = undefined;
  render();
  const k = kind;
  orderDb.lastMenu(k).then(t => { lastText = t; if (k === kind && !board) render(); }).catch(e => console.error(e));
  orderDb.watch(eid, k, b => {
    if (k !== kind) return;
    board = b;
    if (document.activeElement?.id === 'menuText') return; // 메뉴를 적는 중이면 다시 그리지 않음
    render();
  }, e => fail('주문판을 읽지 못했어요', e)).then(s => { if (k === kind) stopBoard = s; else s(); });
}
function switchKind(k) {
  if (k === kind) return;
  kind = k;
  editing = only = false;
  draft = null;
  history.replaceState(null, '', `?e=${encodeURIComponent(eid)}&k=${k}`);
  listen();
}

function render() {
  document.querySelector('.topbar h1').textContent = BOARDS[kind].label;
  const head = h('p', 'order-event');
  head.append(h('b', '', ev.title), ` · ${whenText(ev)}`);
  const tabs = h('div', 'seg wide order-kinds');
  for (const [k, b] of Object.entries(BOARDS)) tabs.append(withIcon(button(b.label, () => switchKind(k), k === kind ? 'on' : ''), b.icon));
  const body = board === undefined ? h('p', 'hint', '불러오는 중…') : editing || !menuOf().length ? menuPanel() : countPanel();
  app.replaceChildren(head, tabs, body);
  fresh = '';
}

// ---------- 1. 메뉴 정하기 ----------
function menuPanel() {
  const panel = h('section', 'panel order-panel'), ta = h('textarea'), info = h('p', 'hint');
  const has = menuOf().length > 0;
  const fromLast = draft == null && !has && !!lastText;
  const go = button(has ? '이 메뉴로 세기' : '주문 받기 시작', () => startCounting(ta.value), 'btn primary big');
  Object.assign(ta, { id: 'menuText', rows: 10, value: draft ?? (has ? menuOf().join('\n') : lastText) });
  ta.placeholder = kind === 'cafe'
    ? '한 줄에 메뉴 하나씩\n아메리카노 (아이스/따뜻한)\n아인슈페너 (아이스만)\n자몽에이드\n…'
    : '한 줄에 메뉴 하나씩\n김치찌개\n된장찌개\n…';
  ta.setAttribute('aria-label', '메뉴');
  const check = () => {
    const n = parseMenu(ta.value).length;
    info.textContent = n ? `메뉴 ${n}개` : '메뉴를 한 줄에 하나씩 적어요.';
    go.disabled = !n;
  };
  ta.addEventListener('input', () => { draft = ta.value; check(); });
  check();
  const ph = h('div', 'panel-head');
  ph.append(h('h2', '', '메뉴'));
  if (ta.value.trim()) ph.append(button('비우기', () => { draft = ''; render(); }, 'btn small'));
  panel.append(ph);
  if (fromLast) panel.append(h('p', 'hint', '지난번 메뉴를 불러왔어요. 오늘 메뉴에 맞게 고쳐 주세요.'));
  const photo = menuPhotoButton(() => ta.value, v => { draft = ta.value = v; check(); });
  panel.append(ta);
  if (photo) panel.append(photo);
  panel.append(info, go);
  if (kind === 'cafe') panel.append(h('p', 'hint', '아이스와 따뜻한을 나눠 셀 메뉴는 이름 끝에 (아이스/따뜻한), 하나만 되는 메뉴는 (아이스만)이나 (따뜻한만)을 붙여요. HOT/ICE, ICE ONLY라고 적어도 돼요.'));
  if (has) panel.append(button('고치지 않고 돌아가기', () => { editing = false; draft = null; render(); }, 'btn'));
  return panel;
}
async function startCounting(text) {
  const menu = parseMenu(text), { counts, dropped } = keepCounts(countsOf(), menu);
  if (dropped.length && !confirm(`지운 메뉴의 주문도 같이 지워져요.\n${dropped.map(([name, n]) => `${name} ${n}`).join('\n')}`)) return;
  try {
    await orderDb.setMenu(eid, kind, menu, counts);
    editing = false;
    draft = null;
    scrollTo(0, 0);
  } catch (e) { fail('메뉴를 저장하지 못했어요', e); }
}

// ---------- 2. 세기: 메뉴마다 ＋ 추가 / − 취소 ----------
function countPanel() {
  const menu = menuOf(), counts = countsOf(), b = BOARDS[kind];
  const panel = h('section', 'panel order-panel'), top = h('div', 'order-top'), seg = h('div', 'seg'), list = h('ul', 'order-list');
  const total = totalOf(counts), ordered = menu.filter(line => entryTotal(line, counts) > 0);
  seg.append(
    button('전체 메뉴', () => { only = false; render(); }, only ? '' : 'on'),
    button(`주문한 것만 ${ordered.length}`, () => { only = true; render(); }, only ? 'on' : ''),
  );
  top.append(h('b', 'order-total', `모두 ${total}${b.unit}`), seg);
  const lines = only ? ordered : menu;
  list.append(...lines.map(line => menuRow(line, counts)));
  if (!lines.length) list.append(h('li', 'order-empty', '아직 주문이 없어요'));

  const adder = h('form', 'order-adder'), inp = h('input', 'text-input'), add = h('button', 'btn', '＋ 넣기');
  inp.placeholder = '메뉴에 없는 것 주문하기';
  inp.setAttribute('aria-label', '메뉴에 없는 것 주문하기');
  adder.append(inp, add);
  adder.addEventListener('submit', e => { e.preventDefault(); addMenu(inp.value); });

  const btns = h('div', 'form-actions');
  const copy = withIcon(button('주문 복사', () => copyText(orderText(menu, counts, kind), '주문을 복사했어요'), 'btn'), 'copy');
  const clear = button('개수 모두 지우기', clearCounts, 'btn');
  copy.disabled = clear.disabled = !total;
  btns.append(copy, button('메뉴 고치기', () => { editing = true; draft = null; render(); scrollTo(0, 0); }, 'btn'), clear);
  panel.append(top, h('p', 'hint', '각자 폰으로 눌러도 되고, 폰 한 대를 돌려도 돼요. 자기 메뉴의 ＋ 추가를 누르고, 잘못 눌렀으면 − 취소.'), list, adder, btns);
  return panel;
}
// 메뉴 한 줄: [이름 · 개수] 아래에 세는 칸 하나(나누는 메뉴는 아이스 · 따뜻한 둘, 아이스만이면 하나)
function menuRow(line, counts) {
  const li = h('li', 'order-row'), head = h('div', 'order-head'), keys = entryKeys(line), n = entryTotal(line, counts);
  head.append(h('b', 'order-name', readEntry(line).name), h('span', 'order-n', String(Math.max(0, n))));
  li.classList.toggle('has', n > 0);
  li.append(head);
  for (const { key, temp } of keys) {
    const c = Math.max(0, counts[key] || 0);
    const row = h('div', `order-line${temp ? ` ${temp}` : ''}${c ? ' has' : ''}`), marks = h('span', 'tally'), btns = h('span', 'order-btns');
    const minus = button('− 취소', () => change(key, -1), 'btn'), plus = button('＋ 추가', () => change(key, 1), 'btn primary');
    minus.setAttribute('aria-label', `${key} 하나 취소`);
    plus.setAttribute('aria-label', `${key} 하나 추가`);
    minus.disabled = !c;
    marks.setAttribute('aria-hidden', 'true');
    marks.append(...tallyMarks(c, key === fresh));
    btns.append(minus, plus);
    if (temp) { const t = h('span', 'temp'); t.append(icon(TEMP_LABEL[temp][0]), TEMP_LABEL[temp][1]); row.append(t); }
    if (keys.length > 1) row.append(h('span', 'order-sub', String(c)));
    row.append(marks, btns);
    li.append(row);
  }
  return li;
}
// 바를 정: 다섯 획마다 正 하나. fresh면 마지막 획이 그려지듯 나타남
function tallyMarks(n, isFresh) {
  const groups = tallyGroups(n);
  return groups.map((g, i) => {
    const s = svgEl('svg', { viewBox: '0 0 20 20' });
    for (let k = 0; k < g; k++) {
      const [x1, y1, x2, y2] = STROKES[k], l = svgEl('line', { x1, y1, x2, y2, pathLength: 1 });
      if (isFresh && i === groups.length - 1 && k === g - 1) l.classList.add('new');
      s.append(l);
    }
    return s;
  });
}
async function change(key, d) {
  if (d < 0 && !(countsOf()[key] > 0)) return;
  if (d > 0) fresh = key;
  buzz(d > 0 ? 15 : [10, 50, 10]);
  try {
    if (!board) await orderDb.setMenu(eid, kind, menuOf(), {}); // 친목회에 넣어 둔 메뉴로 처음 누를 때 판을 만듦
    await orderDb.change(eid, kind, key, d);
  } catch (e) { fail('바꾸지 못했어요', e); }
}
// 메뉴에 없는 것: 메뉴 끝에 넣고 1개 (아이스·따뜻한을 둘 다 고르는 메뉴는 어느 쪽인지 몰라서 넣기만)
async function addMenu(value) {
  const menu = menuOf(), line = parseMenu(value)[0];
  if (!line) return;
  const { name } = readEntry(line), keys = entryKeys(line), pick = keys.length > 1;
  if (menu.some(x => readEntry(x).name === name)) { toast('이미 있는 메뉴예요. 그 줄의 ＋ 추가를 눌러요'); return; }
  if (menu.length >= MENU_MAX) { toast(`메뉴는 ${MENU_MAX}개까지예요`); return; }
  try {
    await orderDb.setMenu(eid, kind, [...menu, line], countsOf());
    if (!pick) await orderDb.change(eid, kind, keys[0].key, 1);
    toast(pick ? `‘${name}’ 메뉴를 넣었어요. 아이스·따뜻한 중에 ＋ 추가를 눌러요` : `‘${keys[0].key}’ 하나 넣었어요`);
  } catch (e) { fail('넣지 못했어요', e); }
}
async function clearCounts() {
  if (!confirm(`주문 ${totalOf(countsOf())}${BOARDS[kind].unit}을 모두 지울까요? 메뉴는 그대로예요.`)) return;
  try { await orderDb.clear(eid, kind); } catch (e) { fail('지우지 못했어요', e); }
}

start();
