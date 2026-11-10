"""이름북(Biomed_KNUmed)의 기초 교수님 소개를 라운지 디렉터리 데이터로 옮겨요.

    python3 pipeline/from_namebook.py <Biomed_KNUmed 저장소 경로>

- 기초(kind == '기초')만 가져와요.
- 메일·담당자 연락처·연구 스타일(style)은 빼요. 공개 디렉터리에는 메일을 넣지 않아요 (DESIGN.md §3).
- 프로필 번호는 메일과 무관한 값이에요. 이미 data/people.json에 있는 분은 같은 번호를 그대로 써요.
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


def main(namebook):
    nb = Path(namebook) / 'namebook'
    profs = json.loads((nb / 'data' / 'profs.json').read_text(encoding='utf-8'))['profs']
    quiz = json.loads((nb / 'data' / 'quiz.json').read_text(encoding='utf-8'))

    old = {}
    if OUT.exists():
        for p in json.loads(OUT.read_text(encoding='utf-8'))['people']:
            old[(p['name'], p['dept'])] = p['id']
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

    data = {
        'meta': {
            'from': 'Biomed_KNUmed namebook (의과학과 교수진 소개, 학부생용)',
            'note': '공개 파일이에요. 메일·연락처를 넣지 않아요.',
        },
        'topics': [{'key': k, 'emoji': e, 'label': label} for k, e, label in quiz['topics']],
        'people': people,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(people)}명 → {OUT.relative_to(ROOT)}, 사진 {sum(1 for x in people if x["photo"])}장')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
