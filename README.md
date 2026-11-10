# 경북의대 라운지

경북대학교 의과대학 기초교실 교수님들이 쓰는 작은 사이트예요. 기초친목회 공지와 참석 체크, 교수님별 연구 소개, 그리고 "이런 게 필요한데 누구한테 가면 될까"를 물어보는 공동연구 찾기를 한곳에 모아요.

https://kkonoo.github.io/KNUmed_lounge/

지금은 설계 단계예요. 무엇을 왜 이렇게 만드는지는 [DESIGN.md](DESIGN.md)에 있어요.

## 한눈에

| 화면 | 누가 보나 | 하는 일 |
|---|---|---|
| 🍽️ 친목회 | 회원 | 이번 달 날짜·장소, 참석 체크, 누가 오는지 |
| 👩‍🔬 교수 디렉터리 | 누구나 | 교수님별 연구 질문, 보유 자원(모델·시료·장비·데이터·기법), 논문 |
| 🤝 공동연구 찾기 | 회원 | 필요한 것을 적으면 AI가 맞는 교수님 2~3분과 근거를 알려 줌 |
| 🔧 관리자 | 관리자 | 명단, 계정, PIN 초기화, 관리자 지정, 가입 코드 |

- 로그인은 메일 주소와 PIN(숫자 4자리도 돼요)이에요. 메일 인증은 없어요.
- 처음 들어올 때는 친목회 공지 메일에 있는 가입 코드를 같이 넣어요.

## 지금 되는 것

- 🔬 교수 디렉터리: 이름북의 기초 38분. 이름·교실·키워드·소개로 찾고 교실·주제로 걸러요. 거른 상태는 주소 `#` 뒤에 남아서 링크로 보낼 수 있어요(예: `people/#dept=생리학교실`).
- 친목회·공동연구 찾기·로그인은 Firebase를 연결한 뒤에 열어요.

## 구조

빌드·설치할 것 없는 HTML/CSS/JS예요. 화면마다 폴더 하나예요.

```
index.html              홈: 입구 카드
css/base.css            모든 화면이 같이 쓰는 색(라이트/다크 자동)·단추·판 (toy_box에서)
css/home.css            홈 카드
js/ui.js                화면 만들기(h, button), 이 기기에 저장(store, 'lounge:<화면>'), 알림 (toy_box에서)
js/theme.js             화면 밝기 🌗 자동·☀️ 밝게·🌙 어둡게 (이 기기 'lounge:theme')
people/                 교수 디렉터리: index.html · people.js(화면) · people-core.js(계산, 화면 없음) · people.css
data/people.json        디렉터리 데이터 (공개 파일, 메일·연락처 없음)
photos/<번호>.jpg       사진 (프로필 번호로 이름 붙임)
pipeline/               데이터 만들기 (사이트와 따로 실행)
tests/                  node --test
```

### 디렉터리 데이터 다시 만들기

이름북을 고쳤으면 그 저장소를 받아 두고 이렇게 돌려요. 이미 있는 분은 같은 번호를 그대로 써요.

```bash
pip install pillow
python3 pipeline/from_namebook.py ../Biomed_KNUmed
```

### 확인 (테스트)

저장소 맨 위에서 `node --test`. 찾기·거르기 계산과, `data/people.json`에 메일·연락처가 들어가지 않았는지를 확인해요.

## 이 저장소에 두지 않는 것

이 저장소는 공개예요. 그래서 아래는 여기 올리지 않아요.

- 회원 명단과 메일 주소 → Firestore(관리자만 읽음)
- 가입 코드 → Firestore(Worker만 읽음)
- Anthropic API 키, Firebase 서비스 계정 키 → Cloudflare Worker 비밀값
- 연구실 내부 메모나 미출판 내용 → 어디에도 넣지 않음

## 함께 쓰는 것

- 화면·색·밝기 전환은 [toy_box](https://github.com/kkonoo/toy_box)에서 가져와요.
- 교수 디렉터리는 [Biomed_KNUmed 이름북](https://github.com/kkonoo/Biomed_KNUmed)의 `profs.json`에서 시작해요.
- AI 채팅은 [수업 사이트](https://github.com/kkonoo/advanced_BI_for_MD_PhD_KNUmed)의 Worker 구조를 다시 써요.
