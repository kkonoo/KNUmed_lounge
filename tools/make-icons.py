"""앱 아이콘(icons/*.png)을 icons/icon.svg에서 그려요.

    python3 tools/make-icons.py      (Playwright 필요: pip install playwright && playwright install chromium)

icon.svg = Lucide 'sofa' 아이콘(ISC)을 강조색 바탕에 흰 선으로. 그림을 바꾸려면 icon.svg만 고치고 다시 돌려요.
- app-*.png          둥근 사각형 (안드로이드·PC)
- app-maskable-*.png 꽉 찬 사각형 (기기가 알아서 동그랗게·둥글게 자름. 그림이 가운데 80% 안에 있음)
- apple-touch-icon   꽉 찬 사각형, 투명 없음 (아이폰이 알아서 둥글게)
"""
import asyncio
import re
from pathlib import Path

from playwright.async_api import async_playwright

ICONS = Path(__file__).resolve().parent.parent / 'icons'
SVG = (ICONS / 'icon.svg').read_text(encoding='utf-8')
SQUARE = re.sub(r'rx="\d+"', 'rx="0"', SVG)  # 마스커블·애플: 모서리 없이 꽉 차게


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        for name, svg, size in [
            ('app-192.png', SVG, 192), ('app-512.png', SVG, 512),
            ('app-maskable-192.png', SQUARE, 192), ('app-maskable-512.png', SQUARE, 512),
            ('apple-touch-icon.png', SQUARE, 180),
        ]:
            await pg.set_viewport_size({'width': size, 'height': size})
            await pg.set_content(f'<style>html,body{{margin:0;background:transparent}}svg{{display:block;width:{size}px;height:{size}px}}</style>{svg}')
            await pg.screenshot(path=str(ICONS / name), omit_background=name != 'apple-touch-icon.png')
            print(name)
        await b.close()

asyncio.run(main())
