'use strict';
// 화면 밝기(자동 · 밝게 · 어둡게)와 글씨 크기(--fs 배율). 모든 페이지가 <head>에서 읽음
// 이 기기 localStorage 'lounge-prefs' { theme, fs }. 그리기 전에 붙여서 어두운 화면이 밝게 번쩍이지 않음
// 머리 줄(.topbar) 끝에 밝기 단추(Lucide 해·달)를 넣고, 누르면 고르는 작은 메뉴 (toy_box js/theme.js에서 가져와 글씨 크기를 더함)
(() => {
  const KEY = 'lounge-prefs', root = document.documentElement;
  const THEMES = [['auto', 'sun-moon', '자동 (기기 설정)'], ['light', 'sun', '밝게'], ['dark', 'moon', '어둡게']];
  const SIZES = [[0.9, '작게'], [1, '보통'], [1.15, '크게'], [1.3, '아주 크게']];
  let prefs = { theme: 'auto', fs: 1 };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* 처음이거나 못 읽음 */ }
  if (!THEMES.some(t => t[0] === prefs.theme)) prefs.theme = 'auto';
  if (!SIZES.some(s => s[0] === prefs.fs)) prefs.fs = 1;

  function apply() {
    if (prefs.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
    root.style.setProperty('--fs', prefs.fs);
    // 주소창·상태 표시줄 색: 고른 밝기로. 자동이면 원래 값(media로 나뉜 두 줄)으로
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      m.dataset.auto ||= m.content;
      m.content = prefs.theme === 'auto' ? m.dataset.auto : prefs.theme === 'dark' ? '#121214' : '#F5F4F0';
    }
  }
  function set(patch) {
    prefs = { ...prefs, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 못 써도 이번엔 바뀜 */ }
    apply();
    paint();
  }
  apply();

  let btn = null, menu = null;
  function paint() {
    if (!btn) return;
    const [, icon, label] = THEMES.find(t => t[0] === prefs.theme);
    btn.replaceChildren(window.icon ? window.icon(icon) : '◐');
    btn.title = `화면: ${label} · 글씨: ${SIZES.find(s => s[0] === prefs.fs)[1]}`;
    btn.setAttribute('aria-label', btn.title);
    for (const b of menu?.querySelectorAll('button') || []) {
      b.classList.toggle('on', b.dataset.theme ? b.dataset.theme === prefs.theme : +b.dataset.fs === prefs.fs);
    }
  }
  addEventListener('DOMContentLoaded', () => {
    apply(); // 이 파일보다 뒤에 있는 meta도 맞춤
    const head = document.querySelector('.topbar');
    if (!head) return;
    let end = head.querySelector('.head-end');
    if (!end) { end = document.createElement('span'); end.className = 'head-end'; head.append(end); }
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    if (HTMLElement.prototype.showPopover) {
      menu = document.createElement('div');
      menu.className = 'theme-menu';
      menu.popover = 'auto';
      const label = t => { const d = document.createElement('div'); d.className = 'menu-label'; d.textContent = t; return d; };
      const item = (text, data, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        Object.assign(b.dataset, data);
        b.textContent = text;
        b.addEventListener('click', onClick);
        return b;
      };
      menu.append(label('화면 밝기'));
      for (const [t, ic, text] of THEMES) { const b = item(text, { theme: t }, () => { set({ theme: t }); menu.hidePopover(); }); b.prepend(icon(ic)); menu.append(b); }
      menu.append(document.createElement('hr'), label('글씨 크기'));
      for (const [fs, text] of SIZES) menu.append(item(text, { fs }, () => set({ fs })));
      menu.addEventListener('beforetoggle', e => { // 단추 바로 아래, 오른쪽 끝을 맞춰서
        if (e.newState !== 'open') return;
        const r = btn.getBoundingClientRect();
        menu.style.top = `${r.bottom + 6}px`;
        menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      });
      document.body.append(menu);
      btn.popoverTargetElement = menu; // 단추가 여닫음
    } else {
      btn.addEventListener('click', () => set({ theme: THEMES[(THEMES.findIndex(t => t[0] === prefs.theme) + 1) % THEMES.length][0] }));
    }
    end.append(btn);
    paint();
  });
})();
