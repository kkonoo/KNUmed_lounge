"""후보 논문으로 프로필 초안을 만들어요 (DESIGN §9 3단계, Anthropic Message Batches API).

    python3 pipeline/draft_batch.py probe <프로필 번호>  # 한 분만 바로 보내서 프롬프트·형식 확인
    python3 pipeline/draft_batch.py submit               # 교수님 한 분 = 요청 하나로 배치 보내기
    python3 pipeline/draft_batch.py status               # 어디까지 됐나
    python3 pipeline/draft_batch.py fetch                # 결과를 work/results.json 으로
    python3 pipeline/draft_batch.py retry                # 못 받은 분만 한 분씩 (fallback 모델까지)

- 모델은 claude-opus-5-5, 답은 구조화 출력(json_schema)으로 받아요.
- 안전 분류기가 거절하는 분(미생물·기생충 논문이 많으면 그래요)은 `retry`가 한 분씩 다시 보내요.
  배치는 fallbacks를 못 써서요. 어느 분이 어떤 모델로 만들어졌는지는 work/models.json 에 남아요.
- 시스템 프롬프트는 모두 같은 글로 고정하고 cache_control을 걸어요. 사용자 글에는
  그분의 이름·교실·이름북 한 줄·공식 학력·경력과 후보 논문 목록만 넣어요.
- API 키는 환경 변수 ANTHROPIC_API_KEY로만 읽어요. 어디에도 적거나 저장하지 않아요.
- 쓴 비용(usage 합계)을 끝에 적어요. 배치는 보통 값의 절반이에요.
- 작업 파일은 pipeline/work/ 에만 두고 저장소에 올리지 않아요(.gitignore).

    pip install anthropic   (처음 한 번)
"""
import json
import os
import sys
import time
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
WORK = Path(__file__).resolve().parent / 'work'
PEOPLE = ROOT / 'data' / 'people.json'
MODEL = 'claude-opus-5-5'
# claude-opus-5-5 1M 토큰당 값 (배치는 절반). 들어가는 글 $4, 나오는 글 $20,
# 캐시에 넣기 $5(들어가는 글의 1.25배), 캐시에서 읽기 $0.20.
PRICE = {'in': 4.0, 'out': 20.0, 'cache_write': 5.0, 'cache_read': 0.20}
BATCH_DISCOUNT = 0.5

SYSTEM = """당신은 경북대학교 의과대학 기초의학 교수님들의 공개 프로필에 들어갈 '논문 초안'을 씁니다.
교수님 한 분의 공식 학력·경력과 후보 논문 목록을 받아 두 가지 일을 합니다.

# ① 본인 논문만 고르기

후보 목록은 이름 표기로 찾은 것이라 동명이인이 섞여 있습니다.
- 그 저자의 소속이 학력·경력과 맞는 논문만 남깁니다. 연도와 소속이 함께 맞아야 합니다.
- 조금이라도 애매하면 뺍니다. 넣어서 틀리는 것보다 빼는 것이 낫습니다.
- 경력이 비어 있으면, 경북대학교 그 교실(또는 경북대 의과대학) 소속으로 적힌 논문만 남깁니다.
- 남긴 논문은 kept_pmids에, 뺀 논문은 excluded에 pmid와 한 줄 이유(why)를 적습니다.
  pmid에는 목록에 'PMID 35172897'처럼 적힌 그 숫자를 그대로 씁니다. 목록의 순번이 아닙니다.
  후보가 많으면 excluded의 이유는 같은 말을 되풀이해도 됩니다(예: "다른 소속의 동명이인").

# ② 남긴 논문으로만 초안 쓰기

kept_pmids의 논문에 없는 내용은 절대 쓰지 않습니다. 학력·경력은 발자취의 기간을 나누는 데만 씁니다.

## question (연구 질문)
해요체 2~3문장, 150~250자를 권합니다(최대 600자). 그 연구실이 묻는 질문을, 다른 분야 교수님이
읽어도 알 수 있는 말로 씁니다. 업적 자랑이 아니라 질문이어야 합니다.

## axes (연구 축) — 2~3개
- name: 40자까지의 명사구.
- text: 200자까지, 60~110자를 권합니다. 명사형으로 끝냅니다(…규명, …연결, …설계).
  영어 전문용어는 그대로 써도 됩니다.
- papers: 축마다 0~2편.
  - label: "학술지 연도 · 짧은 한국어 설명" 꼴로 40자까지 (예: "Bone 2019 · IDH2 결손과 파골세포").
    40자는 빡빡해요. 학술지 이름이 길면 줄임말로 줄입니다
    (Signal Transduct Target Ther 2026 → STTT 2026, NPJ Biofilms Microbiomes → NPJ Biofilms).
    다 쓰고 글자를 세어 보고, 40자가 넘으면 설명을 더 줄입니다.
  - url: "https://doi.org/<doi>" 꼴. 목록에 적힌 그 논문의 DOI를 그대로 씁니다.
    DOI가 없다고 적힌 논문은 대표 논문으로 고르지 않습니다.
  - 본인이 제1저자나 교신저자(보통 마지막 저자)인 논문을 먼저 고릅니다.
  - 남긴 논문 안에서만 고릅니다. 같은 논문을 여러 축에 쓰지 않습니다.

## timeline (연구 발자취) — 4줄까지, 연도 순
- years: "2005–2010" 이나 "2019–" 꼴로 20자까지 (붙임표는 – 를 씁니다).
- text: 120자까지, 명사형으로 끝냅니다. 기관 이름은 넣지 않습니다.
- 논문으로 시기를 믿을 만하게 나눌 수 없으면 줄 수를 줄입니다. 억지로 4줄을 채우지 않습니다.

## resources (보유 자원)
- techniques: 본인 논문에서 분명히 쓴 방법만. 300자까지.
- models: 논문에 나온 마우스 계통·세포 모델만. 300자까지.
- 근거가 없으면 빈 문자열("")로 둡니다. 장비·시료·데이터는 짐작하지 않습니다.

## notes
교수님이 확인해야 할 점을 한국어로 짧게 적습니다(짐작해서 나눈 기간, 교수소개의 직위와
논문 소속이 다른 점, 후보가 적어 좁게 쓴 축 등). 초안 칸에는 들어가지 않는 메모입니다.

# 지킬 것

- 출판된 논문과 학교 교수소개만 씁니다. 연구실 내부 브리핑이나 미발표 내용은 쓰지 않습니다.
- 연구 평가(강점·약점·다음 질문), 다른 연구실과의 비교, 연구비 정보는 넣지 않습니다.
- 피인용 수·h-index·논문 편수 같은 숫자 자랑은 넣지 않습니다.
- 모든 교수님이 같은 칸, 같은 깊이입니다. 논문이 많은 분이라고 길게 쓰지 않습니다.
- line·keywords·topics·links는 만들지 않습니다(이름북 것을 그대로 둡니다).
- 남긴 논문이 너무 적어 초안을 쓸 수 없으면 question을 빈 문자열로 두고 axes를 빈 배열로 두고,
  notes에 그 이유를 적습니다. 없는 내용을 지어내지 않습니다."""

SCHEMA = {
    'type': 'object',
    'properties': {
        'kept_pmids': {'type': 'array', 'items': {'type': 'string'},
                       'description': "본인 논문으로 남긴 PMID 숫자 그대로 (예: '35172897'). 목록 순번이 아님"},
        'excluded': {
            'type': 'array',
            'items': {'type': 'object',
                      'properties': {'pmid': {'type': 'string', 'description': 'PMID 숫자 그대로'},
                                     'why': {'type': 'string'}},
                      'required': ['pmid', 'why'], 'additionalProperties': False},
        },
        'question': {'type': 'string', 'description': '해요체 2~3문장, 150~250자 권장'},
        'axes': {
            # maxItems 는 구조화 출력이 안 받아요. 칸 수 한도는 시스템 프롬프트로 알리고
            # pipeline/check_drafts.js 가 재요.
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'name': {'type': 'string'},
                    'text': {'type': 'string'},
                    'papers': {
                        'type': 'array',
                        'items': {'type': 'object',
                                  'properties': {'label': {'type': 'string'}, 'url': {'type': 'string'}},
                                  'required': ['label', 'url'], 'additionalProperties': False},
                    },
                },
                'required': ['name', 'text', 'papers'], 'additionalProperties': False,
            },
        },
        'timeline': {
            'type': 'array',
            'items': {'type': 'object',
                      'properties': {'years': {'type': 'string'}, 'text': {'type': 'string'}},
                      'required': ['years', 'text'], 'additionalProperties': False},
        },
        'resources': {
            'type': 'object',
            'properties': {'techniques': {'type': 'string'}, 'models': {'type': 'string'}},
            'required': ['techniques', 'models'], 'additionalProperties': False,
        },
        'notes': {'type': 'string'},
    },
    'required': ['kept_pmids', 'excluded', 'question', 'axes', 'timeline', 'resources', 'notes'],
    'additionalProperties': False,
}


def client():
    if not os.environ.get('ANTHROPIC_API_KEY'):
        sys.exit('환경 변수 ANTHROPIC_API_KEY가 없어요.')
    return anthropic.Anthropic()


def candidates():
    return json.loads((WORK / 'candidates.json').read_text(encoding='utf-8'))


def book():
    return {p['id']: p for p in json.loads(PEOPLE.read_text(encoding='utf-8'))['people']}


def user_text(person, rec):
    """그분의 이름·교실·이름북 한 줄·공식 학력·경력과 후보 논문 목록만."""
    L = [f"# 교수님", f"- 이름: {person['name']} ({rec.get('name_en', '')})",
         f"- 교실: {person['dept']}", f"- 직위: {person.get('rank', '')}"]
    if rec.get('rank_site') and rec['rank_site'] != person.get('rank'):
        L.append(f"- 학교 교수소개의 직위: {rec['rank_site']}")
    if person.get('line'):
        L.append(f"- 이름북 한 줄 소개: {person['line']}")
    if rec.get('homonym'):
        L.append('- 주의: 같은 교실에 이름이 똑같은 교수님이 또 계세요. 논문만으로는 두 분을 나눌 수 '
                 '없으니, 어느 분 논문인지 분명하지 않으면 모두 빼고 notes에 그 사정을 적어 주세요.')
    src = rec.get('extra_source') or '학교 교수소개'
    L.append('')
    L.append(f'# 학력 (출처: {src})')
    L += [f'- {x}' for x in rec.get('edu') or ['(없음)']]
    L.append('')
    L.append(f'# 경력 (출처: {src})')
    L += [f'- {x}' for x in rec.get('career') or ['(없음)']]
    if rec.get('info'):
        L.append('')
        L.append(f'# 기본정보 (출처: {src})')
        L += [f'- {x}' for x in rec['info']]

    L.append('')
    L.append(f"# 후보 논문 {len(rec['papers'])}편")
    L.append("이름 표기로 찾은 것이라 동명이인이 섞여 있어요. '맞는 저자'는 그분 이름과 표기가 맞는 "
             "저자의 자리와 소속이에요.")
    for p in sorted(rec['papers'], key=lambda x: x['year'] or '0', reverse=True):
        L.append('')
        L.append(f"PMID {p['pmid']}")
        L.append(f"    DOI: {p['doi'] or '(없음 — 대표 논문으로 고를 수 없음)'}")
        L.append(f"    학술지·연도: {p['journal']} {p['year']}")
        for m in p['me']:
            where = '마지막 저자(교신저자일 수 있음)' if m['last_author'] else f"{m['pos']}번째 저자"
            L.append(f"    맞는 저자: {m['name']} · 저자 {m['of']}명 중 {where}")
            L.append(f"    그 저자의 소속: {m['aff'] or '(논문에 소속이 없음)'}")
        if p['type']:
            kinds = [t for t in p['type'] if t not in ('Journal Article', 'Research Support, Non-U.S. Gov\'t')]
            if kinds:
                L.append(f"    종류: {', '.join(kinds[:3])}")
        L.append(f"    제목: {p['title']}")
        L.append(f"    초록: {p['abstract'] or '(없음)'}")
    return '\n'.join(L)


def params(person, rec):
    return {
        'model': MODEL,
        'max_tokens': 16000,
        'output_config': {'effort': 'high', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
        'system': [{'type': 'text', 'text': SYSTEM, 'cache_control': {'type': 'ephemeral'}}],
        'messages': [{'role': 'user', 'content': user_text(person, rec)}],
    }


def jobs():
    cand, bk = candidates(), book()
    out = []
    for pid, rec in cand.items():
        if rec.get('error') or not rec.get('papers'):
            continue
        if pid in bk:
            out.append((pid, bk[pid], rec))
    return out


def money(u, batch=True):
    f = BATCH_DISCOUNT if batch else 1.0
    return f * (u['in'] * PRICE['in'] + u['out'] * PRICE['out']
                + u['cache_write'] * PRICE['cache_write']
                + u['cache_read'] * PRICE['cache_read']) / 1e6


def add_usage(total, usage):
    total['in'] += usage.input_tokens or 0
    total['out'] += usage.output_tokens or 0
    total['cache_write'] += getattr(usage, 'cache_creation_input_tokens', 0) or 0
    total['cache_read'] += getattr(usage, 'cache_read_input_tokens', 0) or 0
    total['n'] += 1


def blank_usage():
    return {'in': 0, 'out': 0, 'cache_write': 0, 'cache_read': 0, 'n': 0}


def report_usage(u, batch=True):
    print(f"\n요청 {u['n']}개 · 들어간 글 {u['in']:,} + 캐시에 넣기 {u['cache_write']:,}"
          f" + 캐시에서 읽기 {u['cache_read']:,} 토큰 · 나온 글 {u['out']:,} 토큰")
    print(f"비용 약 ${money(u, batch):.3f}" + (' (배치 반값)' if batch else ' (배치 아님)'))


# ---------- probe: 한 분만 바로 ----------

def cmd_probe(pid):
    items = {p: (p, b, r) for p, b, r in jobs()}
    if pid not in items:
        sys.exit(f'{pid}: 후보가 없어요. 있는 번호: {", ".join(sorted(items))}')
    _, person, rec = items[pid]
    text = user_text(person, rec)
    print(f"{person['name']} ({person['dept']}) · 사용자 글 {len(text):,}자 · 후보 {len(rec['papers'])}편")
    c = client()
    r = c.messages.create(**params(person, rec))
    print(f'stop_reason: {r.stop_reason}')
    if r.stop_reason == 'refusal':
        print('거절:', r.stop_details)
        return
    out = json.loads(next(b.text for b in r.content if b.type == 'text'))
    (WORK / f'probe-{pid}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False, indent=1)[:4000])
    u = blank_usage()
    add_usage(u, r.usage)
    report_usage(u, batch=False)


# ---------- submit / status / fetch ----------

def cmd_submit(only=()):
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request
    items = [x for x in jobs() if not only or x[0] in only]
    print(f'요청 {len(items)}개')
    reqs = [Request(custom_id=pid, params=MessageCreateParamsNonStreaming(**params(person, rec)))
            for pid, person, rec in items]
    b = client().messages.batches.create(requests=reqs)
    WORK.mkdir(exist_ok=True)
    (WORK / 'batch.json').write_text(json.dumps({'id': b.id, 'n': len(reqs)}, indent=1), encoding='utf-8')
    print(f'배치 {b.id} · {b.processing_status}')


def batch_id():
    return json.loads((WORK / 'batch.json').read_text(encoding='utf-8'))['id']


def cmd_status():
    b = client().messages.batches.retrieve(batch_id())
    print(b.id, b.processing_status, b.request_counts)


def cmd_fetch():
    c = client()
    bid = batch_id()
    while True:
        b = c.messages.batches.retrieve(bid)
        if b.processing_status == 'ended':
            break
        print(f'  {b.processing_status} · {b.request_counts}')
        time.sleep(30)
    out, u, trouble = {}, blank_usage(), []
    for res in c.messages.batches.results(bid):
        pid, kind = res.custom_id, res.result.type
        if kind != 'succeeded':
            err = getattr(res.result, 'error', None)
            trouble.append((pid, kind, str(getattr(err, 'type', '') or err or '')))
            continue
        msg = res.result.message
        add_usage(u, msg.usage)
        if msg.stop_reason == 'refusal':
            trouble.append((pid, 'refusal', str(msg.stop_details)))
            continue
        if msg.stop_reason == 'max_tokens':
            trouble.append((pid, 'max_tokens', '답이 잘렸어요'))
            continue
        text = next((x.text for x in msg.content if x.type == 'text'), '')
        try:
            out[pid] = json.loads(text)
        except json.JSONDecodeError as e:
            trouble.append((pid, 'json', str(e)))
    save({**load('results.json'), **out}, {pid: MODEL for pid in out}, trouble)
    bank_usage('batch', u)
    print(f"\n받은 초안 {len(out)}개 → {WORK / 'results.json'}")
    for pid, kind, msg in trouble:
        print(f'  못 받음 {pid}: {kind} {msg[:120]}')
    report_usage(u)


# ---------- retry: 거절·오류가 난 분을 한 분씩, fallback 모델까지 ----------

def cmd_retry():
    """배치에서 못 받은 분만 다시. 배치는 fallbacks를 못 써서 한 분씩 보내요.

    fallbacks='default'는 먼저 claude-opus-5-5로 해 보고, 안전 분류기가 거절할 때만
    다른 모델로 넘겨요. 넘어간 분은 models.json에 그 모델 이름이 남아요.
    """
    c = client()
    have = load('results.json')
    todo = [(pid, person, rec) for pid, person, rec in jobs() if pid not in have]
    print(f'다시 보낼 분 {len(todo)}명')
    out, models, trouble, u = {}, {}, [], blank_usage()
    for pid, person, rec in todo:
        try:
            r = c.beta.messages.create(**params(person, rec),
                                       betas=['server-side-fallback-2026-07-01'], fallbacks='default')
        except Exception as e:                                   # noqa: BLE001
            trouble.append((pid, 'error', str(e)))
            print(f"  {person['name']}: 오류 {str(e)[:100]}")
            continue
        add_usage(u, r.usage)
        if r.stop_reason == 'refusal':
            trouble.append((pid, 'refusal', str(r.stop_details)))
            print(f"  {person['name']}: fallback 까지 거절")
            continue
        try:
            out[pid] = json.loads(next(x.text for x in r.content if x.type == 'text'))
        except (StopIteration, json.JSONDecodeError) as e:
            trouble.append((pid, 'json', str(e)))
            continue
        models[pid] = r.model
        print(f"  {person['name']}: 받았어요 ({r.model})")
    save({**have, **out}, models, trouble)
    bank_usage('retry', u)
    report_usage(u, batch=False)


# ---------- 작업 파일 ----------

def load(name, default=None):
    p = WORK / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else (default if default is not None else {})


def save(results, models, trouble):
    WORK.mkdir(exist_ok=True)
    (WORK / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    (WORK / 'models.json').write_text(json.dumps({**load('models.json'), **models},
                                                 ensure_ascii=False, indent=1), encoding='utf-8')
    old = [t for t in load('trouble.json', []) if t[0] not in results]
    keep = old + [list(t) for t in trouble if t[0] not in results]
    seen, uniq = set(), []
    for t in keep:
        if t[0] not in seen:
            seen.add(t[0])
            uniq.append(t)
    (WORK / 'trouble.json').write_text(json.dumps(uniq, ensure_ascii=False, indent=1), encoding='utf-8')


def bank_usage(kind, u):
    """돌린 것마다 usage를 더해 둬요. 끝에 실제로 든 비용을 적으려고요."""
    all_u = load('usage.json', {})
    cur = all_u.get(kind) or blank_usage()
    for k in u:
        cur[k] += u[k]
    all_u[kind] = cur
    all_u['cost_usd'] = round(sum(money(v, batch=(k == 'batch'))
                                  for k, v in all_u.items() if isinstance(v, dict)), 4)
    (WORK / 'usage.json').write_text(json.dumps(all_u, indent=1), encoding='utf-8')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'probe' and len(sys.argv) == 3:
        cmd_probe(sys.argv[2])
    elif cmd == 'submit':
        cmd_submit(set(sys.argv[2:]))
    elif cmd == 'status':
        cmd_status()
    elif cmd == 'fetch':
        cmd_fetch()
    elif cmd == 'retry':
        cmd_retry()
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
