'use strict';
// 주문판 데이터 (Firestore): events/{행사}/orders/{판} { menu: [메뉴 줄], counts: { 칸: 개수 }, at } · menus/{판} 지난번 메뉴 { text, at }
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules, 계산은 order-core.js
// ＋/−는 increment로 1씩: 여러 폰에서 동시에 눌러도 개수가 맞게

const orderDb = {
  async event(eid) {
    const { F, db } = await fb();
    const d = await F.getDoc(F.doc(db, 'events', eid));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  },
  // 주문판을 지켜봄 (없으면 null). 돌려준 함수로 그만 보기
  async watch(eid, kind, onBoard, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.doc(db, 'events', eid, 'orders', kind), d => onBoard(d.exists() ? d.data() : null), onError);
  },
  async lastMenu(kind) {
    const { F, db } = await fb();
    const d = await F.getDoc(F.doc(db, 'menus', kind));
    return d.exists() ? d.data().text || '' : '';
  },
  // 메뉴 정하기·고치기: 남는 칸의 개수와 함께 판을 새로 쓰고, 다음 친목회를 위해 지난번 메뉴로도 남김
  async setMenu(eid, kind, menu, counts) {
    const { F, db } = await fb();
    const b = F.writeBatch(db);
    b.set(F.doc(db, 'events', eid, 'orders', kind), { menu, counts, at: F.serverTimestamp() });
    b.set(F.doc(db, 'menus', kind), { text: menu.join('\n'), at: F.serverTimestamp() });
    await b.commit();
  },
  async change(eid, kind, key, d) {
    const { F, db } = await fb();
    await F.updateDoc(F.doc(db, 'events', eid, 'orders', kind), new F.FieldPath('counts', key), F.increment(d), 'at', F.serverTimestamp());
  },
  async clear(eid, kind) {
    const { F, db } = await fb();
    await F.updateDoc(F.doc(db, 'events', eid, 'orders', kind), { counts: {}, at: F.serverTimestamp() });
  },
};
