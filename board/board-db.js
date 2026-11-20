'use strict';
// 자유 게시판 데이터 (Firestore): posts/{글} · posts/{글}/comments/{댓글} · posts/{글}/photos/{사진} { src: 줄인 사진의 data: 주소 }
//   글에는 사진 번호 목록(photos)만 둬서 목록을 볼 때는 사진을 안 받고, 글을 열 때만 받아요
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules
const boardMs = t => (t ? t.toMillis() : null);
// 막 쓴 글은 서버 시각이 오기 전이라 비어 있어서, 그동안은 이 기기 시각으로 보여 줌
const postOf = d => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, at: boardMs(x.at), editedAt: boardMs(x.editedAt) }; };
const photoCache = new Map(); // 사진 번호 → data: 주소. 이 화면에서 한 번 받은 사진은 다시 안 받음

const boardDb = {
  // 최근 글 n개(새것부터)를 지켜봄. cat을 주면 그 말머리 글만. 돌려준 함수로 그만 보기
  //   말머리로 거르기는 Firestore 복합 색인(posts: cat 오름차순 + at 내림차순)이 있어야 돼요 (README '처음 쓸 때')
  async watchPosts(n, cat, onPosts, onError) {
    const { F, db } = await fb();
    const by = cat ? [F.where('cat', '==', cat)] : [];
    return F.onSnapshot(F.query(F.collection(db, 'posts'), ...by, F.orderBy('at', 'desc'), F.limit(n)), s => onPosts(s.docs.map(postOf)), onError);
  },
  // 공지 (많지 않아서 순서는 화면이 새것부터로)
  async watchPinned(onPosts, onError) {
    const { F, db } = await fb();
    return F.onSnapshot(F.query(F.collection(db, 'posts'), F.where('pinned', '==', true)),
      s => onPosts(s.docs.map(postOf).sort((a, b) => (b.at || 0) - (a.at || 0))), onError);
  },
  // 글 수 (페이지 번호용). cat을 주면 그 말머리 글만
  async count(cat) {
    const { F, db } = await fb();
    const col = F.collection(db, 'posts');
    return (await F.getCountFromServer(cat ? F.query(col, F.where('cat', '==', cat)) : col)).data().count;
  },
  async setPinned(id, pinned) {
    const { F, db } = await fb();
    await F.updateDoc(F.doc(db, 'posts', id), { pinned });
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

  // photos: 올릴 사진 [data: 주소]. 글과 사진을 한 번에 (사진 문서마다 번호를 새로 받아 글의 photos에 차례대로)
  async add({ title, body, cat }, me, pinned = false, photos = []) {
    const { F, db } = await fb();
    const ref = F.doc(F.collection(db, 'posts')), b = F.writeBatch(db);
    const ids = photos.map(src => { const p = F.doc(F.collection(db, 'posts', ref.id, 'photos')); b.set(p, { src }); photoCache.set(p.id, src); return p.id; });
    // 공지·사진이 있을 때만 칸을 씀 (예전 규칙에서도 보통 글은 올라가게)
    b.set(ref, { title: title.trim(), body: body.trim(), cat, by: me.uid, name: me.name, at: F.serverTimestamp(), editedAt: null, ...(pinned ? { pinned: true } : {}), ...(ids.length ? { photos: ids } : {}) });
    await b.commit();
    return ref.id;
  },
  // photos: 사진을 바꿨을 때만 [{ id } 있던 사진 | { src } 새 사진] (보이는 순서), drop: 뺀 사진 번호
  async edit(id, { title, body, cat }, photos = null, drop = []) {
    const { F, db } = await fb();
    const b = F.writeBatch(db), data = { title: title.trim(), body: body.trim(), cat, editedAt: F.serverTimestamp() };
    if (photos) {
      data.photos = photos.map(x => {
        if (x.id) return x.id;
        const p = F.doc(F.collection(db, 'posts', id, 'photos'));
        b.set(p, { src: x.src });
        photoCache.set(p.id, x.src);
        return p.id;
      });
      for (const x of drop) b.delete(F.doc(db, 'posts', id, 'photos', x));
    }
    b.update(F.doc(db, 'posts', id), data);
    await b.commit();
  },
  // 지우기: 댓글·사진부터 지우고 글 (Firestore는 아래 문서를 같이 지워 주지 않음). 사진은 글의 번호 목록으로 (사진을 받지 않고)
  async remove(id, photos = []) {
    const { F, db } = await fb();
    const cs = await F.getDocs(F.collection(db, 'posts', id, 'comments'));
    const b = F.writeBatch(db);
    cs.docs.forEach(d => b.delete(d.ref));
    for (const x of photos) b.delete(F.doc(db, 'posts', id, 'photos', x));
    b.delete(F.doc(db, 'posts', id));
    await b.commit();
  },
  // 글의 사진 [data: 주소] (ids 순서, 없는 사진은 ''). 받은 것은 기억해 둠
  async photos(pid, ids) {
    const { F, db } = await fb();
    return Promise.all(ids.map(async x => {
      if (!photoCache.has(x)) {
        const d = await F.getDoc(F.doc(db, 'posts', pid, 'photos', x));
        if (!d.exists()) return '';
        photoCache.set(x, d.data().src);
      }
      return photoCache.get(x);
    }));
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
