'use strict';
// Cloudflare Worker 주소 (worker/README.md 순서대로 배포한 뒤 넣어요). 비어 있으면 Worker가 필요한 기능(메뉴판 사진 읽기 등)은 안 보여요
// 이 주소는 공개돼도 괜찮아요. Worker가 요청마다 로그인 토큰을 확인해요
const WORKER_URL = 'https://knumed-lounge.eh0129s.workers.dev';
