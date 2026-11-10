'use strict';
// 연구실 둘러보기 프로필 데이터 (Firestore): profiles/{번호} · profiles/{번호}/private/info
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules, 계산은 people-core.js
const profileMs = t => (t ? t.toMillis() : null);
const profileOf = d => { const x = d.data(); return { id: d.id, ...x, confirmedAt: profileMs(x.confirmedAt) }; };

const profileDb = {
  // 모든 프로필 (누구나 읽음)
  async all() {
    const { F, db } = await fb();
    return (await F.getDocs(F.collection(db, 'profiles'))).docs.map(profileOf);
  },
  // 내 명단 줄에 이어진 프로필 번호 (없으면 '')
  async myId(email) {
    const { F, db } = await fb();
    const r = await F.getDoc(F.doc(db, 'roster', normEmail(email)));
    return r.exists() ? r.data().profile || '' : '';
  },
  async get(pid) {
    const { F, db } = await fb();
    const d = await F.getDoc(F.doc(db, 'profiles', pid));
    return d.exists() ? profileOf(d) : null;
  },
  // 로그인 칸: 찾는 것·요즘 한 줄·연락처 (로그인한 교수님만 읽음)
  async private(pid) {
    const { F, db } = await fb();
    const d = await F.getDoc(F.doc(db, 'profiles', pid, 'private', 'info'));
    return d.exists() ? d.data() : null;
  },
  // 저장 = 본인 확인: 공개 칸과 로그인 칸을 한 번에
  async save(pid, pub, priv, uid) {
    const { F, db } = await fb();
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'profiles', pid), { ...pub, confirmedAt: F.serverTimestamp(), by: uid });
    b.set(F.doc(db, 'profiles', pid, 'private', 'info'), { ...priv, at: F.serverTimestamp() });
    await b.commit();
  },
};
