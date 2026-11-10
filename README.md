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
