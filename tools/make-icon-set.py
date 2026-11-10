"""Lucide 아이콘 중 라운지에서 쓰는 것만 js/icons.js로 모아요 (바깥 CDN 없이, 오프라인에서도 보이게).

    npm i lucide-static        (아무 폴더에서)
    python3 tools/make-icon-set.py <그 폴더>/node_modules/lucide-static/icons

아이콘을 더하려면 아래 NAMES에 이름(https://lucide.dev/icons)을 넣고 다시 돌려요. Lucide는 ISC 라이선스예요.
"""
import json
import re
import sys
from pathlib import Path

NAMES = [
    'chevron-left', 'x', 'plus', 'copy', 'search', 'user', 'eye', 'eye-off', 'dices',
    'sun-moon', 'sun', 'moon', 'smartphone',
    'utensils', 'microscope', 'handshake', 'map-pin', 'clock', 'coffee',
    'messages-square', 'message-square',
]
src = Path(sys.argv[1])
icons, version = {}, ''
for name in NAMES:
    text = (src / f'{name}.svg').read_text(encoding='utf-8')
    version = version or (re.search(r'lucide-static v([\d.]+)', text) or [None, ''])[1]
    inner = re.search(r'<svg[^>]*>(.*)</svg>', text, re.S)[1]
    icons[name] = re.sub(r'\s+', ' ', inner).replace('> <', '><').strip()

lines = [
    "'use strict';",
    f'// Lucide 아이콘 (lucide-static v{version}, ISC, https://lucide.dev) 중 라운지에서 쓰는 것만. tools/make-icon-set.py가 만든 파일이에요',
    '// icon(이름) → 선 아이콘 <svg> (글자색을 따라감). HTML에서는 <span data-icon="이름"></span>을 쓰면 읽을 때 바꿔 줘요',
    'const ICONS = {',
    *[f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},' for k, v in icons.items()],
    '};',
    'function icon(name, cls = \'\') {',
    "  const t = document.createElement('template');",
    "  t.innerHTML = `<svg class=\"lc${cls ? ` ${cls}` : ''}\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${ICONS[name] || ''}</svg>`;",
    '  return t.content.firstChild;',
    '}',
    "addEventListener('DOMContentLoaded', () => {",
    "  for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));",
    '});',
    '',
]
out = Path(__file__).resolve().parent.parent / 'js' / 'icons.js'
out.write_text('\n'.join(lines), encoding='utf-8')
print(f'{len(icons)}개 → {out.name}')
