"""이름북(Biomed_KNUmed)의 기초 교수님 소개를 라운지 디렉터리 데이터로 옮겨요.

    python3 pipeline/from_namebook.py <Biomed_KNUmed 저장소 경로>

- 기초(kind == '기초')만 가져와요.
- 메일·담당자 연락처·연구 스타일(style)은 빼요. 공개 디렉터리에는 메일을 넣지 않아요 (DESIGN.md §3).
- 프로필 번호는 메일과 무관한 값이에요. 이미 data/people.json에 있는 분은 같은 번호를 그대로 써요.
- 이름북에 없어 손으로 더한 분(status가 'namebook'이 아닌 분)은 그대로 두어요. 이름북에 들어오면 이름북 쪽으로 바뀌어요.
- 사진은 photos/<번호>.jpg로 줄여서 옮겨요 (긴 쪽 480px).
"""
import json
import secrets
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'people.json'
PHOTOS = ROOT / 'photos'
ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'  # 헷갈리는 글자(i l o 0 1) 뺌


def new_id(taken):
    while True:
        pid = ''.join(secrets.choice(ALPHABET) for _ in range(6))
        if pid not in taken:
            return pid


# 글자 모양(선)으로 그려지기 쉬운 이모지(🎗 🛡 👁)는 이모지 표시(U+FE0F)를 붙여 다른 주제처럼 색 이모지로
TEXT_STYLE = {'\U0001F397', '\U0001F6E1', '\U0001F441'}


def emoji(e):
    return e + '\ufe0f' if e in TEXT_STYLE else e


def main(namebook):
    nb = Path(namebook) / 'namebook'
    profs = json.loads((nb / 'data' / 'profs.json').read_text(encoding='utf-8'))['profs']
    quiz = json.loads((nb / 'data' / 'quiz.json').read_text(encoding='utf-8'))

    old, photos, ranks, drafts, extra = {}, {}, {}, {}, {}
    if OUT.exists():
        prev = json.loads(OUT.read_text(encoding='utf-8'))
        photos = prev.get('photos', {})  # 이름북에 없는 분 사진 (pipeline/school_photos.py)
        ranks = prev.get('ranks', {})    # 이름북에 없는 분 직위 (pipeline/school_photos.py)
        drafts = prev.get('drafts', {})  # 논문으로 만든 프로필 초안 (DESIGN §9)
        for p in prev['people']:
            old[(p['name'], p['dept'])] = p['id']
            if p.get('status') != 'namebook':
                extra[(p['name'], p['dept'])] = p  # 이름북에 없어 학교 교수소개에서 더한 분
    taken = set(old.values())

    PHOTOS.mkdir(exist_ok=True)
    people = []
    for p in profs:
        if p['kind'] != '기초':
            continue
        key = (p['name'], p['dept'])
        pid = old.get(key) or new_id(taken)
        taken.add(pid)

        photo = None
        src = nb / p['photo'] if p.get('photo') else None
        if src and src.exists():
            img = Image.open(src).convert('RGB')
            img.thumbnail((480, 480))
            img.save(PHOTOS / f'{pid}.jpg', 'JPEG', quality=82, optimize=True, progressive=True)
            photo = f'photos/{pid}.jpg'

        links = [[url, label] for url, label in p.get('links', []) if not url.startswith('mailto:') and '@' not in url]
        people.append({
            'id': pid,
            'name': p['name'],
            'rank': p['rank'],
            'dept': p['dept'],
            'group': '기초',
            'line': p['line'],
            'keywords': p['keywords'],
            'topics': p.get('topics', []),
            'links': links,
            'photo': photo,
            'source': p.get('source', ''),
            'status': 'namebook',  # 이름북 소개 그대로. 본인 확인을 거치면 'confirmed'
        })

    done = {(p['name'], p['dept']) for p in people}
    people += [p for key, p in extra.items() if key not in done]  # 이름북에 들어오면 이름북 쪽을 써요

    data = {
        'meta': {
            'from': 'Biomed_KNUmed namebook (의과학과 교수진 소개, 학부생용)',
            'note': '공개 파일이에요. 메일·연락처를 넣지 않아요.',
        },
        'topics': [{'key': k, 'emoji': emoji(e), 'label': label} for k, e, label in quiz['topics']],
        'people': people,
        'photos': photos,
        'ranks': ranks,
        'drafts': drafts,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(people)}명 → {OUT.relative_to(ROOT)}, 사진 {sum(1 for x in people if x["photo"])}장')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
