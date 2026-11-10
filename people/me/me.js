'use strict';
// 내 프로필 고치기: 연구실 둘러보기에 보이는 내 소개와, 로그인한 교수님만 보는 칸
// 저장하면 '본인 확인'이 되어 연구실 둘러보기에 이 내용으로 보여요. 고칠 수 있는 건 내 명단 줄에 이어진 프로필뿐 (firestore.rules)
// 계산은 ../people-core.js (profileForm · cleanProfile · profileProblem), 데이터는 ../profile-db.js, 입력 부품은 js/form.js

const app = $('app');
const stop = text => app.replaceChildren(h('p', 'msg err', text));

async function start() {
  let S;
  try { S = await session(); } catch (e) { console.error(e); return stop('연결하지 못했어요. 인터넷을 확인하고 새로 고쳐 주세요.'); }
  if (!S.user) return goLogin();
  mountAccountChip(S);
  if (!isActiveMember(S)) return stop(S.member ? '사용이 멈춘 계정이에요. 관리자에게 알려 주세요.' : '가입을 마쳐야 고칠 수 있어요.');
  let pid, doc, priv, book;
  try {
    pid = await profileDb.myId(S.user.email);
    if (!pid) return stop('아직 연구실 둘러보기 프로필과 이어지지 않았어요. 관리자에게 알려 주세요.');
    [doc, priv, book] = await Promise.all([
      profileDb.get(pid), profileDb.private(pid),
      fetch('../../data/people.json', { cache: 'no-cache' }).then(r => r.json()),
    ]);
  } catch (e) { console.error(e); return stop(`읽지 못했어요: ${authMessage(e)}`); }
  if (!doc) return stop('프로필을 찾지 못했어요. 관리자에게 알려 주세요.');
  render(S, pid, doc, priv || {}, book);
}

const area = (value, maxLength, rows, placeholder = '') => { const t = h('textarea'); Object.assign(t, { value, maxLength, rows, placeholder }); return t; };
// 섹션 하나 = 접고 펴는 칸. 제목 옆에 채운 칸 수를 보여 줘서 접어 둬도 어디가 비었는지 알 수 있게
function section(title, hint, ...nodes) {
  const d = h('details', 'me-sec');
  const sum = h('summary');
  const filled = h('small', '');
  sum.append(h('span', '', title), filled);
  const body = h('div', 'me-sec-body');
  if (hint) body.append(h('p', 'hint', hint));
  body.append(...nodes);
  d.append(sum, body);
  const count = () => {
    const inputs = [...body.querySelectorAll('input, textarea')];
    filled.textContent = `${inputs.filter(i => i.value.trim()).length}/${inputs.length}칸`;
  };
  body.addEventListener('input', count);
  count();
  return d;
}

function render(S, pid, doc, priv, book) {
  const M = PROFILE_MAX;
  const v = profileForm(doc, { ...book.people.find(p => p.id === pid), ...book.drafts?.[pid] }); // 저장 전엔 이름북 + 논문 초안

  const who = h('div', 'me-who');
  who.append(h('b', '', `${doc.name} 교수님`), h('span', '', doc.dept || ''));
  const state = h('p', 'hint');
  const paintState = ms => {
    state.textContent = ms
      ? `마지막 확인 ${fmtDay(ms)} 바뀐 게 없어도 저장을 누르면 오늘 확인한 것으로 남아요.`
      : '아직 확인 전이에요. 저장하면 연구실 둘러보기에 이 내용으로 보여요.';
  };
  paintState(doc.confirmedAt);

  // 소개
  const rank = textInput('text', { value: v.rank, maxLength: M.rank, placeholder: '예: 교수' });
  const room = textInput('text', { value: v.room, maxLength: M.room, placeholder: '예: 의대 본관 3층 305호' });
  const line = area(v.line, M.line, 2, '무엇을 연구하는지 한 문장으로');
  const question = area(v.question, M.question, 3, '지금 묻고 있는 질문을 2~3문장으로');
  const keywords = textInput('text', { value: v.keywords, placeholder: '쉼표로 나눠요' });
  const topics = new Set(v.topics);
  const topicPills = h('div', 'pills');
  const paintTopics = () => topicPills.replaceChildren(...book.topics.map(t => {
    const b = button(`${t.emoji} ${t.label}`, () => { topics.has(t.key) ? topics.delete(t.key) : topics.add(t.key); dirty = true; paintTopics(); }, topics.has(t.key) ? 'on' : '');
    b.setAttribute('aria-pressed', String(topics.has(t.key)));
    return b;
  }));
  paintTopics();

  // 연구 축 3칸
  const axes = v.axes.map((a, i) => {
    const name = textInput('text', { value: a.name, maxLength: M.axisName, placeholder: '축 이름' });
    const text = area(a.text, M.axisText, 2, '이 축에서 묻는 것 한 문장');
    const papers = area(a.papers, 700, 2, '대표 논문 2편까지, 한 줄에 하나\n예: Brain 2023 https://doi.org/…');
    const slot = h('div', 'slot');
    slot.append(h('b', '', `연구 축 ${i + 1}`), name, text, papers);
    return { slot, name, text, papers };
  });
  // 발자취 4줄
  const steps = v.timeline.map(t => {
    const years = textInput('text', { value: t.years, maxLength: M.years, placeholder: '2016–2020' });
    const text = textInput('text', { value: t.text, maxLength: M.step, placeholder: '그때 한 일 한 줄' });
    const row = h('div', 'step');
    row.append(years, text);
    return { row, years, text };
  });
  // 보유 자원 5칸
  const res = RESOURCE_KINDS.map(([k, label]) => [k, label, area(v.resources[k], M.resource, 2)]);
  // 링크 4줄
  const links = v.links.map(l => {
    const label = textInput('text', { value: l.label, maxLength: M.label, placeholder: '이름 (비우면 주소로)' });
    const url = textInput('url', { value: l.url, maxLength: M.url, placeholder: 'https://' });
    const row = h('div', 'link-row');
    row.append(label, url);
    return { row, label, url };
  });
  // 로그인한 교수님만
  const seeking = area(priv.seeking || '', M.seeking, 2);
  const now = textInput('text', { value: priv.now || '', maxLength: M.now, placeholder: '예: 단일세포 분석을 시작했어요' });
  const contact = textInput('text', { value: priv.contact || '', maxLength: M.contact, placeholder: '예: 연구실 내선, 담당 연구원' });

  const form = h('form', 'me-form'), msg = msgBox();
  const intro = section('소개', '', field('직위', rank), field('연구실', room), field('한 줄 소개', line), field('연구 질문', question), field('키워드', keywords, `${M.keywords}개까지`), block('주제', topicPills));
  const save = h('button', 'btn primary', '확인하고 저장');
  save.type = 'submit';
  const view = h('a', 'btn', '연구실 둘러보기에서 보기');
  view.href = `../#p=${pid}`;
  const acts = h('div', 'form-actions');
  acts.append(save, view);
  const privBox = section('로그인한 교수님만 보는 칸', '',
    field('찾는 것', seeking, '자원이나 기법 수준으로 적어 주세요(예: 마우스 혈장 지질 정량, 환자 PBMC)'),
    field('요즘 한 줄', now), field('연락처·담당자', contact));
  privBox.classList.add('private');
  form.append(
    who, state,
    intro,
    section('연구 축', `${M.axes}개까지`, ...axes.map(a => a.slot)),
    section('연구 발자취', `기간마다 한 줄, ${M.timeline}줄까지`, ...steps.map(s => s.row)),
    section('보유 자원', '다른 교수님과 같이 쓰거나 빌려드릴 수 있는 것. 없는 칸은 비워 두셔도 돼요', ...res.map(([, label, t]) => field(label, t))),
    section('링크', '연구실 홈페이지, Google Scholar, ORCID 같은 곳', ...links.map(l => l.row)),
    privBox, msg, acts,
  );
  intro.open = true; // 처음엔 소개만 펼침

  let dirty = false;
  form.addEventListener('input', () => { dirty = true; });
  addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pub = cleanProfile({
      rank: rank.value, room: room.value, line: line.value, question: question.value, keywords: keywords.value, topics: [...topics],
      axes: axes.map(a => ({ name: a.name.value, text: a.text.value, papers: a.papers.value })),
      timeline: steps.map(s => ({ years: s.years.value, text: s.text.value })),
      resources: Object.fromEntries(res.map(([k, , t]) => [k, t.value])),
      links: links.map(l => ({ label: l.label.value, url: l.url.value })),
    });
    say(msg, profileProblem(pub));
    if (!msg.hidden) { form.querySelectorAll('details.me-sec').forEach(d => { d.open = true; }); return; }
    try {
      await busy(save, '저장하는 중…', () => profileDb.save(pid, pub, { seeking: seeking.value.trim(), now: now.value.trim(), contact: contact.value.trim() }, S.user.uid));
      dirty = false;
      paintState(Date.now());
      toast('저장했어요. 연구실 둘러보기에 이 내용으로 보여요', 3000);
    } catch (err) { say(msg, authMessage(err)); }
  });
  app.replaceChildren(form);
}

start();
