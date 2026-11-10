"""받은 초안을 재 보고, 통과한 것만 data/people.json의 drafts에 넣어요 (DESIGN §9 3단계).

    python3 pipeline/apply_drafts.py           # 재 보고 보고서만 (people.json은 그대로)
    python3 pipeline/apply_drafts.py --write   # 통과한 것을 people.json에 넣기

- 넣는 칸은 { question, axes, timeline, resources } 뿐이에요.
  line·keywords·topics·links는 이름북 것을 그대로 둬요.
- 대표 논문 이름이 40자를 넘으면 학술지를 줄임말로 줄여요 (설명은 그대로).
- 두 가지를 봐요.
  1) 길이·칸 수: people/people-core.js 의 PROFILE_MAX (pipeline/check_drafts.js 가 재요).
  2) 대표 논문이 정말 그분의 후보 논문인지: DOI가 후보 목록(work/candidates.json)에 있고
     남긴 논문(kept_pmids)인지. 지어낸 인용을 걸러요.
- 보고서는 pipeline/work/report.md 에 적어요.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
WORK = HERE / 'work'
PEOPLE = ROOT / 'data' / 'people.json'


def norm_doi(s):
    """DOI를 맞춰 보기 좋은 꼴로. 띄어쓰기는 지워요(모델이 'j.ijmm b.2023'처럼 띄기도 해서요)."""
    s = (s or '').strip().lower()
    s = re.sub(r'^https?://(dx\.)?doi\.org/', '', s)
    return re.sub(r'\s+', '', s).rstrip('.')


LABEL_MAX = 40

# 연구 질문은 해요체예요 (DESIGN §9 '문체'). 모델이 더러 합니다체로 끝내서 끝말만 바꿔요.
# 손으로 고치면 이 스크립트를 다시 돌릴 때 지워지니, 여기서 하는 게 맞아요.
HAEYO = {
    '묻습니다': '물어요', '찾습니다': '찾아요', '살핍니다': '살펴요', '봅니다': '봐요',
    '살펴봅니다': '살펴봐요', '알아봅니다': '알아봐요', '밝힙니다': '밝혀요',
    '만듭니다': '만들어요', '합니다': '해요', '입니다': '이에요',
    '있습니다': '있어요', '없습니다': '없어요', '됩니다': '돼요',
}


def to_haeyo(q):
    """끝 문장이 합니다체면 해요체로. 바꿀 말이 표에 없으면 그대로 두고 알려요."""
    s = q.rstrip()
    if not s.endswith('.'):
        return q, False, False
    body = s[:-1]
    for a, b in sorted(HAEYO.items(), key=lambda kv: -len(kv[0])):
        if body.endswith(a):
            return body[:-len(a)] + b + '.', True, False
    return q, False, not re.search(r'요$', body)


def fit_label(label):
    """대표 논문 이름이 40자를 넘으면 학술지를 줄임말로 (DESIGN §9의 'STTT 2025 ·' 처럼).

    'Signal Transduct Target Ther 2026 · CAF 엑소좀' → 'STTT 2026 · CAF 엑소좀'.
    설명은 그대로 두고 학술지만 줄여요. 그래도 길면 손대지 않고 보고에 올려요.
    """
    if len(label) <= LABEL_MAX:
        return label, False
    head, sep, tail = label.partition(' · ')
    m = re.match(r'^(.*?)\s+((?:19|20)\d{2})$', head) if sep else None
    if m:
        words = [w for w in re.split(r'[\s()]+', m.group(1)) if w and w[0].isalpha()]
        if len(words) > 1:
            short = f"{''.join(w[0].upper() for w in words)} {m.group(2)} · {tail}"
            if len(short) <= LABEL_MAX:
                return short, True
    return label, False


def main(write=False):
    data = json.loads(PEOPLE.read_text(encoding='utf-8'))
    book = {p['id']: p for p in data['people']}
    cand = json.loads((WORK / 'candidates.json').read_text(encoding='utf-8'))
    results = json.loads((WORK / 'results.json').read_text(encoding='utf-8'))

    drafts, rows = {}, []
    for pid, r in results.items():
        person = book.get(pid)
        if person is None:
            rows.append({'id': pid, 'name': pid, 'ok': False, 'why': '이름북에 없는 번호'})
            continue
        papers = {p['pmid']: p for p in cand.get(pid, {}).get('papers', [])}
        by_doi = {norm_doi(p['doi']): p for p in papers.values() if p['doi']}
        kept = [str(x) for x in r.get('kept_pmids') or []]
        row = {'id': pid, 'name': person['name'], 'dept': person['dept'],
               'cand': len(papers), 'kept': len(kept), 'excluded': len(r.get('excluded') or []),
               'notes': (r.get('notes') or '').strip(), 'axes': [], 'why': '', 'ok': True}

        # 대표 논문이 그분의 후보이고 남긴 논문인지
        bad = []
        for a in r.get('axes') or []:
            picked = []
            for p in a.get('papers') or []:
                doi = norm_doi(p.get('url'))
                src = by_doi.get(doi)
                where = ''
                if src is None:
                    bad.append(f"'{a.get('name')}' 축의 {p.get('url')} 는 후보 논문에 없어요")
                else:
                    if src['pmid'] not in kept:
                        bad.append(f"'{a.get('name')}' 축의 PMID {src['pmid']} 는 남긴 논문이 아니에요")
                    m = src['me'][0] if src['me'] else {}
                    where = ('마지막 저자' if m.get('last_author') else f"{m.get('pos')}번째")
                    where += f" / {m.get('of')}명"
                picked.append({'label': p.get('label'), 'url': p.get('url'),
                               'pmid': src['pmid'] if src else '', 'year': src['year'] if src else '',
                               'author': where})
            row['axes'].append({'name': a.get('name'), 'papers': picked})

        q, fixed, odd = to_haeyo((r.get('question') or '').strip())
        row['haeyo_fixed'] = fixed
        row['haeyo_odd'] = odd
        axes = [a for a in (r.get('axes') or []) if (a.get('name') or '').strip()]
        if not q or not axes:
            row['ok'] = False
            row['why'] = '초안을 쓸 수 없다고 했어요'
        elif bad:
            row['ok'] = False
            row['why'] = '; '.join(bad)
        else:
            res = {k: (r.get('resources') or {}).get(k, '').strip() for k in ('techniques', 'models')}
            shortened = []

            def paper(p):
                lab, cut = fit_label(p['label'].strip())
                if cut:
                    shortened.append(f"{p['label'].strip()} → {lab}")
                # 주소는 후보 목록에 있는 그 논문의 DOI로 다시 씀 (띄어쓰기 같은 흠을 바로잡아요)
                src = by_doi.get(norm_doi(p.get('url')))
                url = f"https://doi.org/{src['doi']}" if src else p['url'].strip()
                return {'label': lab, 'url': url}

            drafts[pid] = {
                'question': q,
                'axes': [{'name': a['name'].strip(), 'text': (a.get('text') or '').strip(),
                          'papers': [paper(p) for p in (a.get('papers') or [])]} for a in axes],
                'timeline': [{'years': (t.get('years') or '').strip(), 'text': (t.get('text') or '').strip()}
                             for t in (r.get('timeline') or []) if (t.get('years') or '').strip()],
                'resources': {k: v for k, v in res.items() if v},
            }
            row['shortened'] = shortened
        rows.append(row)

    # 길이·칸 수는 people-core.js 로 (tests/people.test.js 와 같은 길)
    probe = {pid: {'base': book[pid], 'draft': d} for pid, d in drafts.items()}
    tmp = WORK / 'check-in.json'
    tmp.write_text(json.dumps(probe, ensure_ascii=False), encoding='utf-8')
    checked = json.loads(subprocess.run(['node', str(HERE / 'check_drafts.js'), str(tmp)],
                                        cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    for pid, problem in checked.items():
        if problem:
            drafts.pop(pid, None)
            for row in rows:
                if row['id'] == pid:
                    row['ok'] = False
                    row['why'] = problem

    ok = [r for r in rows if r['ok']]
    print(f'초안 {len(rows)}개 중 {len(ok)}개 통과')
    for r in rows:
        if not r['ok']:
            print(f"  못 넣음 {r['name']} ({r['id']}): {r['why']}")

    report(rows)
    if write:
        data['drafts'] = dict(sorted({**data.get('drafts', {}), **drafts}.items()))
        PEOPLE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f"→ {PEOPLE.relative_to(ROOT)} 의 drafts {len(data['drafts'])}명")
    else:
        print('(--write 를 주면 people.json에 넣어요)')


def report(rows):
    L = ['# 논문 초안 만들기 보고', '',
         f"초안 {len(rows)}개 중 {sum(1 for r in rows if r['ok'])}개가 한도를 통과했어요.", '',
         '| 교수님 | 교실 | 후보 | 남김 | 뺌 | 들어감 |', '|---|---|---|---|---|---|']
    for r in sorted(rows, key=lambda x: (x.get('dept', ''), x['name'])):
        L.append(f"| {r['name']} | {r.get('dept', '')} | {r.get('cand', 0)} | {r.get('kept', 0)}"
                 f" | {r.get('excluded', 0)} | {'예' if r['ok'] else '아니요'} |")
    for r in sorted(rows, key=lambda x: (x.get('dept', ''), x['name'])):
        L += ['', f"## {r['name']} ({r.get('dept', '')}, {r['id']})",
              f"- 후보 {r.get('cand', 0)}편 → 남김 {r.get('kept', 0)}편, 뺌 {r.get('excluded', 0)}편"]
        for a in r.get('axes', []):
            L.append(f"- 축 '{a['name']}'")
            for p in a['papers']:
                L.append(f"    - {p['label']} · PMID {p['pmid']} · {p['author']} · {p['url']}")
            if not a['papers']:
                L.append('    - (대표 논문 없음)')
        for s in r.get('shortened') or []:
            L.append(f'- 이름 줄임: {s}')
        if r.get('haeyo_fixed'):
            L.append('- 연구 질문 끝말을 해요체로 바꿨어요')
        if r.get('haeyo_odd'):
            L.append('- **확인 필요**: 연구 질문이 해요체로 끝나지 않아요')
        if r.get('notes'):
            L.append(f"- 확인할 점: {r['notes']}")
        if not r['ok']:
            L.append(f"- **못 넣음**: {r['why']}")
    (WORK / 'report.md').write_text('\n'.join(L) + '\n', encoding='utf-8')
    print(f"보고서 → {WORK / 'report.md'}")


if __name__ == '__main__':
    main(write='--write' in sys.argv)
