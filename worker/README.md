# 라운지 Worker

브라우저가 할 수 없는 일만 맡는 Cloudflare Worker예요. 파일은 `worker.js` 하나예요.

| 주소 | 누가 | 하는 일 |
|---|---|---|
| `GET /status` | 교수님 | Claude를 쓸 수 있는지, 오늘 몇 번 썼는지 |
| `POST /ai/menu` | 교수님 | 메뉴판 사진에서 메뉴 이름 읽기 (주문판, 친목회 만들기) |
| `GET·PUT·DELETE /admin/key` | 관리자 | Claude API 키 넣기·확인(끝 4자리만)·지우기 |

- 요청마다 Firebase 로그인 토큰의 서명·발급처·대상·만료를 확인해요. 그 토큰으로 Firestore를 읽어 교수님(가입을 마치고 멈추지 않은 분)인지, 관리자인지 봐요.
- Claude API 키는 KV에만 있어요. 브라우저로는 끝 4자리만 돌아가요.
- 프롬프트는 `worker.js` 안에 고정이에요. 교수님 화면은 사진만 보내요.
- 한도: 한 분당 하루 20번, 라운지 전체 하루 300번(한국 시간). `worker.js`의 `LIMITS`에서 바꿔요.
- 사진과 답은 저장하지 않아요. KV에는 키와 그날 쓴 횟수만 남고, 횟수는 3일 뒤 저절로 지워져요.

## 처음 배포 (한 번)

Cloudflare 무료 요금제로 돼요.

1. [Cloudflare 대시보드](https://dash.cloudflare.com)에 가입하고 로그인해요.
2. **Storage & Databases › KV › Create**에서 이름을 `lounge`로 만들어요.
3. **Workers & Pages › Create › Worker**에서 이름을 `knumed-lounge`로 정하고 **Deploy**를 눌러요.
4. **Edit code**를 누르고, 처음 들어 있는 코드를 지운 뒤 이 폴더의 `worker.js`를 통째로 붙여 넣고 **Deploy**를 눌러요.
5. 그 Worker의 **Settings › Bindings › Add › KV namespace**에서 Variable name은 `LOUNGE`, KV namespace는 `lounge`로 정해 저장해요.
6. Worker 주소(`https://knumed-lounge.<계정 이름>.workers.dev`)를 복사해요. 저장소의 `js/worker-config.js`에서 `WORKER_URL`에 넣고 커밋해요. Claude에게 주소만 알려 줘도 돼요.
7. 사이트의 **관리자 › Claude 키**에서 키를 넣어요.
   - 키는 [Claude Console](https://console.anthropic.com)에서 만들어요.
   - 크레딧은 Claude 구독과 따로 그곳에서 충전해요.
   - 넣을 때 Worker가 Anthropic에 맞는 키인지 먼저 확인해요.

## 고칠 때

- `worker.js`를 고치면 4번처럼 다시 붙여 넣고 **Deploy**를 눌러요.
- 확인: 저장소 맨 위에서 `node --test`를 돌려요. `tests/worker.test.js`가 Cloudflare 없이 토큰 확인, 관리자 키, 메뉴판 읽기 요청 모양, 하루 한도를 봐요.
- 다른 주소에서 부르려면 `worker.js`의 `ORIGINS`에 더하거나, Worker의 **Settings › Variables**에 `ALLOWED_ORIGINS`(쉼표로 나눔)를 넣어요.

## 아직 안 하는 것

- **남의 PIN 초기화, 로그인 계정 지우기, 임시 PIN으로 계정 만들기.** Firebase 서비스 계정 키가 Worker 비밀값으로 있어야 해요. 그 전까지는 관리자 화면이 Firebase 콘솔에서 하는 순서를 안내해요.
- **공동연구 찾기**(`/ai/ask`). 같은 키와 한도를 쓸 거예요(DESIGN.md §11).
