'use strict';
// 자유 게시판 화면: 글 목록(#) · 글 하나와 댓글(#p=글번호) · 글쓰기·고치기 창
// 데이터는 board-db.js, 계산은 board-core.js, 입력 부품은 js/form.js
// 회원만 봐요. 공동연구 찾기(AI)의 문맥에는 넣지 않아요

const app = $('app');
const seen = store('board', { seen: 0 }); // 이 기기 localStorage 'lounge-board': 목록에서 본 가장 새 글 시각 (홈의 '새 글' 수)
const back = document.querySelector('.topbar a.icon-btn');
let S = null, me = null, posts = [], counts = {}, shown = 30, lastSeen = 0, fromList = false;
let stopList = null, view = 0, stops = [];

const fail = (msg, e) => { console.error(e); toast(`${msg}: ${authMessage(e)}`, 3500); };
const isMine = x => x.by === S.user.uid;
const postId = () => (/^#p=([\w-]+)$/.exec(location.hash) || [])[1] || '';
// 지켜보기를 화면에 묶음: 화면이 바뀐 뒤에 연결되면 바로 끊음
const keep = (v, p) => p.then(stop => { if (v === view) stops.push(stop); else stop(); });

async function start() {
  try { S = await session(); } catch (e) {
    console.error(e);
    app.replaceChildren(h('p', 'msg err', '연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.'));
    return;
  }
  if (!S.user) return goLogin();
  mountAccountChip(S);
  if (!S.isAdmin && !isActiveMember(S)) {
    const p = h('p', 'msg err', S.member ? '사용이 멈춘 계정이에요. 관리자에게 알려 주세요.' : '가입을 마쳐야 볼 수 있어요. ');
    if (!S.member) { const a = h('a', '', '가입 마치기'); a.href = `${LOUNGE_ROOT}login/`; p.append(a); }
    app.replaceChildren(p);
    return;
  }
  me = S.member ? { uid: S.user.uid, name: S.member.name } : null;
  document.querySelector('.head-end').prepend(withIcon(button('글쓰기', () => openForm(null), 'btn small primary'), 'plus'));
  lastSeen = seen.get().seen;
  back.addEventListener('click', e => { if (postId()) { e.preventDefault(); toList(); } });
  addEventListener('hashchange', route);
  listen();
  route();
}

function listen() {
  stopList?.();
  boardDb.watchPosts(shown, list => {
    posts = list;
    if (!postId()) { renderList(); loadCounts(false); }
  }, e => fail('글을 읽지 못했어요', e)).then(s => { stopList = s; });
}

function route() {
  view++;
  stops.forEach(stop => stop());
  stops = [];
  const id = postId();
  back.title = id ? '목록으로' : '처음으로';
  back.setAttribute('aria-label', back.title);
  if (id) return showPost(id);
  fromList = false;
  renderList();
  loadCounts(true);
}
// 글에서 목록으로: 목록에서 들어왔으면 뒤로 가기(폰 뒤로 단추와 같게), 링크로 바로 왔으면 목록으로 바꿈
function toList() {
  if (fromList) return history.back();
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

// ---------- 목록 ----------
async function loadCounts(all) {
  const ids = posts.map(p => p.id).filter(id => all || !(id in counts));
  if (!ids.length) return;
  try { Object.assign(counts, await boardDb.commentCounts(ids)); } catch (e) { console.error(e); return; }
  if (!postId()) renderList();
}

function renderList() {
  if (!S) return;
  if (!posts.length) {
    app.replaceChildren(h('p', 'empty-note', '아직 글이 없어요. 위의 글쓰기로 처음 글을 올려 주세요.'));
    return;
  }
  const ul = h('ul', 'post-list');
  for (const p of posts) {
    const a = h('a', 'post-item');
    a.href = `#p=${p.id}`;
    a.addEventListener('click', () => { fromList = true; });
    const title = h('span', 'pi-title', p.title);
    if (p.at > lastSeen && !isMine(p)) title.prepend(h('span', 'badge new', '새'));
    const meta = h('span', 'pi-meta', `${p.name} · ${fmtWhen(p.at)}`);
    if (counts[p.id]) {
      const c = h('span', 'pi-count');
      c.append(icon('message-square'), String(counts[p.id]));
      c.title = `댓글 ${counts[p.id]}`;
      meta.append(c);
    }
    a.append(title, meta);
    const li = h('li');
    li.append(a);
    ul.append(li);
  }
  const nodes = [ul];
  if (posts.length >= shown) nodes.push(button('더 보기', () => { shown += 30; listen(); }, 'btn more'));
  app.replaceChildren(...nodes);
  const newest = Math.max(...posts.map(p => p.at || 0));
  if (newest > seen.get().seen) seen.set({ seen: newest });
}

// ---------- 글 하나 ----------
function linkNodes(text) {
  return linkParts(text).map(([k, v]) => {
    if (k === 't') return document.createTextNode(v);
    const a = h('a', '', v);
    Object.assign(a, { href: v, target: '_blank', rel: 'noopener noreferrer' });
    return a;
  });
}

function showPost(id) {
  const v = view;
  const art = h('article', 'panel post');
  const title = h('h2'), meta = h('p', 'post-meta'), body = h('div', 'post-body'), acts = h('div', 'form-actions');
  art.append(title, meta, body, acts);

  const sec = h('section', 'comments');
  const head = h('h3', '', '댓글');
  const list = h('ul', 'comment-list');
  const form = h('form', 'comment-form');
  const ta = h('textarea');
  Object.assign(ta, { rows: 2, maxLength: POST_MAX.comment, placeholder: '댓글' });
  ta.setAttribute('aria-label', '댓글');
  const send = h('button', 'btn primary', '달기');
  send.type = 'submit';
  form.append(ta, send);
  sec.append(head, list, form);
  app.replaceChildren(h('p', 'hint', '불러오는 중…'));

  keep(v, boardDb.watchPost(id, p => {
    if (!p) { app.replaceChildren(h('p', 'empty-note', '지워졌거나 없는 글이에요.')); return; }
    if (!art.isConnected) app.replaceChildren(art, sec);
    title.textContent = p.title;
    meta.textContent = [p.name, fmtWhen(p.at), p.editedAt ? '고침' : ''].filter(Boolean).join(' · ');
    body.replaceChildren(...linkNodes(p.body));
    acts.replaceChildren();
    if (isMine(p)) acts.append(button('고치기', () => openForm(p), 'btn small'));
    if (isMine(p) || S.isAdmin) acts.append(button('지우기', () => removePost(p), 'btn small danger'));
    acts.hidden = !acts.childElementCount;
  }, e => fail('글을 읽지 못했어요', e)));

  keep(v, boardDb.watchComments(id, cs => {
    head.textContent = cs.length ? `댓글 ${cs.length}` : '댓글';
    list.replaceChildren(...cs.map(c => commentItem(id, c)));
    list.hidden = !cs.length;
  }, e => fail('댓글을 읽지 못했어요', e)));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!me) return toast('관리자 계정이 회원 명단에 없어요');
    const text = ta.value.trim();
    if (!text) return;
    try { await busy(send, '다는 중…', () => boardDb.comment(id, text, me)); ta.value = ''; } catch (err) { fail('댓글을 달지 못했어요', err); }
  });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
}

function commentItem(pid, c) {
  const li = h('li');
  const head = h('div', 'c-head');
  head.append(h('b', '', c.name), h('span', '', fmtWhen(c.at)));
  if (isMine(c) || S.isAdmin) {
    const del = button('', async () => {
      if (!confirmBox('이 댓글을 지울까요?')) return;
      try { await boardDb.uncomment(pid, c.id); toast('지웠어요'); } catch (e) { fail('지우지 못했어요', e); }
    }, 'icon-btn small');
    del.append(icon('x'));
    del.title = '댓글 지우기';
    del.setAttribute('aria-label', '댓글 지우기');
    head.append(del);
  }
  const p = h('p', 'c-body');
  p.append(...linkNodes(c.body));
  li.append(head, p);
  return li;
}

async function removePost(p) {
  if (!confirmBox(`'${p.title}'을(를) 지울까요? 댓글도 같이 지워져요.`)) return;
  try { await boardDb.remove(p.id); toast('지웠어요'); toList(); } catch (e) { fail('지우지 못했어요', e); }
}

// ---------- 글쓰기·고치기 ----------
function openForm(p) {
  if (!me) return toast('관리자 계정이 회원 명단에 없어요');
  const dlg = h('dialog', 'post-form');
  const form = h('form', 'form'), msg = msgBox();
  const title = textInput('text', { value: p?.title || '', maxLength: POST_MAX.title });
  const body = h('textarea');
  Object.assign(body, { rows: 8, maxLength: POST_MAX.body, value: p?.body || '' });
  const save = h('button', 'btn primary', p ? '저장' : '올리기');
  save.type = 'submit';
  // 쓰던 글을 실수로 닫지 않게 (Esc·취소)
  const dirty = () => title.value !== (p?.title || '') || body.value !== (p?.body || '');
  const leave = () => !dirty() || confirmBox('쓰던 글을 버릴까요?');
  const acts = h('div', 'form-actions');
  acts.append(save, button('취소', () => { if (leave()) dlg.close(); }, 'btn'));
  form.append(
    h('h2', '', p ? '글 고치기' : '글쓰기'),
    h('p', 'hint', '회원만 봐요. 미출판 결과, 환자 정보, 남의 연구에 대한 평가는 올리지 말아 주세요.'),
    field('제목', title), field('내용', body), msg, acts,
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = { title: title.value, body: body.value };
    say(msg, postProblem(d));
    if (!msg.hidden) return;
    try {
      if (p) {
        await busy(save, '저장 중…', () => boardDb.edit(p.id, d));
        dlg.close();
        toast('고쳤어요');
      } else {
        const id = await busy(save, '올리는 중…', () => boardDb.add(d, me));
        dlg.close();
        toast('올렸어요');
        fromList = !postId();
        location.hash = `p=${id}`;
      }
    } catch (err) { say(msg, authMessage(err)); }
  });
  dlg.addEventListener('cancel', e => { if (!leave()) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(form);
  document.body.append(dlg);
  dlg.showModal();
  title.focus();
}

start();
