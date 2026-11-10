"""교수님별로 학교 교수소개와 후보 논문을 모아요 (DESIGN §9 1·2단계).

    python3 pipeline/collect.py

- 대상: data/people.json의 people 중 drafts에 없고, 공개 프로필에 confirmedAt이 없는 분.
- 의과대학 홈페이지 교수소개에서 영문 이름·학력·경력만 읽어요.
  메일·전화·연구실 호수는 읽어도 버려요 (공개 저장소에 남기지 않아요).
- NCBI E-utilities(esearch → efetch)로 후보 논문을 모아요. 한국 이름은 이니셜만으로 찾으면
  다른 사람 논문이 섞여서(DESIGN §9), 이름 표기를 여러 가지로 만들고 Kyungpook과
  학력·경력에 나온 기관을 소속 조건으로 같이 넣어요.
- 논문마다 PMID·DOI·학술지·연도·제목·초록(앞 1500자)과, 그 교수님 이름과 맞는 저자의
  순서·소속을 남겨요. 본인 논문을 고르는 건 다음 단계(배치)가 해요.
- 교수소개에 학력·경력이 비어 있는 분은 pipeline/extra.json 으로 보탤 수 있어요.
  교수님 본인의 공개 자료(연구실 페이지 등)만 쓰고, 어디서 가져왔는지 source에 적어요.
- 결과는 pipeline/work/candidates.json. 작업 파일이라 저장소에 올리지 않아요(.gitignore).
"""
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PEOPLE = ROOT / 'data' / 'people.json'
WORK = Path(__file__).resolve().parent / 'work'
EXTRA = Path(__file__).resolve().parent / 'extra.json'
SITE = 'https://med.knu.ac.kr'
LIST = f'{SITE}/pages/sub.htm?nav_code=knu1670413496&view_cate=&view_cate2='
EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
# NCBI 예절: 키 없이 초당 3번까지. 도구 이름만 보내고 메일은 보내지 않아요.
TOOL = 'knumed-lounge-pipeline'
PAUSE = 0.4

# 교수소개의 기초 교실 (view_cate2 번호)
DEPT_CATE = {
    '해부학교실': 10,
    '생리학교실': 15,
    '생화학·세포생물학교실': 20,
    '병리학교실': 25,
    '약리학교실': 30,
    '미생물학교실': 35,
    '기생충학·열대의학교실': 45,
    '면역학교실': 55,
    '분자의학교실': 75,
}

# 한글 성 → 영문 표기. 교수소개가 성을 앞에 쓴 분과 뒤에 쓴 분이 섞여 있어서 성을 가리는 데 써요.
SURNAMES = {
    '김': {'kim', 'gim'}, '이': {'lee', 'yi', 'rhee', 'ri', 'i', 'ee', 'lie'},
    '박': {'park', 'pak', 'bak', 'back'}, '최': {'choi', 'choe', 'chey', 'che'},
    '정': {'jung', 'jeong', 'chung', 'jong', 'cheong'}, '강': {'kang', 'gang'},
    '조': {'cho', 'jo', 'joe'}, '윤': {'yoon', 'yun', 'youn'}, '장': {'jang', 'chang', 'jhang'},
    '임': {'lim', 'im', 'rim', 'leem'}, '한': {'han', 'hahn'}, '오': {'oh', 'o', 'ou'},
    '서': {'seo', 'suh', 'sur', 'so'}, '신': {'shin', 'sin', 'shine'},
    '권': {'kwon', 'gwon', 'kweon', 'kwun'}, '황': {'hwang', 'whang'}, '안': {'ahn', 'an', 'ann'},
    '송': {'song', 'sung'}, '류': {'ryu', 'yu', 'lyu', 'rhyu'}, '유': {'yu', 'yoo', 'you', 'ryu'},
    '전': {'jeon', 'jun', 'chun', 'jhun'}, '홍': {'hong'}, '고': {'ko', 'go', 'koh', 'goh'},
    '문': {'moon', 'mun'}, '양': {'yang'}, '손': {'son', 'sohn'}, '배': {'bae', 'pae', 'bai'},
    '백': {'baek', 'back', 'paek', 'baik', 'paik'}, '허': {'heo', 'hur', 'huh', 'her', 'ho'},
    '남': {'nam', 'nahm'}, '심': {'sim', 'shim'}, '노': {'no', 'noh', 'roh', 'ro'},
    '하': {'ha', 'hah'}, '곽': {'kwak', 'gwak', 'kwag'}, '성': {'sung', 'seong', 'song'},
    '차': {'cha'}, '주': {'joo', 'ju', 'chu'}, '우': {'woo', 'wu', 'u'},
    '구': {'koo', 'ku', 'gu', 'goo'}, '민': {'min'}, '석': {'suk', 'seok', 'sok', 'sug', 'sek'},
    '지': {'ji', 'jee', 'chi'}, '엄': {'eom', 'um', 'uhm'}, '원': {'won', 'weon'},
    '천': {'cheon', 'chun', 'chon'}, '방': {'bang', 'pang'}, '공': {'kong', 'gong'},
    '현': {'hyun', 'hyeon'}, '함': {'ham', 'hahm'}, '변': {'byun', 'byeon', 'pyun'},
    '염': {'yeom', 'yum'}, '여': {'yeo', 'yu'}, '추': {'chu', 'choo'},
}

# 학력·경력에 나오는 기관을 PubMed 소속 검색말로. 논문 소속은 영문이라 옮겨 적어야 해요.
INSTITUTIONS = {
    '경북대': 'Kyungpook', '서울대': 'Seoul National', '연세대': 'Yonsei', '고려대': 'Korea University',
    '성균관': 'Sungkyunkwan', '한양대': 'Hanyang', '가톨릭': 'Catholic', '울산대': 'Ulsan',
    '아주대': 'Ajou', '전남대': 'Chonnam', '전북대': 'Jeonbuk', '충남대': 'Chungnam',
    '충북대': 'Chungbuk', '부산대': 'Pusan', '경희대': 'Kyung Hee', '중앙대': 'Chung-Ang',
    '이화여': 'Ewha', '한림대': 'Hallym', '인제대': 'Inje', '동국대': 'Dongguk',
    '계명대': 'Keimyung', '영남대': 'Yeungnam', '대구가톨릭': 'Daegu Catholic', '건국대': 'Konkuk',
    '포항공': 'POSTECH', '포스텍': 'POSTECH', '카이스트': 'KAIST', 'KAIST': 'KAIST',
    '광주과학기술원': 'GIST', 'GIST': 'GIST', '대구경북과학기술원': 'DGIST', 'DGIST': 'DGIST',
    '생명공학연구원': 'KRIBB', 'KRIBB': 'KRIBB', '화학연구원': 'Korea Research Institute of Chemical',
    '한국뇌연구원': 'Korea Brain Research', 'KBRI': 'Korea Brain Research',
    '국립암센터': 'National Cancer Center', '보건연구원': 'Korea National Institute of Health',
    '한국원자력': 'Korea Atomic Energy', '원자력의학원': 'Korea Institute of Radiological',
    '아산생명과학': 'Asan Institute for Life Sciences', '표준과학연구원': 'Korea Research Institute of Standards',
    '삼성서울': 'Samsung Medical Center', '삼성의료원': 'Samsung Medical Center',
    '아산병원': 'Asan Medical Center', '세브란스': 'Severance',
    '하버드': 'Harvard', '존스홉킨스': 'Johns Hopkins', '스탠퍼드': 'Stanford', '스탠포드': 'Stanford',
    '예일': 'Yale', '컬럼비아': 'Columbia', '코넬': 'Cornell', '듀크': 'Duke',
    '시카고': 'Chicago', '미시간': 'Michigan', '미네소타': 'Minnesota', '위스콘신': 'Wisconsin',
    '펜실베': 'Pennsylvania', '피츠버그': 'Pittsburgh', '텍사스': 'Texas', '플로리다': 'Florida',
    '노스캐롤라이나': 'North Carolina', '밴더빌트': 'Vanderbilt', '베일러': 'Baylor',
    '클리블랜드': 'Cleveland Clinic', '메이요': 'Mayo', '메이오': 'Mayo',
    'UCLA': 'Los Angeles', 'UCSF': 'San Francisco', 'UCSD': 'San Diego', '버클리': 'Berkeley',
    '국립보건원': 'National Institutes of Health', 'NIH': 'National Institutes of Health',
    '막스플랑크': 'Max Planck', '하이델베르크': 'Heidelberg', '뮌헨': 'Munich', '쾰른': 'Cologne',
    '옥스퍼드': 'Oxford', '케임브리지': 'Cambridge', '캠브리지': 'Cambridge', '런던': 'London',
    '파스퇴르': 'Pasteur', '토론토': 'Toronto', '맥길': 'McGill', '브리티시컬럼비아': 'British Columbia',
    '도쿄': 'Tokyo', '동경': 'Tokyo', '교토': 'Kyoto', '오사카': 'Osaka', '홋카이도': 'Hokkaido',
    '싱가포르': 'Singapore', '멜버른': 'Melbourne', '시드니': 'Sydney',
}


def get(url, tries=3):
    req = urllib.request.Request(url, headers={'User-Agent': f'Mozilla/5.0 ({TOOL})'})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            if i == tries - 1:
                raise
            print(f'    다시 시도 ({e})', file=sys.stderr)
            time.sleep(2 * (i + 1))


# ---------- 1단계: 공개 프로필과 대상 고르기 ----------

def public_profiles():
    """Firestore REST로 공개 프로필을 읽어요 (규칙이 누구나 읽게 함)."""
    cfg = (ROOT / 'js' / 'firebase-config.js').read_text(encoding='utf-8')
    key = re.search(r"apiKey: '([^']+)'", cfg).group(1)
    project = re.search(r"projectId: '([^']+)'", cfg).group(1)
    base = (f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)'
            f'/documents/profiles?pageSize=300&key={key}')
    out, token = {}, ''
    while True:
        page = json.loads(get(base + (f'&pageToken={token}' if token else '')))
        for d in page.get('documents', []):
            f = d.get('fields', {})
            out[d['name'].rsplit('/', 1)[1]] = {'confirmed': 'confirmedAt' in f,
                                                'hidden': f.get('hidden', {}).get('booleanValue', False)}
        token = page.get('nextPageToken')
        if not token:
            return out


def extra_for(pid):
    """pipeline/extra.json 에 손으로 적어 둔 학력·경력 (교수소개가 비어 있는 분).

    20분 넘게 교수소개의 학력·경력이 비어 있어요. 경력을 모르면 소속으로 본인 논문을
    가릴 수 없어서, 본인 공개 자료에서 옮겨 적을 자리를 뒀어요.
    """
    if not EXTRA.exists():
        return {}
    return json.loads(EXTRA.read_text(encoding='utf-8')).get(pid, {})


def targets():
    """초안을 만들 분: 이름북에 있고, 초안이 없고, 본인이 확인하지 않은 분."""
    data = json.loads(PEOPLE.read_text(encoding='utf-8'))
    docs = public_profiles()
    out = []
    for p in data['people']:
        if p['id'] in data.get('drafts', {}):
            continue
        d = docs.get(p['id'], {})
        if d.get('confirmed') or d.get('hidden'):
            continue
        out.append(p)
    return out


# ---------- 학교 교수소개 ----------

def strip_tags(html):
    html = re.sub(r'<(script|style)\b.*?</\1>', '', html, flags=re.S)
    return re.sub(r'[ \t]+', ' ', unescape(re.sub(r'<[^>]+>', '\n', html))).strip()


def school_list(cate):
    """한 교실의 교수소개 목록에서 (이름, 직위, 자세히 주소)를. 쪽을 오가도 한 분은 한 번만."""
    todo, done, out = [LIST + str(cate)], set(), {}
    while todo:
        url = todo.pop()
        if url in done:
            continue
        done.add(url)
        html = get(url).decode('utf-8', 'replace')
        for li in re.findall(r'<li><div class="thumb">.*?</li>', html, re.S):
            name = re.search(r'class="name[^"]*"><span>([^<]+)</span>([^<]*)</a>', li)
            href = re.search(r'href="(/pages/sub\.htm\?[^"]*mode=view[^"]*)"', li)
            if name and href:
                detail = SITE + unescape(href.group(1))
                # 같은 분의 주소에는 쪽 번호가 섞여 있어서, 글 번호(idx)로 같은 분인지 봐요
                mv = re.search(r'mv_data=([A-Za-z0-9=]+)', detail)
                try:
                    idx = re.search(r'idx=(\d+)', base64.b64decode(mv.group(1) + '==').decode('utf-8', 'replace')).group(1)
                except Exception:
                    idx = detail
                out.setdefault(idx, (name.group(1).strip(), name.group(2).strip(), detail))
        paging = html.split('class="board-paging"', 1)[1].split('</div>', 1)[0] if 'class="board-paging"' in html else ''
        for h in re.findall(r"href='(/pages/sub\.htm\?mv_data=[^']+)'", paging):
            todo.append(SITE + h)
    return list(out.values())


def school_detail(url):
    """자세히 쪽에서 영문 이름·학력·경력만. 메일·전화·연구실은 버려요."""
    html = get(url).decode('utf-8', 'replace')
    art = html.split('<article id="prof-desc"', 1)[-1]
    en = re.search(r'<p class="name"><b>[^<]*</b><span>([^<]*)</span>', art)
    out = {'name_en': (en.group(1).strip() if en else ''), 'edu': [], 'career': [], 'info': []}
    for head, body in re.findall(r'<h3>([^<]+)</h3>\s*(<ul>.*?</ul>|<div class="bx1_wh">.*?</div>)', art, re.S):
        items = [strip_tags(x).strip() for x in re.findall(r'<li>(.*?)</li>', body, re.S)]
        items = [re.sub(r'\s*\n\s*', ' ', i) for i in items if i]
        if not items:
            text = re.sub(r'\s*\n\s*', ' ', strip_tags(body)).strip()
            items = [text] if text else []
        key = {'학력': 'edu', '경력': 'career', '기본정보': 'info'}.get(head.strip())
        if key:
            out[key] = items
    # 메일·전화·호수가 섞인 줄은 버려요
    drop = re.compile(r'[\w.+-]+@|\d{2,4}-\d{3,4}-\d{4}|\b\d{2,4}\s*호\b')
    for k in ('edu', 'career', 'info'):
        out[k] = [i for i in out[k] if not drop.search(i)]
    return out


# ---------- 이름 표기와 소속 검색말 ----------

def name_variants(name_en, name_ko=''):
    """'Nam Yong Seok'·'Kyoungho Suk' → PubMed 저자 검색말 여러 가지.

    교수소개는 성을 앞에 쓴 분('Nam Yong Seok')과 뒤에 쓴 분('Kyoungho Suk')이 섞여 있어요.
    그래서 한글 성(첫 글자)의 로마자 표기와 맞춰 보고 성을 가려요. 표에 없으면 앞을 성으로 봐요.
    """
    parts = [p for p in re.split(r'[\s,]+', (name_en or '').strip()) if p]
    if len(parts) < 2:
        return [], [], []
    roman = SURNAMES.get((name_ko or '')[:1], set())
    if roman and re.sub(r'[^a-z]', '', parts[-1].lower()) in roman \
            and re.sub(r'[^a-z]', '', parts[0].lower()) not in roman:
        sur, given = parts[-1], parts[:-1]  # 'Kyoungho Suk'
    else:
        sur, given = parts[0], parts[1:]    # 'Nam Yong Seok'
    syl = [s for g in given for s in g.split('-') if s]  # 'Sang-Hyun' → ['Sang', 'Hyun']
    init = ''.join(s[0] for s in syl).upper()
    givens = [' '.join(given), ' '.join(syl), '-'.join(syl), ''.join(syl).capitalize()]
    # 성도 표기가 갈려요(장 → Jang·Chang). 성 표기가 다르면 그분 논문을 아예 못 찾아요.
    # 다만 이니셜 검색말은 넓어서(Chang Y는 온 세상 Chang) 교수소개의 표기 하나로만 둬요.
    surs = [sur] + [r.capitalize() for r in sorted(roman) if r != sur.lower() and len(r) > 2]
    forms = [f'{s} {g}' for s in surs for g in givens]
    seen, uniq = set(), []
    for v in forms:
        if v.lower() not in seen:
            seen.add(v.lower())
            uniq.append(v)
    return [f'{sur} {init}'], uniq, surs


def canon(s):
    """로마자 표기 차이를 지운 꼴. 'Yeoncheol'과 'Yeonchul'을 같게 봐요.

    교수소개 표기와 논문 표기가 자주 달라요(연철 Yeoncheol/Yeonchul, 하정 Hajeong/Hajung).
    다만 동선(Dongseon)과 동석(Dongseok)처럼 다른 이름은 그대로 달라야 해요.
    """
    s = re.sub(r'[^a-z]', '', (s or '').lower())
    for a, b in (('sh', 's'), ('eo', 'u'), ('eu', 'u'), ('oo', 'u'), ('ou', 'u'),
                 ('ae', 'a'), ('ee', 'i')):
        s = s.replace(a, b)
    s = s.translate(str.maketrans('kpt', 'gbd'))
    return re.sub(r'(.)\1+', r'\1', s)


# 기관 이름이 아니라 분야·직위인 낱말. 소속 검색말로 쓰면 온 세상 같은 분야 논문이 다 걸려요.
GENERIC = {'university', 'univ', 'institute', 'college', 'school', 'medicine', 'medical',
           'hospital', 'research', 'center', 'centre', 'department', 'graduate', 'national',
           'immunology', 'immunobiology', 'biochemistry', 'physiology', 'pharmacology',
           'anatomy', 'pathology', 'microbiology', 'neuroscience', 'biology', 'science',
           'toxicology', 'radiology', 'veterinary',
           'sciences', 'engineering', 'health', 'public', 'clinical', 'postdoctoral',
           'professor', 'visiting', 'korea', 'korean', 'america', 'american', 'the', 'and', 'of',
           'ph.d', 'phd', 'ph.d.', 'm.d', 'md', 'm.s', 'ms', 'b.s', 'bs', 'dvm', 'fellow'}


def affiliations(detail):
    """Kyungpook과 학력·경력에 나온 기관을 소속 검색말로.

    기관 이름만 골라요. 'Immunology'처럼 분야 이름을 넣으면 소속 조건이 거르는 일을 못 해요.
    """
    text = ' '.join(detail['edu'] + detail['career'] + detail['info'])
    found = ['Kyungpook']

    def add(term):
        term = term.strip(' .,')
        words = [w for w in term.split() if w.lower() not in GENERIC]
        term = ' '.join(words)
        if len(term) > 2 and term not in found:
            found.append(term)

    for ko, en in INSTITUTIONS.items():
        if ko in text:
            add(en)
    # 한글 사이에 영문으로 적힌 기관 (예: 'Yale University', 'University of California')
    kinds = r'University|Univ\.?|Institute|College|Hospital|Center|Centre|Laboratory|Clinic'
    for m in re.findall(rf'((?:[A-Z][A-Za-z.]*\s+){{1,3}})(?:{kinds})\b', text):
        add(m)
    for m in re.findall(rf'(?:{kinds})\s+(?:of\s+)?((?:[A-Z][A-Za-z.]*)(?:\s+[A-Z][A-Za-z.]*){{0,2}})', text):
        add(m)
    return found[:12]


# ---------- 2단계: NCBI E-utilities ----------

def esearch(term, retmax, sort=None):
    """(PMID 목록, PubMed에 있는 전체 편수). 연도를 고르게 남기려면 목록을 다 받아야 해요."""
    q = {'db': 'pubmed', 'term': term, 'retmax': retmax, 'retmode': 'json', 'tool': TOOL}
    if sort:
        q['sort'] = sort
    time.sleep(PAUSE)
    r = json.loads(get(f'{EUTILS}/esearch.fcgi?{urllib.parse.urlencode(q)}')).get('esearchresult', {})
    return r.get('idlist', []), int(r.get('count', 0))


def efetch(pmids):
    out = []
    for i in range(0, len(pmids), 100):
        chunk = pmids[i:i + 100]
        q = {'db': 'pubmed', 'id': ','.join(chunk), 'retmode': 'xml', 'tool': TOOL}
        time.sleep(PAUSE)
        out.append(get(f'{EUTILS}/efetch.fcgi?{urllib.parse.urlencode(q)}'))
    return out


def text_of(el):
    return re.sub(r'\s+', ' ', ''.join(el.itertext())).strip() if el is not None else ''


def parse_article(art, surs, init, full_keys):
    """PubmedArticle 하나 → 초안에 쓸 만큼만. 이름이 맞는 저자의 순서·소속을 남겨요."""
    cit = art.find('MedlineCitation')
    if cit is None:
        return None
    pmid = text_of(cit.find('PMID'))
    a = cit.find('Article')
    if a is None or not pmid:
        return None
    year = ''
    for path in ('Journal/JournalIssue/PubDate/Year', 'Journal/JournalIssue/PubDate/MedlineDate'):
        m = re.search(r'(?:19|20)\d{2}', text_of(a.find(path)))
        if m:
            year = m.group(0)
            break
    # DOI는 이 논문의 것만. art.iter('ArticleId')로 훑으면 PubmedData/ReferenceList 안에 있는
    # '참고문헌의 DOI'까지 잡혀서, 엉뚱한 논문 주소가 대표 논문으로 들어가요.
    doi = ''
    idlist = art.find('PubmedData/ArticleIdList')
    for eid in (idlist.findall('ArticleId') if idlist is not None else []):
        if eid.get('IdType') == 'doi':
            doi = text_of(eid)
            break
    if not doi:
        for eid in a.findall('ELocationID'):
            if eid.get('EIdType') == 'doi':
                doi = text_of(eid)
                break
    abstract = ' '.join(text_of(t) for t in a.iter('AbstractText')).strip()

    authors, me = [], []
    alist = a.find('AuthorList')
    items = alist.findall('Author') if alist is not None else []
    for n, au in enumerate(items, 1):
        last = text_of(au.find('LastName'))
        fore = text_of(au.find('ForeName'))
        ini = text_of(au.find('Initials'))
        authors.append(f'{last} {ini}'.strip())
        if canon(last) not in surs:
            continue
        key = canon(fore)
        # 표기 차이를 지운 꼴(canon)이 같을 때만 '맞음'이에요. 비슷하다고 맞다고 하면
        # Dongseon(동선)과 Dongseok(동석)처럼 다른 분이 섞여요. 그래도 표기가 다른 본인
        # 논문은 이니셜로 걸려서 후보에 남고, 고르는 건 다음 단계가 소속을 보고 해요.
        exact = bool(key) and key in full_keys
        # 교수소개가 이름을 한 덩어리로 쓰면(Dongseon → D) PubMed 이니셜(DS)과 길이가 달라요
        iu, tu = ini.upper(), init.upper()
        if exact or (iu and (iu.startswith(tu) or tu.startswith(iu))):
            aff = ' / '.join(text_of(x) for x in au.iter('Affiliation'))
            me.append({'pos': n, 'of': len(items), 'last_author': n == len(items),
                       'name': f'{last} {fore or ini}'.strip(), 'exact': exact, 'aff': aff[:400]})
    return {
        'pmid': pmid,
        'doi': doi,
        'journal': text_of(a.find('Journal/ISOAbbreviation')) or text_of(a.find('Journal/Title')),
        'year': year,
        'title': text_of(a.find('ArticleTitle')),
        'abstract': abstract[:1500],
        'type': [text_of(t) for t in a.iter('PublicationType')],
        'authors_n': len(items),
        'first_authors': authors[:3],
        'last_author': authors[-1] if authors else '',
        'me': me,
    }


def spread(pool, cap):
    """연도를 고르게 남겨요. 발자취를 쓰려면 옛 논문도 있어야 해서 최근 것만 남기지 않아요."""
    if len(pool) <= cap:
        return pool
    pool = sorted(pool, key=lambda p: (p['year'] or '0', p['pmid']))
    early, late = pool[:15], pool[-40:]
    mid = pool[15:-40]
    need = max(0, cap - len(early) - len(late))
    if mid and need:
        step = len(mid) / need
        mid = [mid[int(i * step)] for i in range(need)]
    else:
        mid = []
    return early + mid + late


def pick(papers, cap):
    """예산 때문에 후보를 줄일 때.

    이름 전체가 맞는 논문(rank 2·3)을 먼저 다 넣고, 이니셜만 맞는 논문은 25편까지만 보태요.
    'Kim D'처럼 흔한 표기는 PubMed가 'Kim DS'·'Kim DH'까지 다 주기 때문에, 그대로 두면
    동명이인이 프롬프트를 메워요. 다만 옛 논문은 PubMed에 이름 전체가 없어서 이니셜만
    맞는 것밖에 없을 수 있어요. 그래서 이름이 맞는 논문이 아예 없으면 한도를 다 내줘요.
    """
    strong = [p for p in papers if p['rank'] >= 2]
    weak = sorted([p for p in papers if p['rank'] < 2],
                  key=lambda p: (p['rank'], p['year'] or '0'), reverse=True)
    if len(strong) >= cap:
        keep = spread(strong, cap)
    else:
        room = cap - len(strong)
        keep = strong + weak[:(min(room, WEAK_CAP) if strong else room)]
    return keep, len(papers) - len(keep)


CAP = 70
WEAK_CAP = 25     # 이니셜만 맞는 논문은 이만큼까지만
INIT_MAX = 400    # 이니셜 검색이 이보다 넓으면 좁히거나 버려요

# 교실 이름을 PubMed 소속 검색말로 (이니셜 검색이 너무 넓을 때만 써요)
DEPT_WORDS = {
    '해부학교실': ['anatomy'],
    '생리학교실': ['physiology'],
    '생화학·세포생물학교실': ['biochemistry', 'cell biology'],
    '병리학교실': ['pathology'],
    '약리학교실': ['pharmacology'],
    '미생물학교실': ['microbiology'],
    '기생충학·열대의학교실': ['parasitology', 'tropical medicine'],
    '면역학교실': ['immunology'],
    '분자의학교실': ['molecular medicine'],
}


def collect_one(p, detail):
    initials, full_forms, surs = name_variants(detail['name_en'], p['name'])
    if not initials:
        return None
    init = initials[0].split()[1]
    sur_keys = {canon(s) for s in surs}
    full_keys = {canon(f.split(' ', 1)[1]) for f in full_forms}
    affs = affiliations(detail)

    ad = ' OR '.join(f'"{a}"[Affiliation]' for a in affs)
    # 이름 전체로 찾기: 표기가 여러 가지라도 꽤 좁아서 소속 조건 없이 경력 전체를 훑어요.
    q_name = ' OR '.join(f'"{v}"[Author]' for v in full_forms)
    ids_name, n_name = esearch(q_name, 1000) if q_name else ([], 0)

    # 이니셜로 찾기: 옛 논문은 PubMed에 이름 전체가 없어서 이것 말고는 길이 없어요.
    # 다만 'Lee J'처럼 흔한 표기는 소속을 걸어도 수천 편이라, 넓으면 교실 이름으로 좁히고
    # 그래도 넓으면 아예 쓰지 않아요 (앞의 900편만 받으면 최근 논문만 남아서요).
    q_init = f'({initials[0]}[Author]) AND ({ad})'
    _, n_init = esearch(q_init, 0)
    narrowed = ''
    if n_init > INIT_MAX:
        words = DEPT_WORDS.get(p['dept'], [])
        if words:
            dw = ' OR '.join(f'"{w}"[Affiliation]' for w in words)
            q2 = f'({initials[0]}[Author]) AND ("Kyungpook"[Affiliation]) AND ({dw})'
            _, n2 = esearch(q2, 0)
            if n2 <= INIT_MAX:
                q_init, n_init, narrowed = q2, n2, f' (교실 이름으로 좁혀 {n2}편)'
    if n_init > INIT_MAX:
        ids_init, used = [], f'{n_init}편이라 안 씀'
    else:
        ids_init, _ = esearch(q_init, 1000)
        used = f'{n_init}편{narrowed}'
    ids = list(dict.fromkeys(ids_name + ids_init))[:1000]
    print(f'    이름 전체 {n_name}편, 이니셜 {used} → 받아 볼 {len(ids)}편')

    papers = []
    aff_terms = [a.lower() for a in affs]
    for raw in efetch(ids):
        for art in ET.fromstring(raw).iter('PubmedArticle'):
            rec = parse_article(art, sur_keys, init, full_keys)
            if rec is None or not rec['me']:
                continue
            rec['aff_hit'] = any(t in m['aff'].lower() for m in rec['me'] for t in aff_terms)
            rec['exact'] = any(m['exact'] for m in rec['me'])
            rec['rank'] = (2 if rec['exact'] else 0) + (1 if rec['aff_hit'] else 0)
            papers.append(rec)
    papers.sort(key=lambda r: (r['year'] or '0'), reverse=True)
    kept, dropped = pick(papers, CAP)
    return {
        'name_en': detail['name_en'], 'edu': detail['edu'], 'career': detail['career'],
        'info': detail['info'], 'variants': initials + full_forms, 'surnames': surs,
        'homonym': detail.get('homonym', False), 'extra_source': detail.get('extra_source', ''),
        'affiliations': affs,
        'queries': {'init': q_init, 'name': q_name},
        'pubmed_count': {'init': n_init, 'name': n_name},
        'found': len(papers), 'over_cap': dropped, 'papers': kept,
    }


def main():
    people = targets()
    print(f'대상 {len(people)}분')
    WORK.mkdir(exist_ok=True)
    out_path = WORK / 'candidates.json'
    out = json.loads(out_path.read_text(encoding='utf-8')) if out_path.exists() else {}

    # 교실별 교수소개 목록은 한 번만 읽어요
    lists = {}
    for dept in sorted({p['dept'] for p in people}):
        cate = DEPT_CATE.get(dept)
        if cate is None:
            print(f'  교실 번호를 몰라요: {dept}')
            continue
        lists[dept] = school_list(cate)
        print(f'  {dept}: 교수소개 {len(lists[dept])}분')

    for p in people:
        if p['id'] in out:
            print(f"{p['name']} ({p['dept']}): 이미 모았어요")
            continue
        print(f"{p['name']} ({p['dept']}) {p['id']}")
        same = [x for x in lists.get(p['dept'], []) if x[0] == p['name']]
        # 같은 교실에 이름이 같은 교수님이 또 계시면(병리학 박지영) 직위로 가려요.
        # 가려도 논문은 둘을 나눌 수 없어서, 초안 쓸 때 알도록 표시를 남겨요.
        homonym = len(same) > 1
        if homonym:
            byrank = [x for x in same if x[1] == p.get('rank')]
            print(f"    교수소개에 같은 이름이 {len(same)}분 → 직위({p.get('rank')})로 {len(byrank)}분")
            same = byrank
        if len(same) != 1:
            print(f'    교수소개에서 {len(same)}분 → 건너뜀')
            out[p['id']] = {'error': f'교수소개에서 {len(same)}분'}
            out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
            continue
        detail = school_detail(same[0][2])
        detail['rank_site'] = same[0][1]
        detail['homonym'] = homonym
        ex = extra_for(p['id'])
        for k in ('edu', 'career', 'info'):
            if ex.get(k):
                detail[k] = ex[k]
        if ex.get('source'):
            detail['extra_source'] = ex['source']
            print(f"    학력·경력은 extra.json 에서 ({ex['source']})")
        print(f"    영문 이름 {detail['name_en'] or '없음'}, 학력 {len(detail['edu'])}줄, 경력 {len(detail['career'])}줄")
        rec = collect_one(p, detail)
        if rec is None:
            out[p['id']] = {'error': '영문 이름을 못 읽음', 'detail': detail}
        else:
            rec['rank_site'] = detail['rank_site']
            out[p['id']] = rec
            print(f"    후보 {rec['found']}편 → 남김 {len(rec['papers'])}편"
                  + (f" (예산으로 {rec['over_cap']}편 줄임)" if rec['over_cap'] else ''))
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'→ {out_path}')


if __name__ == '__main__':
    main()
