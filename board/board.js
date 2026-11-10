'use strict';
// 자유 게시판 화면: 글 목록(#, #page=2, #cat=meet&page=2 …, 맨 위에 공지, 말머리로 거르기) · 글 하나와 댓글(#p=글번호) · 글쓰기·고치기 창
// 데이터는 board-db.js, 계산은 board-core.js, 입력 부품은 js/form.js
// 회원만 봐요. 공동연구 찾기(AI)의 문맥에는 넣지 않아요

const app = $('app');
const seen = store('board', { seen: 0 }); // 이 기기 localStorage 'lounge-board': 목록에서 본 가장 새 글 시각 (홈의 '새 글' 수)
const back = document.querySelector('.topbar a.icon-btn');
let S = null, me = null, posts = [], pinned = [], total = 0, page = 1, cat = '', counts = {}, lastSeen = 0, fromList = false;
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
  boardDb.watchPinned(list => { pinned = list; if (!postId()) { renderList(); loadCounts(false); } }, e => fail('공지를 읽지 못했어요', e));
  ({ page, cat } = readList(location.hash));
  listen();
  route();
}

// 지금 페이지까지의 글을 지켜봄 (공지는 따로 빼고 셈, 말머리를 고르면 그 글만). 글이 바뀌면 글 수도 다시 셈 (페이지 번호)
function listen() {
  stopList?.();
  stopList = null;
  const p = page, c = cat, now = () => p === page && c === cat;
  boardDb.watchPosts(p * BOARD_PAGE + pinned.length + 5, c, list => {
    if (!now()) return;
    posts = list;
    boardDb.count(c).then(n => { if (!now()) return; total = n; if (!postId()) renderList(); }).catch(e => console.error(e));
    if (!postId()) { renderList(); loadCounts(false); }
  }, e => fail('글을 읽지 못했어요', e)).then(s => { if (now()) stopList = s; else s(); });
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
  const l = readList(location.hash);
  if (l.cat !== cat) { posts = null; total = 0; } // 다른 말머리 글이 오기 전까지 '불러오는 중'
  if (l.page !== page || l.cat !== cat) { ({ page, cat } = l); listen(); scrollTo(0, 0); }
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
const shownPosts = () => [...pinned, ...pagePosts(posts || [], page)];
async function loadCounts(all) {
  const ids = shownPosts().map(p => p.id).filter(id => all || !(id in counts));
  if (!ids.length) return;
  try { Object.assign(counts, await boardDb.commentCounts(ids)); } catch (e) { console.error(e); return; }
  if (!postId()) renderList();
}

// 목록 한 줄: [공지] [말머리] [새] 제목 / 글쓴이 · 시각 · 댓글 수
function postItem(p) {
  const a = h('a', 'post-item');
  a.href = `#p=${p.id}`;
  a.addEventListener('click', () => { fromList = true; });
  const title = h('span', 'pi-title', p.title);
  if (p.at > lastSeen && !isMine(p)) title.prepend(h('span', 'badge new', '새'));
  if (catLabel(p.cat)) title.prepend(h('span', 'badge cat', catLabel(p.cat)));
  if (p.pinned) title.prepend(h('span', 'badge notice', '공지'));
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
  return li;
}

// 공지는 말머리를 골라도 늘 맨 위에 보여요
function renderList() {
  if (!S) return;
  const nodes = [catChips()];
  if (pinned.length) { const ul = h('ul', 'post-list pinned'); ul.append(...pinned.map(postItem)); nodes.push(ul); }
  if (!posts) { nodes.push(h('p', 'hint', '불러오는 중…')); app.replaceChildren(...nodes); return; }
  const list = pagePosts(posts, page);
  if (list.length) { const ul = h('ul', 'post-list'); ul.append(...list.map(postItem)); nodes.push(ul); }
  else if (cat || !pinned.length) {
    nodes.push(h('p', 'empty-note', page > 1 ? '이 페이지에는 글이 없어요.' : cat ? `아직 ${catLabel(cat)} 글이 없어요.` : '아직 글이 없어요. 위의 글쓰기로 처음 글을 올려 주세요.'));
  }
  const pages = pageCount(total, cat ? pinned.filter(p => p.cat === cat).length : pinned.length);
  if (pages > 1) nodes.push(pager(pages));
  app.replaceChildren(...nodes);
  if (cat) return; // 홈의 '새 글' 수는 전체 목록을 봤을 때만 줄여요 (거른 목록은 다른 말머리 새 글을 못 봐서)
  const newest = Math.max(0, ...shownPosts().map(p => p.at || 0));
  if (newest > seen.get().seen) seen.set({ seen: newest });
}
// 말머리 거르기: 전체 · 소식 · 번개 · 일상 · 기타. 고른 칩을 한 번 더 누르면 전체로 (주소 #cat=…에 남음)
function catChips() {
  const row = h('div', 'pills board-cats');
  row.setAttribute('aria-label', '말머리');
  const chip = (k, label) => {
    const on = cat === k;
    const b = button(label, () => { location.hash = writeList({ cat: on ? '' : k }); }, on ? 'on' : '');
    b.setAttribute('aria-pressed', String(on));
    return b;
  };
  row.append(chip('', '전체'), ...BOARD_CATS.map(([k, label]) => chip(k, label)));
  return row;
}
// 페이지 번호: ‹ 1 2 3 4 5 › (주소 #page=N에 남아서 글을 보고 돌아와도 그 페이지)
function pager(pages) {
  const nav = h('nav', 'pager');
  nav.setAttribute('aria-label', '페이지');
  const go = n => { location.hash = writeList({ cat, page: n }); };
  const step = (label, n, name) => { const b = button(label, () => go(n), 'btn small'); b.disabled = n < 1 || n > pages; b.setAttribute('aria-label', name); return b; };
  nav.append(step('‹', page - 1, '앞 페이지'));
  for (const n of pageNumbers(page, pages)) {
    const b = button(String(n), () => go(n), `btn small${n === page ? ' on' : ''}`);
    if (n === page) b.setAttribute('aria-current', 'page');
    nav.append(b);
  }
  nav.append(step('›', page + 1, '다음 페이지'));
  return nav;
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
    title.replaceChildren(...(p.pinned ? [h('span', 'badge notice', '공지'), ' '] : []), ...(catLabel(p.cat) ? [h('span', 'badge cat', catLabel(p.cat)), ' '] : []), p.title);
    meta.textContent = [p.name, fmtWhen(p.at), p.editedAt ? '고침' : ''].filter(Boolean).join(' · ');
    body.replaceChildren(...linkNodes(p.body));
    acts.replaceChildren();
    if (isMine(p)) acts.append(button('고치기', () => openForm(p), 'btn small'));
    if (S.isAdmin) {
      acts.append(button(p.pinned ? '공지 내리기' : '공지로 올리기', async () => {
        try { await boardDb.setPinned(p.id, !p.pinned); toast(p.pinned ? '공지에서 내렸어요' : '공지로 올렸어요'); } catch (e) { fail('바꾸지 못했어요', e); }
      }, 'btn small'));
    }
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
    if (!me) return toast('관리자 계정이 교수님 명단에 가입돼 있지 않아요');
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
  if (!me) return toast('관리자 계정이 교수님 명단에 가입돼 있지 않아요');
  const dlg = h('dialog', 'post-form');
  const form = h('form', 'form'), msg = msgBox();
  const title = textInput('text', { value: p?.title || '', maxLength: POST_MAX.title });
  const body = h('textarea');
  Object.assign(body, { rows: 8, maxLength: POST_MAX.body, value: p?.body || '' });
  const save = h('button', 'btn primary', p ? '저장' : '올리기');
  save.type = 'submit';
  // 말머리: 넷 중 하나 (처음엔 기타, 말머리 전에 쓴 글을 고칠 때도 기타)
  const cat0 = catLabel(p?.cat) ? p.cat : BOARD_CAT_DEFAULT;
  let pick = cat0;
  const seg = h('div', 'seg wide');
  const segBtns = BOARD_CATS.map(([k, label]) => button(label, () => { pick = k; paintSeg(); }, ''));
  const paintSeg = () => segBtns.forEach((b, i) => { const on = BOARD_CATS[i][0] === pick; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  seg.append(...segBtns);
  paintSeg();
  const notice = h('input');
  notice.type = 'checkbox';
  const noticeRow = h('label', 'check');
  noticeRow.append(notice, '공지로 올리기 (목록 맨 위)');
  // 쓰던 글을 실수로 닫지 않게 (Esc·취소)
  const dirty = () => title.value !== (p?.title || '') || body.value !== (p?.body || '') || pick !== cat0;
  const leave = () => !dirty() || confirmBox('쓰던 글을 버릴까요?');
  const acts = h('div', 'form-actions');
  acts.append(save, button('취소', () => { if (leave()) dlg.close(); }, 'btn'));
  form.append(
    h('h2', '', p ? '글 고치기' : '글쓰기'),
    h('p', 'hint', '교수님들만 봐요. 미출판 결과, 환자 정보, 남의 연구에 대한 평가는 올리지 말아 주세요.'),
    block('말머리', seg), field('제목', title), field('내용', body), ...(!p && S.isAdmin ? [noticeRow] : []), msg, acts,
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = { title: title.value, body: body.value, cat: pick };
    say(msg, postProblem(d));
    if (!msg.hidden) return;
    try {
      if (p) {
        await busy(save, '저장 중…', () => boardDb.edit(p.id, d));
        dlg.close();
        toast('고쳤어요');
      } else {
        const id = await busy(save, '올리는 중…', () => boardDb.add(d, me, S.isAdmin && notice.checked));
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
