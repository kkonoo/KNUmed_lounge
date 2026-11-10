'use strict';
// 화면 밝기: 🌗 자동(폰·PC 설정 따라) · ☀️ 밝게 · 🌙 어둡게. 모든 페이지가 <head>에서 읽음 (이 기기 localStorage 'lounge:theme')
// 그리기 전에 <html data-theme>를 붙여서 어두운 화면이 밝게 번쩍이지 않음. 색은 css/base.css(와 게임 css)의 :root[data-theme]가 정함
// 머리 줄 끝에 단추를 넣고, 누르면 셋 중 고르는 작은 메뉴 (popover가 없는 브라우저는 누를 때마다 차례로 바뀜)
(() => {
  const KEY = 'lounge:theme', root = document.documentElement;
  const MODES = [['auto', '🌗', '자동 (기기 설정)'], ['light', '☀️', '밝게'], ['dark', '🌙', '어둡게']];
  let mode = 'auto';
  try { mode = localStorage.getItem(KEY) || 'auto'; } catch { /* 못 읽으면 자동 */ }
  if (!MODES.some(m => m[0] === mode)) mode = 'auto';

  function apply() {
    if (mode === 'auto') delete root.dataset.theme; else root.dataset.theme = mode;
    // 주소창·상태 표시줄 색: 고른 밝기로. 자동이면 원래 값(media로 나뉜 두 줄)으로
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      m.dataset.auto ||= m.content;
      m.content = mode === 'auto' ? m.dataset.auto : mode === 'dark' ? '#121214' : '#F5F4F0';
    }
  }
  function set(next) {
    mode = next;
    try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch { /* 못 써도 이번엔 바뀜 */ }
    apply();
    paint();
  }
  apply();

  let btn = null, menu = null;
  function paint() {
    if (!btn) return;
    const [, icon, label] = MODES.find(m => m[0] === mode);
    btn.textContent = icon;
    btn.title = `화면: ${label}`;
    btn.setAttribute('aria-label', btn.title);
    for (const b of menu?.children || []) b.classList.toggle('on', b.dataset.mode === mode);
  }
  addEventListener('DOMContentLoaded', () => {
    apply(); // 이 파일보다 뒤에 있는 meta도 맞춤
    const head = document.querySelector('.game-head');
    if (!head) return;
    let end = head.querySelector('.head-end');
    if (!end) { end = document.createElement('span'); end.className = 'head-end'; head.append(end); }
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn theme-btn';
    if (HTMLElement.prototype.showPopover) {
      menu = document.createElement('div');
      menu.className = 'theme-menu';
      menu.popover = 'auto';
      for (const [m, icon, label] of MODES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.mode = m;
        b.textContent = `${icon} ${label}`;
        b.addEventListener('click', () => { set(m); menu.hidePopover(); });
        menu.append(b);
      }
      menu.addEventListener('beforetoggle', e => { // 단추 바로 아래, 오른쪽 끝을 맞춰서
        if (e.newState !== 'open') return;
        const r = btn.getBoundingClientRect();
        menu.style.top = `${r.bottom + 6}px`;
        menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      });
      document.body.append(menu);
      btn.popoverTargetElement = menu; // 단추가 여닫음 (열린 채로 다시 누르면 닫힘)
    } else {
      btn.addEventListener('click', () => set(MODES[(MODES.findIndex(m => m[0] === mode) + 1) % MODES.length][0]));
    }
    end.append(btn);
    paint();
  });
})();
