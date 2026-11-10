'use strict';
// 자유 게시판 데이터 (Firestore): posts/{글} · posts/{글}/comments/{댓글}
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules
const boardMs = t => (t ? t.toMillis() : null);
// 막 쓴 글은 서버 시각이 오기 전이라 비어 있어서, 그동안은 이 기기 시각으로 보여 줌
const postOf = d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, at: boardMs(x.at), editedAt: boardMs(x.editedAt) }; };

const boardDb = {
  // 최근 글 n개(새것부터)를 지켜봄. 돌려준 함수로 그만 보기
  async watchPosts(n, onPosts, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.query(F.collection(db, 'posts'), F.orderBy('at', 'desc'), F.limit(n)), s => onPosts(s.docs.map(postOf)), onError);
  },
  async watchPost(id, onPost, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.doc(db, 'posts', id), d => onPost(d.exists() ? postOf(d) : null), onError);
  },
  async watchComments(id, onComments, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.query(F.collection(db, 'posts', id, 'comments'), F.orderBy('at')), s => onComments(s.docs.map(postOf)), onError);
  },
  // 글마다 댓글 수 { id: n }
  async commentCounts(ids) {
    const { F, db } = await fb();
    const ns = await Promise.all(ids.map(id => F.getCountFromServer(F.collection(db, 'posts', id, 'comments')).then(s => s.data().count)));
    return Object.fromEntries(ids.map((id, i) => [id, ns[i]]));
  },
  // 홈: 지난번 본 뒤로 올라온 글 (최대 30개)
  async since(ms) {
    const { F, db } = await fb();
    const q = F.query(F.collection(db, 'posts'), F.where('at', '>', F.Timestamp.fromMillis(ms)), F.orderBy('at', 'desc'), F.limit(30));
    return (await F.getDocs(q)).docs.map(postOf);
  },

  async add({ title, body }, me) {
    const { F, db } = await fb();
    const ref = await F.addDoc(F.collection(db, 'posts'), { title: title.trim(), body: body.trim(), by: me.uid, name: me.name, at: F.serverTimestamp(), editedAt: null });
    return ref.id;
  },
  async edit(id, { title, body }) {
    const { F, db } = await fb();
    await F.updateDoc(F.doc(db, 'posts', id), { title: title.trim(), body: body.trim(), editedAt: F.serverTimestamp() });
  },
  // 지우기: 댓글부터 지우고 글 (Firestore는 아래 문서를 같이 지워 주지 않음)
  async remove(id) {
    const { F, db } = await fb();
    const cs = await F.getDocs(F.collection(db, 'posts', id, 'comments'));
    const b = F.writeBatch(db);
    cs.docs.forEach(d => b.delete(d.ref));
    b.delete(F.doc(db, 'posts', id));
    await b.commit();
  },

  async comment(id, body, me) {
    const { F, db } = await fb();
    await F.addDoc(F.collection(db, 'posts', id, 'comments'), { body: body.trim(), by: me.uid, name: me.name, at: F.serverTimestamp() });
  },
  async uncomment(id, cid) {
    const { F, db } = await fb();
    await F.deleteDoc(F.doc(db, 'posts', id, 'comments', cid));
  },
};
