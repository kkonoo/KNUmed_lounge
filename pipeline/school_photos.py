"""이름북에 없는 교수님 프로필에 학교 홈페이지 교수소개 사진과 직위를 붙여요.

    python3 pipeline/school_photos.py

- 공개 프로필(Firestore profiles, 누구나 읽음)에서 이름북(data/people.json의 people)에 없는 분을 찾아요.
- 의과대학 홈페이지 교수소개의 기초 교실 목록에서 이름과 교실이 맞는 분이 한 분뿐일 때만 사진을 가져와요.
- 사진은 photos/<프로필 번호>.jpg로 줄여서 저장하고(긴 쪽 480px), data/people.json의 photos에 번호 → 파일을 적어요.
- 직위(교수·부교수·조교수)는 data/people.json의 ranks에 번호 → 직위로 적어요. 사진이 이미 있어도 다시 맞춰요.
- 사진만 가져와요. 학교 페이지의 메일·연구실 같은 건 읽어도 저장하지 않아요. 이름도 저장소에 적지 않아요.
- 이미 사진이 있는 분은 건너뛰어요. 새로 더한 교수님이 생기면 다시 돌리면 돼요.
"""
import io
import json
import re
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'people.json'
PHOTOS = ROOT / 'photos'
SITE = 'https://med.knu.ac.kr'
LIST = f'{SITE}/pages/sub.htm?nav_code=knu1670413496&view_cate=&view_cate2='
# 교수소개의 기초 교실 (view_cate2 번호)
BASIC = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (lounge photo script)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def public_profiles():
    """Firestore REST로 공개 프로필을 읽어요 (규칙이 누구나 읽게 함)."""
    cfg = (ROOT / 'js' / 'firebase-config.js').read_text(encoding='utf-8')
    key = re.search(r"apiKey: '([^']+)'", cfg).group(1)
    project = re.search(r"projectId: '([^']+)'", cfg).group(1)
    base = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/profiles?pageSize=300&key={key}'
    out, token = [], ''
    while True:
        page = json.loads(get(base + (f'&pageToken={token}' if token else '')))
        for d in page.get('documents', []):
            f = {k: next(iter(v.values()), None) for k, v in d.get('fields', {}).items()}
            out.append({'id': d['name'].rsplit('/', 1)[1], 'name': f.get('name', ''), 'dept': f.get('dept', ''), 'hidden': f.get('hidden', False)})
        token = page.get('nextPageToken')
        if not token:
            return out


def school_list():
    """기초 교실 목록 페이지에서 (이름, 교실, 사진 주소, 직위)만 모아요."""
    seen, out = set(), []
    for cate in BASIC:
        todo, done = [LIST + str(cate)], set()
        while todo:
            url = todo.pop()
            if url in done:
                continue
            done.add(url)
            html = get(url).decode('utf-8', 'replace')
            for li in re.findall(r'<li><div class="thumb">.*?</li>', html, re.S):
                img = re.search(r'<img src="\.\./(data/memData/[^"]+)"', li)
                name = re.search(r'class="name[^"]*"><span>([^<]+)</span>', li)
                dept = re.search(r'소속교실</dt>\s*<dd class="txt">([^<]*)</dd>', li)
                rank = re.search(r'직위</dt>\s*<dd class="txt">([^<]*)</dd>', li)
                if img and name and img.group(1) not in seen:
                    seen.add(img.group(1))
                    out.append((name.group(1).strip(), (dept.group(1) if dept else '').strip(),
                                f'{SITE}/{img.group(1)}', (rank.group(1) if rank else '').strip()))
            paging = html.split('class="board-paging"', 1)[1] if 'class="board-paging"' in html else ''
            for href in re.findall(r"href='(/pages/sub\.htm\?mv_data=[^']+)'", paging.split('</div>', 1)[0]):
                todo.append(SITE + href)
    return out


short = lambda d: re.sub(r'\s|교실$', '', d)


def main():
    data = json.loads(OUT.read_text(encoding='utf-8'))
    book = {p['id'] for p in data['people']}
    photos, ranks = data.get('photos', {}), data.get('ranks', {})
    want = [p for p in public_profiles() if p['id'] not in book and not p['hidden']]
    school = school_list()
    print(f'이름북에 없는 프로필 {len(want)}분, 학교 홈페이지 기초 교실 {len(school)}분')

    PHOTOS.mkdir(exist_ok=True)
    missed = []
    for p in want:
        same = [s for s in school if s[0] == p['name'] and short(s[1]) == short(p['dept'])]
        if len(same) != 1:
            missed.append(f"{p['name']} ({p['dept']}): 학교 홈페이지에서 {len(same)}분")
            continue
        if same[0][3]:
            ranks[p['id']] = same[0][3]
        if p['id'] in photos:  # 사진은 이미 있음 (직위만 다시 맞춤)
            continue
        img = Image.open(io.BytesIO(get(same[0][2]))).convert('RGB')
        img.thumbnail((480, 480))
        img.save(PHOTOS / f"{p['id']}.jpg", 'JPEG', quality=82, optimize=True, progressive=True)
        photos[p['id']] = f"photos/{p['id']}.jpg"

    data['photos'] = dict(sorted(photos.items()))
    data['ranks'] = dict(sorted(ranks.items()))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'직위 {len(want) - len(missed)}개를 맞췄어요 (사진은 없던 분만 받았어요)')
    for m in missed:
        print('  못 찾음:', m)


if __name__ == '__main__':
    main()
