'use strict';
// 홈: 로그인 상태(머리 줄)와, 로그인한 회원에게 다음 친목회 한 줄 (내 체크 여부까지)과 자유 게시판 새 글 수
(async () => {
  const slot = $('nextEvent');
  let s;
  try { s = await session(); } catch { return; } // 연결이 안 되면 홈은 그냥 카드만
  mountAccountChip(s);
  if (!(s.isAdmin || isActiveMember(s))) return;
  boardNews(s);
  try {
    const { F, db } = await fb();
    const q = F.query(F.collection(db, 'events'), F.where('date', '>=', todayStr()), F.orderBy('date'), F.limit(5));
    const list = (await F.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data(), deadline: d.data().deadline ? d.data().deadline.toMillis() : null }));
    const [e] = splitEvents(forMe(list, s.member?.group || '기초', s.isAdmin), todayStr()).upcoming;
    if (!e) return;
    const mine = await F.getDoc(F.doc(db, 'events', e.id, 'rsvps', s.user.uid));
    const st = mine.exists() ? STATUS.find(x => x[0] === mine.data().status) : null;
    const a = h('a', 'next-event');
    a.href = 'events/';
    const text = h('span', 'ne-text');
    text.append(h('b', '', e.title), h('span', '', [whenText(e), e.place].filter(Boolean).join(' · ')));
    a.append(icon('utensils', 'ne-icon'), text, h('span', `ne-me${st ? ' done' : ''}`, st ? `${st[2]} ${st[1]}` : isOpen(e) ? '체크하기 →' : '마감'));
    slot.replaceChildren(a);
    slot.hidden = false;
  } catch (e) { console.error(e); }
})();

// 자유 게시판 카드: 이 기기에서 목록을 마지막으로 본 뒤 올라온 남의 글 수
async function boardNews(s) {
  try {
    const seen = store('board', { seen: 0 }).get().seen;
    const n = newCount(await boardDb.since(seen), seen, s.user.uid);
    if (n) $('boardFoot').replaceChildren(h('span', 'badge new', `새 글 ${n}`));
  } catch (e) { console.error(e); }
}
