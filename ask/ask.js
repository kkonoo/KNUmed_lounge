'use strict';
// 공동연구 찾기 (DESIGN §11): 필요한 자원·기법을 적으면 Worker(/ai/ask)가 연구실 둘러보기 프로필로 2~3분을 찾아 줘요
// 질문과 답은 어디에도 저장하지 않아요 (이 화면도 새로 고치면 사라짐). 한도는 메뉴판 읽기와 같이 써요
const app = document.getElementById('app');
const ASK_MAX = 500; // worker.js와 같음
let S = null, usage = null;

async function start() {
  try { S = await session(); } catch (e) {
    console.error(e);
    app.replaceChildren(h('p', 'msg err', '연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.'));
    return;
  }
  if (!S.user) return goLogin();
  mountAccountChip(S);
  if (!S.isAdmin && !isActiveMember(S)) {
    const p = h('p', 'msg err', S.member ? '사용이 멈춘 계정이에요. 관리자에게 알려 주세요.' : '가입을 마쳐야 쓸 수 있어요. ');
    if (!S.member) { const a = h('a', '', '가입 마치기'); a.href = `${LOUNGE_ROOT}login/`; p.append(a); }
    app.replaceChildren(p);
    return;
  }
  if (typeof WORKER_URL === 'undefined' || !WORKER_URL) {
    app.replaceChildren(h('p', 'empty-note', '아직 준비 중이에요.'));
    return;
  }
  render();
}

function render() {
  const form = h('form', 'form ask-form'), msg = msgBox();
  const q = h('textarea');
  Object.assign(q, { rows: 4, maxLength: ASK_MAX, placeholder: '예: 마우스 간에서 호중구를 분리해 본 분\n예: 단일세포 RNA-seq 데이터를 같이 분석해 줄 분' });
  const go = h('button', 'btn primary', '찾아 보기');
  go.type = 'submit';
  const left = h('small', 'ask-left');
  const acts = h('div', 'form-actions');
  acts.append(go, left);
  const out = h('div', 'ask-out');
  form.append(
    h('p', 'hint', '필요한 모델·시료·장비·데이터·기법을 적으면, 연구실 둘러보기 프로필에서 갖고 계시거나 다뤄 온 교수님을 2~3분 찾아 드려요.'),
    field('찾는 것', q),
    h('p', 'form-note', '적은 질문은 답을 만드는 데만 Claude(Anthropic)로 보내고 저장하지 않아요. 미출판 결과나 환자 정보는 적지 말아 주세요.'),
    msg, acts,
  );
  app.replaceChildren(form, out);
  q.focus();

  const paintLeft = () => { left.textContent = usage ? `오늘 ${usage.used}/${usage.limit}번 썼어요` : ''; };
  workerCall('/status').then(s => {
    usage = s;
    paintLeft();
    if (!s.ai) { go.disabled = true; left.textContent = '관리자가 Claude 키를 넣으면 쓸 수 있어요'; }
  }).catch(e => console.error(e));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = q.value.trim();
    say(msg, text ? '' : '무엇을 찾는지 적어 주세요');
    if (!text) return;
    try {
      const r = await busy(go, '찾는 중…', () => workerCall('/ai/ask', { method: 'POST', body: { q: text } }));
      if (usage) { usage.used += 1; paintLeft(); }
      out.replaceChildren(...answer(r));
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { say(msg, err.message); }
  });
}

// 답: 교수님 2~3분 · 근거 칸 · 처음 물어볼 질문 하나
function answer({ picks = [], note = '' }) {
  if (!picks.length) return [h('p', 'empty-note', note || '맞는 교수님을 찾지 못했어요. 다른 말로 물어봐 주세요.')];
  const nodes = picks.map(p => {
    const card = h('article', 'ask-pick');
    const who = h('a', 'ask-who');
    who.href = `${LOUNGE_ROOT}people/#p=${encodeURIComponent(p.id)}`;
    const name = h('div', '');
    name.append(h('b', '', p.name), h('span', '', p.dept));
    who.append(photoOf(p), name);
    card.append(who);
    if (p.fields?.length) card.append(h('p', 'ask-fields', `근거: ${p.fields.join(' · ')}`));
    if (p.why) card.append(h('p', 'ask-why', p.why));
    if (p.ask) {
      const first = h('div', 'ask-first');
      first.append(h('small', '', '처음 물어볼 질문'), h('p', '', p.ask), withIcon(button('복사', () => copyText(p.ask, '질문을 복사했어요'), 'btn small'), 'copy'));
      card.append(first);
    }
    return card;
  });
  if (note) nodes.push(h('p', 'hint', note));
  nodes.push(h('p', 'hint', 'Claude가 프로필만 보고 고른 거라 틀릴 수 있어요. 이름을 누르면 프로필이 열려요.'));
  return nodes;
}
function photoOf(p) {
  if (!p.photo) { const e = h('div', 'photo empty'); e.append(icon('user')); return e; }
  const img = h('img', 'photo');
  Object.assign(img, { src: `${LOUNGE_ROOT}${p.photo}`, alt: '', loading: 'lazy', decoding: 'async', width: 56, height: 75 });
  return img;
}

start();
