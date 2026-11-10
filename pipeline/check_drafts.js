// 초안이 교수님이 그대로 저장해도 통과하는 값인지 봐요 (people/people-core.js 의 PROFILE_MAX).
// tests/people.test.js 와 같은 길로 재서, 테스트에서 처음 걸리는 일이 없게 해요.
//
//     node pipeline/check_drafts.js <초안 JSON 경로>
//
// 들어오는 값: { 번호: { base: 이름북 사람, draft: { question, axes, timeline, resources } } }
// 나가는 값: { 번호: "" (괜찮음) 또는 "무엇이 한도를 넘었나" }
const fs = require('node:fs');
const P = require('../tests/load.js')('people/people-core.js');

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const [id, { base, draft }] of Object.entries(input)) {
  try {
    out[id] = P.profileProblem(P.cleanProfile(P.profileForm(null, { ...base, ...draft })));
    // 칸 수는 cleanProfile 이 자르기도 해서(축 3개·발자취 4개) 따로 봐요
    if (!out[id] && (draft.axes || []).length > P.PROFILE_MAX.axes) out[id] = `연구 축이 ${draft.axes.length}개예요`;
    if (!out[id] && (draft.timeline || []).length > P.PROFILE_MAX.timeline) out[id] = `발자취가 ${draft.timeline.length}줄이에요`;
    for (const a of draft.axes || []) {
      if (!out[id] && (a.papers || []).length > P.PROFILE_MAX.papers) out[id] = `'${a.name}' 축에 대표 논문이 ${a.papers.length}편이에요`;
      for (const p of a.papers || []) {
        if (!out[id] && !/^https:\/\//.test(p.url || '')) out[id] = `대표 논문 주소가 https:// 로 시작하지 않아요 (${p.url})`;
      }
    }
  } catch (e) {
    out[id] = `검사 중 오류: ${e.message}`;
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
