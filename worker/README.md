# 라운지 Worker

브라우저가 할 수 없는 일만 맡는 Cloudflare Worker예요. 파일은 `worker.js` 하나예요.

| 주소 | 누가 | 하는 일 |
|---|---|---|
| `GET /status` | 교수님 | Claude를 쓸 수 있는지, 오늘 몇 번 썼는지 |
| `POST /ai/menu` | 교수님 | 메뉴판 사진에서 메뉴 이름 읽기 (주문판, 친목회 만들기) |
| `POST /ai/ask` | 교수님 | 공동연구 찾기: 질문 하나 → 맞는 교수님 모두, 근거 칸, 처음 물어볼 질문 |
| `GET·PUT·DELETE /admin/key` | 관리자 | Claude API 키 넣기·확인(끝 4자리만)·지우기 |
| `POST /admin/pin-reset` | 관리자 | 교수님 PIN을 0000으로 바꾸기. 명단에 있고 가입한 분만 (Firebase 서비스 계정 키 필요) |

- 요청마다 Firebase 로그인 토큰의 서명·발급처·대상·만료를 확인해요. 그 토큰으로 Firestore를 읽어 교수님(가입을 마치고 멈추지 않은 분)인지, 관리자인지 봐요.
- Claude API 키는 KV에만 있어요. 브라우저로는 끝 4자리만 돌아가요.
- Firebase 서비스 계정 키는 Worker 비밀값 `FIREBASE_SA`에만 있어요. PIN 초기화에만 쓰고 브라우저로 돌려주지 않아요.
- 프롬프트는 `worker.js` 안에 고정이에요. 교수님 화면은 사진이나 질문 글만 보내요.
- 공동연구 찾기의 문맥은 Worker가 직접 만들어요. 공개 데이터(`data/people.json`, GitHub Pages)와 Firestore 프로필을 연구실 둘러보기와 같은 규칙(`people/people-core.js`의 `mergeProfiles`를 그대로 가져다 씀)으로 합쳐요. 화면이 보낸 문맥은 받지 않아요.
- 답에서 없는 번호, 질문한 본인, 겹친 분은 빼고 돌려줘요. 이름·교실·사진은 Claude 답이 아니라 프로필에서 붙여요.
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

## PIN 초기화 켜기 (한 번)

관리자 화면 명단의 ‘PIN 초기화’는 Worker가 Firebase 서비스 계정 키로 그 교수님의 로그인 PIN을 0000으로 바꿔요. 키는 **Firebase Authentication 관리 권한만 있는 서비스 계정**으로 만들어요. 키가 새더라도 Firestore 데이터는 못 건드리게요.

1. [Google Cloud 콘솔 › 서비스 계정](https://console.cloud.google.com/iam-admin/serviceaccounts?project=knumed-lounge)에서 **서비스 계정 만들기**를 눌러요.
   - 이름: `lounge-pin-reset`
   - 역할: **Firebase Authentication Admin** (역할 ID `roles/firebaseauth.admin`)
2. 만든 계정을 열고 **키 › 키 추가 › 새 키 만들기 › JSON**을 눌러요. JSON 파일이 내려받아져요.
3. [Cloudflare 대시보드](https://dash.cloudflare.com) › **Workers & Pages › `knumed-lounge` › Settings › Variables and Secrets › Add**에서 넣어요.
   - Type: **Secret**
   - Name: `FIREBASE_SA`
   - Value: JSON 파일 내용을 통째로 붙여 넣기
   - **Deploy**를 눌러요. 비밀값은 main에 올려 다시 배포해도 그대로 남아요.
4. 내려받은 JSON 파일은 지워요. 저장소·메일·채팅 어디에도 올리지 않아요.
5. 관리자 화면 명단에서 가입한 교수님 줄의 ‘PIN 초기화’를 눌러 확인해요. 키가 없으면 ‘서비스 계정 키(FIREBASE_SA)가 아직 없어요’라고 나와요.

- 키를 바꿀 때는 2·3을 다시 하고, 예전 키는 서비스 계정의 **키** 탭에서 지워요.
- PIN을 바꾸면 그 교수님의 다른 기기 로그인은 풀릴 수 있어요(Firebase가 비밀번호가 바뀐 계정의 로그인을 끊어요).

## 고칠 때

- `worker.js`를 고쳐 main에 올리면 저절로 다시 배포돼요. 결과는 Worker의 **Deployments**에서 봐요.
- 확인: 저장소 맨 위에서 `node --test`를 돌려요. `tests/worker.test.js`가 Cloudflare 없이 토큰 확인, 관리자 키, 메뉴판 읽기 요청 모양, 하루 한도, PIN 초기화를 봐요.
- `worker.js`는 `export default` 하나만 내보내요. Workers 런타임은 다른 export(글자·객체)가 있으면 시작하지 않아요. 검사에 쓰는 값은 default 안에 둬요(검사가 확인해요).
- 다른 주소에서 부르려면 `worker.js`의 `ORIGINS`에 더하거나, Worker의 **Settings › Variables**에 `ALLOWED_ORIGINS`(쉼표로 나눔)를 넣어요.

## 아직 안 하는 것

- **로그인 계정 지우기, 임시 PIN으로 계정 만들기.** 같은 서비스 계정 키로 할 수 있지만 아직 안 붙였어요. 계정 지우기는 Firebase 콘솔 › Authentication에서 해요.
