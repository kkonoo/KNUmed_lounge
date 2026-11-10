'use strict';
// 연구실 둘러보기 화면: 목록(찾기·교실·주제로 거르기, 교실별 카드)과 교수님 한 분 자세히 보기(#p=번호)
// 바탕은 data/people.json(이름북), 그 위에 Firestore 프로필(본인이 저장해 확인한 것)을 얹음 (people-core.js mergeProfiles)
// 계산은 people-core.js, 데이터는 profile-db.js, 공용 부품(h, button)은 js/ui.js

(async () => {
  const app = $('app');
  const back = document.querySelector('.topbar a.icon-btn');
  let data;
  try {
    const res = await fetch('../data/people.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    app.append(h('p', 'empty-note', '교수님 목록을 읽지 못했어요. 잠시 뒤 새로 고쳐 주세요.'));
    return;
  }
  let people = data.people;
  let S = null, myPid = '', fromList = false, listScroll = 0;
  let f = readHash(location.hash);
  const detailId = () => (/^#p=([a-z2-9]{6})$/.exec(location.hash) || [])[1] || '';

  // ---------- 찾기·거르기 ----------
  const finder = h('section', 'finder');
  const search = h('div', 'search');
  const input = h('input', 'text-input');
  Object.assign(input, { type: 'search', value: f.q, placeholder: '이름·교실·키워드로 찾기', autocomplete: 'off' });
  input.setAttribute('aria-label', '교수님 찾기');
  search.append(icon('search', 'search-icon'), input);

  const deptPills = h('div', 'pills');
  const topicPills = h('div', 'pills');
  const row = (label, pills) => { const r = h('div', 'filter-row'); r.append(h('span', 'label', label), pills); return r; };
  const count = h('div', 'count-row');
  finder.append(search, row('교실', deptPills), row('주제', topicPills), count);

  const list = h('div', '');
  const listView = h('div', '');
  listView.append(finder, list);
  const detailView = h('div', 'detail');
  detailView.hidden = true;
  app.append(listView, detailView);

  const pill = (label, n, on, onClick) => {
    const b = button(label, onClick, '');
    if (n != null) b.append(h('span', 'n', n));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    return b;
  };

  function paintFilters() {
    deptPills.replaceChildren(
      pill('전체', null, !f.dept, () => set({ dept: '' })),
      ...deptCounts(people).map(([d, n]) => pill(shortDept(d), n, f.dept === d, () => set({ dept: f.dept === d ? '' : d }))),
    );
    topicPills.replaceChildren(
      pill('전체', null, !f.topic, () => set({ topic: '' })),
      ...topicCounts(data.topics, people).map(t => pill(`${t.emoji} ${t.label}`, t.n, f.topic === t.key, () => set({ topic: f.topic === t.key ? '' : t.key }))),
    );
  }

  function photoOf(p) {
    if (!p.photo) {
      const e = h('div', 'photo empty');
      e.append(icon('user'));
      return e;
    }
    const img = h('img', 'photo');
    Object.assign(img, { src: `../${p.photo}`, alt: '', loading: 'lazy', decoding: 'async', width: 96, height: 128 });
    return img;
  }

  // 대문 카드: 사진·이름·교실·한 줄·키워드. 누르면 자세히
  //   카드 크기를 맞추려고 한 줄 소개는 세 줄까지(넘치면 … 더보기), 키워드는 한 줄까지만 보여요
  function card(p) {
    const a = h('a', `prof${p.status === 'listed' ? ' listed' : ''}${isStale(p.confirmedAt) ? ' stale' : ''}`);
    a.href = `#p=${p.id}`;
    a.addEventListener('click', () => { fromList = true; });
    const body = h('div', '');
    const name = h('h3', '', p.name);
    if (p.rank) name.append(h('small', '', p.rank));
    body.append(name, h('p', 'dept', p.dept));
    body.append(p.line ? h('p', 'line', p.line) : h('p', 'line none', '아직 소개를 준비하고 있어요'));
    body.append(h('span', 'more', '더보기'));
    if (p.keywords?.length) {
      const kw = h('ul', 'kw');
      for (const k of p.keywords) kw.append(h('li', '', k));
      body.append(kw);
    }
    a.append(photoOf(p), body);
    return a;
  }

  function paintList() {
    const shown = filterPeople(people, f);
    const n = h('span');
    n.append(h('b', '', shown.length), `명 / ${people.length}명`);
    count.replaceChildren(n);

    if (!shown.length) {
      list.replaceChildren(h('p', 'empty-note', '맞는 분이 없어요. 다른 말로 찾거나, 고른 칩을 한 번 더 눌러 풀어 보세요.'));
      return;
    }
    list.replaceChildren(...groupByDept(shown).map(([dept, ps]) => {
      const block = h('section', 'dept-block');
      const title = h('h2', '', dept);
      title.append(h('small', '', `${ps.length}명`));
      const grid = h('div', 'prof-grid');
      grid.append(...ps.map(card));
      block.append(title, grid);
      return block;
    }));
    requestAnimationFrame(markMore);
  }
  // 세 줄을 넘겨 잘린 소개에만 '더보기' (화면 폭이 바뀌면 다시)
  function markMore() {
    for (const line of list.querySelectorAll('.prof .line')) line.closest('.prof').classList.toggle('cut', line.scrollHeight > line.clientHeight + 1);
  }
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(markMore, 150); });

  function set(patch) {
    f = { ...f, ...patch };
    history.replaceState(null, '', writeHash(f) || location.pathname + location.search);
    paintFilters();
    paintList();
  }
  input.addEventListener('input', () => set({ q: input.value }));

  // ---------- 자세히 (#p=번호) ----------
  const linkTo = (url, label) => {
    const a = h('a', '', label);
    if (isUrl(url)) Object.assign(a, { href: url, target: '_blank', rel: 'noopener noreferrer' });
    return a;
  };
  const section = (title, ...nodes) => {
    const s = h('section', 'd-sec');
    s.append(h('h3', '', title), ...nodes);
    return s;
  };
  const pairs = rows => {
    const dl = h('dl', 'pairs');
    for (const [k, v] of rows) dl.append(h('dt', '', k), h('dd', '', v));
    return dl;
  };

  function paintDetail(id) {
    const p = people.find(x => x.id === id);
    if (!p) { detailView.replaceChildren(h('p', 'empty-note', '찾는 교수님이 없어요.')); return; }
    const head = h('header', 'd-head');
    const who = h('div', '');
    const name = h('h2', '', p.name);
    if (p.rank) name.append(h('small', '', p.rank));
    const state = p.confirmedAt
      ? `마지막 확인 ${fmtDay(p.confirmedAt)}${isStale(p.confirmedAt) ? ' · 1년이 넘었어요' : ''}`
      : '아직 교수님 확인 전이에요';
    who.append(name, h('p', 'dept', p.dept), h('p', 'state', state));
    head.append(photoOf(p), who);
    const nodes = [head];

    if (p.line) nodes.push(h('p', 'd-line', p.line));
    if (p.question) nodes.push(section('연구 질문', h('p', 'd-text', p.question)));
    if (p.keywords?.length) {
      const kw = h('ul', 'kw');
      for (const k of p.keywords) kw.append(h('li', '', k));
      nodes.push(kw);
    }
    if (p.axes?.length) {
      nodes.push(section('연구 축', ...p.axes.map(a => {
        const d = h('div', 'axis');
        d.append(h('b', '', a.name));
        if (a.text) d.append(h('p', '', a.text));
        if (a.papers?.length) {
          const ps = h('p', 'links');
          for (const x of a.papers) ps.append(linkTo(x.url, x.label));
          d.append(ps);
        }
        return d;
      })));
    }
    if (p.timeline?.length) nodes.push(section('연구 발자취', pairs(p.timeline.map(t => [t.years, t.text]))));
    const res = RESOURCE_KINDS.filter(([k]) => p.resources?.[k]).map(([k, label]) => [label, p.resources[k]]);
    if (res.length) nodes.push(section('보유 자원', pairs(res)));
    if (p.links?.length) {
      const ls = h('p', 'links');
      for (const [url, label] of p.links) ls.append(linkTo(url, label));
      nodes.push(section('링크', ls));
    }

    // 로그인한 교수님만 보는 칸
    const priv = section('찾는 것 · 요즘 · 연락처');
    priv.classList.add('d-private');
    if (S && (S.isAdmin || isActiveMember(S))) {
      priv.append(h('p', 'hint', '불러오는 중…'));
      profileDb.private(p.id).then(x => {
        const rows = [['찾는 것', x?.seeking], ['요즘', x?.now], ['연락처', x?.contact]].filter(([, v]) => v);
        priv.lastChild.replaceWith(rows.length ? pairs(rows) : h('p', 'hint', '아직 적지 않으셨어요'));
      }).catch(e => { console.error(e); priv.lastChild.replaceWith(h('p', 'hint', '읽지 못했어요')); });
    } else {
      const note = h('p', 'hint', '로그인한 교수님만 봐요. ');
      const go = h('a', '', '로그인');
      go.href = `${LOUNGE_ROOT}login/?next=${encodeURIComponent(location.pathname + location.hash)}`;
      note.append(go);
      priv.append(note);
    }
    nodes.push(priv);

    if (myPid === p.id) {
      const edit = h('a', 'btn primary', '내 프로필 고치기');
      edit.href = 'me/';
      const acts = h('div', 'form-actions');
      acts.append(edit);
      nodes.push(acts);
    }
    detailView.replaceChildren(...nodes);
  }

  // ---------- 목록 ↔ 자세히 ----------
  function route() {
    const id = detailId();
    back.title = id ? '목록으로' : '처음으로';
    back.setAttribute('aria-label', back.title);
    if (id) {
      if (!listView.hidden) listScroll = scrollY;
      listView.hidden = true;
      detailView.hidden = false;
      paintDetail(id);
      scrollTo(0, 0);
      return;
    }
    const wasDetail = !detailView.hidden;
    f = readHash(location.hash);
    input.value = f.q;
    detailView.hidden = true;
    listView.hidden = false;
    paintFilters();
    paintList();
    if (wasDetail) scrollTo(0, listScroll);
  }
  // 자세히에서 ‹: 목록에서 들어왔으면 뒤로 가기(폰 뒤로 단추와 같게), 링크로 바로 왔으면 목록으로 바꿈
  back.addEventListener('click', e => {
    if (!detailId()) return;
    e.preventDefault();
    if (fromList) { fromList = false; history.back(); return; }
    history.replaceState(null, '', location.pathname + location.search);
    route();
  });
  addEventListener('hashchange', route);
  route();

  // ---------- 로그인 상태와 Firestore 프로필 (못 읽으면 이름북 그대로) ----------
  const [s, docs] = await Promise.allSettled([session(), profileDb.all()]);
  if (s.status === 'fulfilled') {
    S = s.value;
    mountAccountChip(S, { myProfile: true });
    if (isActiveMember(S)) {
      try { myPid = await profileDb.myId(S.user.email); } catch (e) { console.error(e); }
    }
  } else console.error(s.reason);
  if (docs.status === 'fulfilled') people = mergeProfiles(data.people, docs.value, data.photos);
  else console.error(docs.reason);
  route();
})();
