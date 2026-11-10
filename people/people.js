'use strict';
// 연구실 둘러보기 화면: data/people.json을 읽어 찾기·교실·주제로 거르고 교실별로 보여 줌
// 계산은 people-core.js, 공용 부품(h, button)은 js/ui.js

(async () => {
  const app = $('app');
  let data;
  try {
    const res = await fetch('../data/people.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    app.append(h('p', 'empty-note', '교수님 목록을 읽지 못했어요. 잠시 뒤 새로 고쳐 주세요.'));
    return;
  }
  const people = data.people;
  let f = readHash(location.hash);

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
  app.append(finder, list);

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

  function card(p) {
    const a = h('article', 'prof');
    a.id = `p-${p.id}`;
    let photo;
    if (p.photo) {
      photo = h('img', 'photo');
      Object.assign(photo, { src: `../${p.photo}`, alt: '', loading: 'lazy', decoding: 'async', width: 96, height: 128 });
    } else {
      photo = h('div', 'photo empty');
      photo.append(icon('user'));
    }
    const body = h('div', '');
    const name = h('h3', '', p.name);
    name.append(h('small', '', p.rank));
    body.append(name, h('p', 'dept', p.dept), h('p', 'line', p.line));
    if (p.keywords?.length) {
      const kw = h('ul', 'kw');
      for (const k of p.keywords) kw.append(h('li', '', k));
      body.append(kw);
    }
    if (p.links?.length) {
      const links = h('p', 'links');
      for (const [url, label] of p.links) {
        const l = h('a', '', label);
        Object.assign(l, { href: url, target: '_blank', rel: 'noopener' });
        links.append(l);
      }
      body.append(links);
    }
    a.append(photo, body);
    return a;
  }

  function paintList() {
    const shown = filterPeople(people, f);
    const any = f.q.trim() || f.dept || f.topic;
    const n = h('span');
    n.append(h('b', '', shown.length), `명 / ${people.length}명`);
    count.replaceChildren(n);
    if (any) count.append(button('거르기 지우기', () => { input.value = ''; set({ q: '', dept: '', topic: '' }); }, 'btn small'));

    if (!shown.length) {
      list.replaceChildren(h('p', 'empty-note', '맞는 분이 없어요. 다른 말로 찾거나 거르기를 지워 보세요.'));
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
  }

  function set(patch) {
    f = { ...f, ...patch };
    history.replaceState(null, '', writeHash(f) || location.pathname + location.search);
    paintFilters();
    paintList();
  }

  input.addEventListener('input', () => set({ q: input.value }));
  addEventListener('hashchange', () => { f = readHash(location.hash); input.value = f.q; paintFilters(); paintList(); });

  paintFilters();
  paintList();
})();
