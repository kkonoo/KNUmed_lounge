# 경북의대 라운지

경북대학교 의과대학 기초교실 교수님들이 쓰는 작은 사이트예요. 기초친목회 공지와 참석 체크, 자유 게시판, 교수님별 연구 소개를 한곳에 모았어요. 폰 홈 화면에 앱처럼 설치할 수 있어요.

주소: https://kkonoo.github.io/KNUmed_lounge/

무엇을 왜 이렇게 만드는지는 [DESIGN.md](DESIGN.md)에 있어요.

## 기능

| 화면 | 누가 | 하는 일 |
|---|---|---|
| 기초친목회 | 교수님 | 다가오는 친목회 날짜·장소, 참석·미정·불참 체크와 한마디(고른 것을 한 번 더 누르면 취소), 식당 메뉴 미리 고르기(관리자가 켰을 때), 누가 오는지. 관리자는 만들기·고치기·마감·공지 문구 복사, 아직 체크 안 한 분 보기 |
| 주문 모으기 | 교수님 | 친목회마다 카페·식당 주문판. 메뉴마다 ＋/−, 바를 정, 아이스·따뜻한, 주문 복사. 각자 폰으로 눌러도 폰 한 대를 돌려도 같이 쌓여요. 관리자가 친목회를 만들 때 넣어 둔 메뉴로 바로 열리고, 없으면 지난번 메뉴가 미리 채워져요 |
| 자유 게시판 | 교수님 | 글과 댓글. 이름은 실명. 내 글은 고치고 지우고, 관리자는 아무 글·댓글이나 지워요. 홈 카드에 지난번 본 뒤 올라온 새 글 수가 보여요 |
| 연구실 둘러보기 | 누구나 | 교수님별 연구 소개와 키워드. 카드를 누르면 연구 질문·연구 축·발자취·보유 자원이 자세히 보여요(찾는 것·연락처는 로그인한 교수님만). 이름·교실·키워드로 찾고 교실·주제로 걸러요(고른 칩을 한 번 더 누르면 풀려요). 거른 상태는 주소 `#` 뒤에 남아 링크로 보낼 수 있어요(예: `people/#dept=생리학교실`) |
| 내 프로필 | 교수님 | 연구실 둘러보기에 보이는 내 소개를 고쳐요. 저장하면 본인 확인이 돼요. 계정 화면의 ‘내 프로필’ |
| 로그인 | 누구나 | 메일 주소 + PIN(숫자 4자리도 돼요). 처음엔 가입 코드를 같이 넣어요. 한 기기에서 한 번 로그인하면 계속 유지돼요 |
| 관리자 | 관리자 | 명단 붙여 넣기·고치기·멈추기·지우기, 명단과 연구실 둘러보기 프로필 잇기, 관리자 지정·해제, 가입 코드, Claude 키(메뉴판 사진 읽기용, Worker), 작업 기록 |
| 공동연구 찾기 | 교수님 | 준비 중이에요 |

머리 줄 오른쪽 끝 해·달 단추에서 화면 밝기(자동·밝게·어둡게)와 글씨 크기(작게·보통·크게·아주 크게)를 골라요.

## 처음 쓸 때

관리자가 한 번만 해요.

1. [Firebase 콘솔](https://console.firebase.google.com/project/knumed-lounge)에서 **Authentication › 시작하기 › 로그인 방법 › 이메일/비밀번호**를 사용 설정해요(이메일 링크는 꺼 둬요).
2. **Firestore Database › 데이터베이스 만들기**(위치 `asia-northeast3` 서울, 프로덕션 모드) → **규칙** 탭에 이 저장소의 `firestore.rules`를 통째로 붙여 넣고 게시해요. 규칙을 고치면 다시 붙여 넣어야 적용돼요.
3. GitHub 저장소 **Settings › Pages**에서 Branch를 `main`, `/ (root)`로 정해요.
4. 사이트의 **관리자**(`admin/`)를 열면 ‘처음 설정’이 나와요. 이름·메일·PIN·가입 코드를 넣으면 첫 관리자가 되고, 이 화면은 그다음부터 잠겨요.
5. **명단** 탭에서 ‘명단 붙여 넣기’에 친목회 메일의 받는 사람 칸을 그대로 붙여 넣어요(`홍길동 교수님 <메일>, …`). 교실은 나중에 ‘고치기’로 넣어도 돼요.
6. 명단 탭의 **연구실 둘러보기 프로필 잇기**에서 ‘이름북 프로필과 잇기’(목록을 보고 틀린 분이 없는지 확인)와 ‘새 프로필 만들기’를 눌러요. 이어진 교수님만 자기 프로필을 고칠 수 있어요.
7. **가입 코드** 탭에서 ‘문구 복사’를 눌러 다음 친목회 공지 메일에 붙여요.
8. **기초친목회**에서 ＋ 새 친목회로 이번 달 모임을 올리고, ‘공지 문구’를 메일에 붙여요.

교수님은 메일의 링크를 열고 ‘처음 가입’에서 메일 주소, 가입 코드, PIN을 넣으면 끝이에요.

PIN을 잊으신 분은 관리자 화면 명단의 ‘PIN 초기화’가 순서를 안내해요(지금은 Firebase 콘솔에서 로그인 계정을 지우고 다시 가입).

## 데이터는 어디에

| 무엇 | 어디 | 누가 읽나 |
|---|---|---|
| 연구 소개 (이름북) | 저장소 `data/people.json`, `photos/` (공개 파일, 메일·연락처 없음) | 누구나 |
| 연구 소개 (본인이 고친 것) | Firestore `profiles/{번호}` | 누구나 |
| 찾는 것·요즘 한 줄·연락처 | Firestore `profiles/{번호}/private/info` | 교수님 |
| 명단 (메일·이름·교실) | Firestore `roster/{메일}` | 관리자, 그 메일로 로그인한 본인 |
| 가입한 교수님 | Firestore `members/{uid}` | 교수님 |
| 관리자 목록 · 가입 코드 | Firestore `config/admins` · `config/signup` | 누구나(계정 번호뿐) · 관리자 |
| 친목회 · 참석 체크 | Firestore `events/{행사}` · `events/{행사}/rsvps/{uid}` | 교수님 |
| 주문판 · 지난번 메뉴 | Firestore `events/{행사}/orders/{cafe·meal}` · `menus/{cafe·meal}` | 교수님 |
| 자유 게시판 · 댓글 | Firestore `posts/{글}` · `posts/{글}/comments/{댓글}` | 교수님 |
| 관리 작업 기록 | Firestore `adminLog/` | 관리자 |
| 화면 밝기·글씨 크기, 설치 배너 닫음, 게시판 마지막으로 본 때 | 이 기기 localStorage `lounge-prefs`, `lounge-app`, `lounge-board` | 이 기기 |

누가 무엇을 쓰고 읽는지는 화면이 아니라 `firestore.rules`가 지켜요. 가입 코드 확인, 마지막 관리자 보호, 멈춘 계정 막기, 마감 뒤 체크 막기도 규칙이 해요.

이 저장소는 공개라서 아래는 여기 두지 않아요.

- 교수님 명단과 메일 주소, 가입 코드 → Firestore
- Claude API 키 → 관리자 화면에서 넣으면 Cloudflare Worker의 KV에만 저장 (브라우저로는 끝 4자리만)
- Firebase 서비스 계정 키 → (PIN 초기화를 붙일 때) Cloudflare Worker 비밀값
- 연구실 내부 메모나 미출판 내용 → 어디에도 넣지 않음

## 개발

```powershell
powershell -ExecutionPolicy Bypass -File tools/serve.ps1     # http://localhost:8767/  (다른 번호: $env:PORT=8770)
```

- 확인(테스트): 저장소 맨 위에서 `node --test`. 계정·명단 붙여 넣기·친목회·게시판·주문·찾기 계산, Worker(토큰 확인·관리자 키·한도), 공개 데이터에 메일·연락처가 없는지 확인해요.
- Worker 배포·고치기: `worker/README.md`.
- 규칙·화면 흐름 확인: `cd tests/emulator`, 처음 한 번 `npm install`, 그다음 `npm test` (Java 21 이상과 Playwright 필요). Firebase 에뮬레이터를 켜서
  - `rules.spec.js`: `firestore.rules`가 화면이 하는 읽기·쓰기는 받고, 하면 안 되는 것은 막는지 봐요.
  - `flow.spec.js`: Chromium으로 처음 설정 → 명단 65분 → 가입 코드로 가입 → 친목회 참석 체크 → 게시판 → PIN 바꾸기 → 멈춤까지 눌러 봐요.
  - 사이트 코드는 그대로 두고 검사할 때만 설정을 가짜 프로젝트(`demo-lounge`)로 바꿔서, 실제 Firebase에는 닿지 않아요. 이름·메일은 모두 가짜예요.
  - `firestore.rules`를 고치면 이 검사를 돌리고, Firebase 콘솔 › Firestore › 규칙에 다시 붙여 넣어요.
- 연구 소개 다시 만들기: 이름북 저장소를 받아 두고 `python3 pipeline/from_namebook.py ../Biomed_KNUmed` (Pillow 필요). 이미 있는 분은 같은 번호를 그대로 써요.
- 앱 아이콘 다시 그리기: `icons/icon.svg`를 고치고 `python3 tools/make-icons.py` (Playwright 필요).
- 화면 아이콘 더하기: `tools/make-icon-set.py`의 `NAMES`에 Lucide 이름을 넣고, `npm i lucide-static` 한 폴더의 `node_modules/lucide-static/icons`를 넘겨 다시 돌려요.
- 화면 파일을 더하면 `sw.js`의 `SHELL`에도 적어요(오프라인).
- PIN은 사이트가 앞뒤에 정해진 글자를 붙여 Firebase 비밀번호로 써요(`js/account-core.js` `pinToPassword`). 이 모양을 바꾸면 모든 PIN이 안 맞게 되니 바꾸지 마세요.

## 파일

| 파일 | 내용 |
|---|---|
| `index.html` | 홈: 다음 친목회 한 줄, 입구 카드(게시판 새 글 수), 앱 설치 배너 |
| `events/` | 기초친목회: `events.js`(화면) · `events-core.js`(계산) · `events-db.js`(Firestore) · `events.css` |
| `order/` | 주문 모으기: `order.js` · `order-core.js`(계산, 장난감 상자에서) · `order-db.js` · `order.css` |
| `board/` | 자유 게시판: `board.js` · `board-core.js` · `board-db.js` · `board.css` |
| `people/` | 연구실 둘러보기(목록·자세히): `people.js` · `people-core.js`(계산) · `profile-db.js`(Firestore) · `people.css`. `people/me/`는 내 프로필 고치기 |
| `login/` | 로그인 · 처음 가입 · PIN 바꾸기 |
| `admin/` | 관리자: `admin.js` · `admin-db.js` · `admin.css` |
| `css/style.css` | 공통 디자인 토큰(kkonoo 웹앱 공통) + 크림슨 강조색 + 공용 부품 + 홈 |
| `js/session.js` | Firebase 연결, 로그인 상태, 가입, 계정 단추 |
| `js/account-core.js` | PIN·메일·가입 코드·명단 붙여 넣기 계산 |
| `js/form.js` · `js/ui.js` | 입력 부품 · 화면 만들기·토스트 |
| `js/theme.js` · `js/pwa.js` | 화면 밝기·글씨 크기 · 앱 설치 배너 |
| `js/icons.js` | 쓰는 Lucide 아이콘만 모은 것. `icon('map-pin')` 또는 HTML `<span data-icon="map-pin">` |
| `js/firebase-config.js` | Firebase 설정 (공개돼도 되는 값) |
| `firestore.rules` | Firestore 보안 규칙 (콘솔에 붙여 넣음) |
| `manifest.webmanifest` · `sw.js` · `icons/` | 앱 설치·오프라인·아이콘 |
| `data/people.json` · `photos/` | 연구 소개 데이터와 사진 |
| `pipeline/from_namebook.py` | 이름북 → 연구 소개 데이터 |
| `tools/serve.ps1` · `tools/make-icons.py` · `tools/make-icon-set.py` | 로컬 서버 · 앱 아이콘 그리기 · 화면 아이콘 모으기 |
| `worker/` | Cloudflare Worker: `worker.js`(메뉴판 읽기 · 관리자 Claude 키), 배포 안내 `README.md` |
| `js/worker-config.js` | Worker 주소 (배포한 뒤 넣음, 비어 있으면 사진 읽기 단추가 안 보임) |
| `tests/` | `node --test` (계산 · Worker) · `tests/emulator/` (`npm test`: 규칙·화면 흐름, 에뮬레이터) |

## 함께 쓰는 것

- 화면 부품(`ui.js`·`theme.js`·`pwa.js`)과 서비스 워커는 [toy_box](https://github.com/kkonoo/toy_box)에서 가져와 공통 규칙에 맞췄어요. 주문 모으기(`order/`)도 장난감 상자의 주문 모으기를 가져와 Firestore로 같이 쌓이게 바꿨어요.
- 연구 소개는 [Biomed_KNUmed 이름북](https://github.com/kkonoo/Biomed_KNUmed)에서 시작해요.
- 강조색은 [HaLab 슬라이드 갤러리](https://kkonoo.github.io/slide-gallery/)의 crimson이에요.
- 앱 아이콘과 화면 아이콘은 [Lucide](https://lucide.dev) (ISC)예요. 이모지는 주제 거르기와 참석 체크에만 써요.
