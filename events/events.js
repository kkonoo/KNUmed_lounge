'use strict';
// 친목회 화면: 다가오는 친목회마다 참석·미정·불참 체크와 한마디(식당 메뉴를 받으면 메뉴 하나), 누가 오는지,
// 카페·식당 주문판(order/) 입구. 관리자는 만들기·고치기·마감·공지 문구 복사
// 데이터는 events-db.js, 계산은 events-core.js, 입력 부품은 js/form.js

const app = $('app');
let S = null, members = [], roster = [], events = [];
const cards = new Map(); // 행사 id → { el, stop, paint }

const fail = (msg, e) => { console.error(e); toast(`${msg}: ${authMessage(e)}`, 3500); };

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
  if (S.isAdmin) {
    const add = withIcon(button('새 친목회', () => openForm(null), 'btn small primary'), 'plus');
    document.querySelector('.head-end').prepend(add);
  }
  if (S.isAdmin) {
    try { [members, roster] = await Promise.all([eventsDb.members(), eventsDb.roster()]); } catch (e) { console.error(e); }
  }
  await eventsDb.watchEvents(list => { events = list; render(); }, e => fail('친목회를 읽지 못했어요', e));
}

function render() {
  const mine = forMe(events, S.member?.group || '기초', S.isAdmin);
  const { upcoming, past } = splitEvents(mine, todayStr());
  // 지켜보던 행사 중 화면에서 빠진 것은 그만 보기
  const keep = new Set(upcoming.map(e => e.id));
  for (const [id, c] of cards) if (!keep.has(id)) { c.stop?.(); cards.delete(id); }

  const nodes = [];
  if (!upcoming.length) {
    nodes.push(h('p', 'empty-note', S.isAdmin ? '다음 친목회가 아직 없어요. 위의 ＋ 새 친목회로 올려 주세요.' : '다음 친목회가 아직 안 올라왔어요.'));
  }
  for (const e of upcoming) {
    let c = cards.get(e.id);
    if (!c) { c = eventCard(e); cards.set(e.id, c); } else c.update(e);
    nodes.push(c.el);
  }
  if (past.length) {
    const d = h('details', 'past');
    d.append(h('summary', '', `지난 친목회 ${past.length}`));
    const ul = h('ul', 'past-list');
    for (const e of past) {
      const li = h('li');
      li.append(h('span', 'when', fmtDate(e.date)), h('b', '', e.title), h('span', 'where', e.place || ''));
      if (S.isAdmin) li.append(button('지우기', () => removeEvent(e), 'btn small danger'));
      ul.append(li);
    }
    d.append(ul);
    nodes.push(d);
  }
  app.replaceChildren(...nodes);
}

// ---------- 행사 카드 ----------
function eventCard(e) {
  const el = h('article', 'panel ev');
  const c = { el, e, rsvps: [], stop: null };

  const top = h('div', 'ev-top');
  const title = h('h2');
  const place = h('p', 'ev-place');
  const note = h('p', 'ev-note');
  const due = h('p', 'hint due');

  // 내 응답
  const me = h('div', 'ev-me');
  const seg = h('div', 'seg ev-seg');
  const segBtns = STATUS.map(([k, label, icon]) => {
    const b = button(`${icon} ${label}`, () => (myRsvp()?.status === k ? cancel() : answer(k)), ''); // 고른 것을 한 번 더 누르면 취소
    b.dataset.k = k;
    seg.append(b);
    return b;
  });
  const comment = textInput('text', { maxLength: 60, placeholder: '한마디 (예: 30분 늦어요)' });
  const saveC = button('저장', () => { const mine = myRsvp(); if (!mine) return toast('참석·미정·불참을 먼저 골라 주세요'); answer(mine.status); }, 'btn');
  comment.addEventListener('keydown', ev => { if (ev.key === 'Enter') saveC.click(); });
  const crow = h('div', 'inline');
  crow.append(comment, saveC);
  // 식당 메뉴 미리 고르기 (관리자가 메뉴를 적은 친목회만). 고른 것을 한 번 더 누르면 풀림
  const mealBox = h('div', 'ev-meal');
  const mealPills = h('div', 'pills');
  mealBox.append(h('span', 'label', '식당 메뉴'), mealPills);
  const closedNote = h('p', 'hint');
  me.append(seg, mealBox, crow, closedNote);

  const tallyBox = h('div', 'ev-tally');
  const adminBox = h('div', 'form-actions');
  // 주문판: 그 자리에서 각자 폰으로, 또는 폰 한 대를 돌리며
  const orders = h('div', 'ev-orders');
  for (const [k, b] of Object.entries(BOARDS)) {
    const a = withIcon(h('a', 'btn small', b.label), b.icon);
    a.href = `${LOUNGE_ROOT}order/?e=${encodeURIComponent(e.id)}&k=${k}`;
    orders.append(a);
  }

  el.append(top, title, place, note, due, me, tallyBox, orders, adminBox);

  const myRsvp = () => c.rsvps.find(r => r.uid === S.user.uid);
  async function answer(status, meal = myRsvp()?.meal || '') {
    if (!S.member) return toast('관리자 계정이 교수님 명단에 가입돼 있지 않아요');
    try { await eventsDb.rsvp(c.e.id, S.user.uid, { status, name: S.member.name, comment: comment.value, meal }); toast('체크했어요'); } catch (err) { fail('체크하지 못했어요', err); }
  }
  function pickMeal(meal) {
    const mine = myRsvp();
    if (!mine || mine.status === 'no') return toast('참석이나 미정을 먼저 골라 주세요');
    answer(mine.status, mine.meal === meal ? '' : meal);
  }
  async function cancel() {
    try { await eventsDb.unrsvp(c.e.id, S.user.uid); toast('체크를 취소했어요'); } catch (err) { fail('취소하지 못했어요', err); }
  }

  function paint() {
    const e = c.e, open = isOpen(e), mine = myRsvp();
    top.replaceChildren(h('span', 'ev-date', whenText(e)));
    if (e.audience !== '기초') top.append(h('span', 'badge', e.audience === '전체' ? '전체' : e.audience));
    if (!open) top.append(h('span', 'badge stopped', '마감'));
    title.textContent = e.title;
    place.replaceChildren();
    if (e.place) {
      place.append(icon('map-pin'), e.place);
      if (e.mapUrl) { const a = h('a', '', '지도'); Object.assign(a, { href: e.mapUrl, target: '_blank', rel: 'noopener' }); place.append(' ', a); }
    }
    place.hidden = !e.place;
    note.textContent = e.note || '';
    note.hidden = !e.note;
    due.replaceChildren(...(e.deadline != null ? [icon('clock'), `${fmtStamp(e.deadline)}까지 체크해 주세요`] : []));
    due.hidden = e.deadline == null || !open;

    for (const b of segBtns) {
      b.classList.toggle('on', mine?.status === b.dataset.k);
      b.setAttribute('aria-pressed', String(mine?.status === b.dataset.k));
      b.title = open && mine?.status === b.dataset.k ? '한 번 더 누르면 취소돼요' : '';
      b.disabled = !open;
    }
    comment.disabled = saveC.disabled = !open;
    const meals = e.meals || [];
    mealBox.hidden = !meals.length;
    mealPills.replaceChildren(...meals.map(m => {
      const b = button(m, () => pickMeal(m), mine?.meal === m ? 'on' : '');
      b.setAttribute('aria-pressed', String(mine?.meal === m));
      b.disabled = !open;
      return b;
    }));
    if (document.activeElement !== comment) comment.value = mine?.comment || '';
    closedNote.textContent = open ? '' : '마감됐어요. 바꾸실 일이 있으면 관리자에게 알려 주세요.';
    closedNote.hidden = open;

    const t = tally(c.rsvps);
    tallyBox.replaceChildren(...STATUS.map(([k, label]) => {
      const row = h('div', 't-row');
      row.append(h('b', '', `${label} ${t[k].length}`));
      const names = h('span', 'names');
      t[k].forEach((r, i) => {
        if (i) names.append(' · ');
        names.append(r.name);
        if (r.comment) names.append(h('small', '', ` (${r.comment})`));
      });
      row.append(names);
      return row;
    }));
    if (meals.length) {
      const mt = mealTally(meals, c.rsvps);
      const box = h('div', 'ev-meals');
      for (const { meal, names } of mt) {
        const row = h('div', 't-row');
        row.append(h('b', '', `${meal} ${names.length}`), h('span', 'names', names.join(' · ')));
        box.append(row);
      }
      if (mt.some(t => t.names.length)) box.append(withIcon(button('식당 메뉴 복사', () => copyText(mealText(e.title, mt)), 'btn small'), 'copy'));
      tallyBox.append(box);
    }
    if (S.isAdmin) {
      const yet = notYet(roster, c.rsvps, members, e.audience);
      if (yet.length) {
        const row = h('div', 't-row yet');
        row.append(h('b', '', `아직 ${yet.length}`), h('span', 'names', yet.map(m => m.name).join(' · ')));
        row.append(withIcon(button('메일 복사', () => copyText(yet.map(m => m.email).join(', '), `${yet.length}분 메일을 복사했어요`), 'btn small'), 'copy'));
        tallyBox.append(row);
      }
    }

    adminBox.replaceChildren();
    adminBox.hidden = !S.isAdmin;
    if (S.isAdmin) {
      adminBox.append(
        button('고치기', () => openForm(c.e), 'btn small'),
        button(e.closed ? '다시 열기' : '마감', async () => { try { await eventsDb.setClosed(e.id, !e.closed); } catch (err) { fail('바꾸지 못했어요', err); } }, 'btn small'),
        withIcon(button('공지 문구', () => copyText(announceText(e, `${LOUNGE_ROOT}events/`)), 'btn small'), 'copy'),
        button('지우기', () => removeEvent(e), 'btn small danger'),
      );
    }
  }

  c.update = e => { c.e = e; paint(); };
  c.paint = paint;
  eventsDb.watchRsvps(e.id, list => { c.rsvps = list; paint(); }, err => fail('응답을 읽지 못했어요', err)).then(stop => { c.stop = stop; });
  paint();
  return c;
}

async function removeEvent(e) {
  if (!confirmBox(`'${e.title}'을(를) 지울까요? 참석 체크도 같이 지워져요.`)) return;
  try { await eventsDb.remove(e.id); toast('지웠어요'); } catch (err) { fail('지우지 못했어요', err); }
}

// ---------- 만들기·고치기 (관리자) ----------
function openForm(e) {
  const dlg = h('dialog', 'event-form');
  const form = h('form', 'form'), msg = msgBox();
  const date = textInput('date', { value: e?.date || '', required: true });
  const time = textInput('time', { value: e ? e.time : '18:30' });
  const title = textInput('text', { value: e?.title || '', maxLength: 60, placeholder: '예: 11월 기초친목회' });
  const place = textInput('text', { value: e?.place || '', maxLength: 80, placeholder: '식당 이름 · 위치' });
  const mapUrl = textInput('url', { value: e?.mapUrl || '', placeholder: 'https://naver.me/… (지도 앱 공유 링크)' });
  const deadline = textInput('datetime-local', { value: toLocalInput(e?.deadline ?? null) });
  const note = h('textarea');
  Object.assign(note, { rows: 3, maxLength: 1000, value: e?.note || '', placeholder: '회비, 주차, 메뉴 등' });
  const audience = select([['기초', '기초교실'], ['전체', '전체 (기초·임상)'], ['임상', '임상교실']], e?.audience || '기초');
  const meals = h('textarea');
  Object.assign(meals, { rows: 3, value: (e?.meals || []).join('\n'), placeholder: '한 줄에 메뉴 하나\n예: 김치찌개' });
  let titleTouched = !!e;
  title.addEventListener('input', () => { titleTouched = true; });
  const autoTitle = () => { if (!titleTouched) title.value = defaultTitle(date.value, audience.value); };
  date.addEventListener('change', autoTitle);
  audience.addEventListener('change', autoTitle);

  const two = h('div', 'row2');
  two.append(field('날짜', date), field('시간', time));
  const save = h('button', 'btn primary', e ? '저장' : '올리기');
  save.type = 'submit';
  const acts = h('div', 'form-actions');
  acts.append(save, button('취소', () => dlg.close(), 'btn'));
  form.append(
    h('h2', '', e ? '친목회 고치기' : '새 친목회'),
    two, field('제목', title), field('장소', place), field('지도 링크', mapUrl, '없어도 돼요'),
    field('참석 체크 마감', deadline, '비워 두면 직접 ‘마감’을 누를 때까지 받아요'),
    field('메모', note), field('식당 메뉴 미리 받기', meals, '적으면 참석 체크 때 메뉴를 하나씩 골라요. 비우면 안 받아요'), field('대상', audience), msg, acts,
  );
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = { title: title.value, date: date.value, time: time.value, place: place.value, mapUrl: mapUrl.value.trim(), deadline: fromLocalInput(deadline.value), note: note.value, audience: audience.value, meals: parseMeals(meals.value) };
    say(msg, eventProblem(d));
    if (!msg.hidden) return;
    try { await busy(save, '저장 중…', () => eventsDb.save(e?.id || null, d, S.user.uid)); dlg.close(); toast(e ? '고쳤어요' : '올렸어요'); } catch (err) { say(msg, authMessage(err)); }
  });
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

start();
