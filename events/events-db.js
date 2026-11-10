'use strict';
// 친목회 데이터 (Firestore): events/{행사} · events/{행사}/rsvps/{uid}
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules
const ms = t => (t ? t.toMillis() : null);

const eventsDb = {
  // 최근 행사 30개(날짜 늦은 것부터)를 지켜봄. 돌려준 함수로 그만 보기
  async watchEvents(onEvents, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.query(F.collection(db, 'events'), F.orderBy('date', 'desc'), F.limit(30)),
      s => onEvents(s.docs.map(d => ({ id: d.id, ...d.data(), deadline: ms(d.data().deadline) }))), onError);
  },
  async watchRsvps(eid, onRsvps, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.collection(db, 'events', eid, 'rsvps'), s => onRsvps(s.docs.map(d => ({ uid: d.id, ...d.data() }))), onError);
  },
  // 명단 (관리자만 읽을 수 있음): 아직 체크 안 한 분을 셀 때
  async roster() {
    const { F, db } = await fb();
    return (await F.getDocs(F.collection(db, 'roster'))).docs.map(d => ({ email: d.id, ...d.data() }));
  },
  async members() {
    const { F, db } = await fb();
    return (await F.getDocs(F.collection(db, 'members'))).docs.map(d => ({ uid: d.id, ...d.data() }));
  },

  // 만들기(eid 없음)·고치기
  async save(eid, d, uid) {
    const { F, db } = await fb();
    const data = {
      title: d.title.trim(), date: d.date, time: d.time || '', place: d.place.trim(), mapUrl: d.mapUrl.trim(),
      deadline: d.deadline == null ? null : F.Timestamp.fromMillis(d.deadline), note: d.note.trim(), audience: d.audience, meals: d.meals || [],
    };
    if (eid) await F.updateDoc(F.doc(db, 'events', eid), data);
    else await F.addDoc(F.collection(db, 'events'), { ...data, closed: false, at: F.serverTimestamp(), by: uid });
  },
  async setClosed(eid, closed) {
    const { F, db } = await fb();
    await F.updateDoc(F.doc(db, 'events', eid), { closed });
  },
  // 지우기: 응답부터 지우고 행사 (Firestore는 아래 문서를 같이 지워 주지 않음)
  async remove(eid) {
    const { F, db } = await fb();
    const rs = await F.getDocs(F.collection(db, 'events', eid, 'rsvps'));
    const b = F.writeBatch(db);
    rs.docs.forEach(d => b.delete(d.ref));
    b.delete(F.doc(db, 'events', eid));
    await b.commit();
  },

  async rsvp(eid, uid, { status, name, comment, meal = '' }) {
    const { F, db } = await fb();
    await F.setDoc(F.doc(db, 'events', eid, 'rsvps', uid), { status, name, comment: (comment || '').trim().slice(0, 60), meal, at: F.serverTimestamp() });
  },
  async unrsvp(eid, uid) {
    const { F, db } = await fb();
    await F.deleteDoc(F.doc(db, 'events', eid, 'rsvps', uid));
  },
};
