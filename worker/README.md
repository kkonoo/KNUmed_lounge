# 라운지 Worker

브라우저가 할 수 없는 일만 맡는 Cloudflare Worker예요. 파일은 `worker.js` 하나예요.

| 주소 | 누가 | 하는 일 |
|---|---|---|
| `GET /status` | 교수님 | Claude를 쓸 수 있는지, 오늘 몇 번 썼는지 |
| `POST /ai/menu` | 교수님 | 메뉴판 사진에서 메뉴 이름 읽기 (주문판, 친목회 만들기) |
| `POST /ai/ask` | 교수님 | 공동연구 찾기: 질문 하나 → 교수님 2~3분, 근거 칸, 처음 물어볼 질문 |
| `GET·PUT·DELETE /admin/key` | 관리자 | Claude API 키 넣기·확인(끝 4자리만)·지우기 |

- 요청마다 Firebase 로그인 토큰의 서명·발급처·대상·만료를 확인해요. 그 토큰으로 Firestore를 읽어 교수님(가입을 마치고 멈추지 않은 분)인지, 관리자인지 봐요.
- Claude API 키는 KV에만 있어요. 브라우저로는 끝 4자리만 돌아가요.
- 프롬프트는 `worker.js` 안에 고정이에요. 교수님 화면은 사진이나 질문 글만 보내요.
- 공동연구 찾기의 문맥은 Worker가 직접 만들어요. 공개 데이터(`data/people.json`, GitHub Pages)와 Firestore 프로필을 연구실 둘러보기와 같은 규칙(`people/people-core.js`의 `mergeProfiles`를 그대로 가져다 씀)으로 합쳐요. 화면이 보낸 문맥은 받지 않아요.
- 답에서 없는 번호와 질문한 본인은 빼고 3분까지만 돌려줘요. 이름·교실·사진은 Claude 답이 아니라 프로필에서 붙여요.
- 한도: 한 분당 하루 20번, 라운지 전체 하루 300번(한국 시간). `worker.js`의 `LIMITS`에서 바꿔요.
- 사진·질문·답은 저장하지 않아요. KV에는 키와 그날 쓴 횟수만 남고, 횟수는 3일 뒤 저절로 지워져요.

## 처음 배포 (한 번)

Cloudflare 무료 요금제로 돼요. Worker를 GitHub 저장소에 이어 두면, main에 올릴 때마다 Cloudflare가 저장소 맨 위의 `wrangler.jsonc`를 보고 `worker/worker.js`를 저절로 배포해요. 대시보드에 코드를 붙여 넣지 않아요.

1. [Cloudflare 대시보드](https://dash.cloudflare.com)에 가입하고 로그인해요.
2. **Workers & Pages › Create › Import a repository**에서 이 저장소를 고르고, 이름을 `knumed-lounge`로 정해 **Deploy**를 눌러요. 이때는 아직 사이트 파일만 올라가요.
3. **Storage & databases › Workers KV › Create**에서 이름을 `lounge`로 만들고, 그 **ID**를 복사해요.
4. 그 ID를 Claude에게 알려 줘요. Claude가 저장소의 설정 파일(`wrangler.jsonc`)에 넣어 올려요. ID는 비밀 값이 아니라 보내도 괜찮아요.
5. 올리면 Worker의 **Deployments**에 새 배포가 생겨요. 끝나면 주소(`https://knumed-lounge.<계정 하위 도메인>.workers.dev`)가 켜져요(`workers_dev: true`).
6. 그 주소를 `js/worker-config.js`의 `WORKER_URL`에 넣고 커밋해요. 이 주소는 사이트 코드에 그대로 보여요.
7. 사이트의 **관리자 › Claude 키**에서 키를 넣어요.
   - 키는 [Claude Console](https://console.anthropic.com)에서 만들어요.
   - 크레딧은 Claude 구독과 따로 그곳에서 충전해요.
   - 넣을 때 Worker가 Anthropic에 맞는 키인지 먼저 확인해요.

## 고칠 때

- `worker.js`를 고쳐 main에 올리면 저절로 다시 배포돼요. 결과는 Worker의 **Deployments**에서 봐요.
- 확인: 저장소 맨 위에서 `node --test`를 돌려요. `tests/worker.test.js`가 Cloudflare 없이 토큰 확인, 관리자 키, 메뉴판 읽기 요청 모양, 하루 한도를 봐요.
- `worker.js`는 `export default` 하나만 내보내요. Workers 런타임은 다른 export(글자·객체)가 있으면 시작하지 않아요. 검사에 쓰는 값은 default 안에 둬요(검사가 확인해요).
- 다른 주소에서 부르려면 `worker.js`의 `ORIGINS`에 더하거나, Worker의 **Settings › Variables**에 `ALLOWED_ORIGINS`(쉼표로 나눔)를 넣어요.

## 아직 안 하는 것

- **남의 PIN 초기화, 로그인 계정 지우기, 임시 PIN으로 계정 만들기.** Firebase 서비스 계정 키가 Worker 비밀값으로 있어야 해요. 그 전까지는 관리자 화면이 Firebase 콘솔에서 하는 순서를 안내해요.
