'use strict';
// 관리자 데이터 (Firestore): 처음 설정 · 명단 · 회원 · 관리자 · 가입 코드 · 작업 기록
// 연결은 js/session.js의 fb(), 누가 무엇을 할 수 있는지는 firestore.rules
// 계정 자체(로그인 정보)를 지우거나 남의 PIN을 바꾸는 건 브라우저에선 못 해요 → Worker 연결 전까지는 Firebase 콘솔 › Authentication

let me = { uid: '', name: '' }; // 작업 기록에 남길 나
const millis = t => (t ? t.toMillis() : 0);

const adminDb = {
  setMe(uid, name) { me = { uid, name: name || '' }; },

  async log(action, target = '') {
    const { F, db } = await fb();
    await F.addDoc(F.collection(db, 'adminLog'), { at: F.serverTimestamp(), by: me.uid, byName: me.name.slice(0, 20), action, target: String(target).slice(0, 200) });
  },

  // 처음 설정 (관리자가 아직 아무도 없을 때 한 번): 내 계정 → 관리자 목록 → 가입 코드 → 명단·회원에 나
  async setup({ name, dept, email, pin, code }) {
    const { A, F, auth, db } = await fb();
    email = normEmail(email);
    try { await A.createUserWithEmailAndPassword(auth, email, pinToPassword(pin)); } catch (e) {
      if (!/email-already-in-use/.test(e.code)) throw e;
      await A.signInWithEmailAndPassword(auth, email, pinToPassword(pin));
    }
    const uid = auth.currentUser.uid;
    await F.setDoc(F.doc(db, 'config', 'admins'), { uids: [uid] });
    const b = F.writeBatch(db), now = F.serverTimestamp();
    b.set(F.doc(db, 'config', 'signup'), { code: normCode(code) });
    b.set(F.doc(db, 'roster', email), { name, dept, group: '기초', status: 'active', at: now });
    b.set(F.doc(db, 'members', uid), { email, name, dept, group: '기초', active: true, at: now });
    await b.commit();
    this.setMe(uid, name);
    await this.log('처음 설정', email);
  },

  // 한꺼번에 읽기: 명단 · 회원 · 관리자 · 가입 코드
  async loadAll() {
    const { F, db } = await fb();
    const [r, m, a, c] = await Promise.all([
      F.getDocs(F.collection(db, 'roster')),
      F.getDocs(F.collection(db, 'members')),
      F.getDoc(F.doc(db, 'config', 'admins')),
      F.getDoc(F.doc(db, 'config', 'signup')),
    ]);
    return {
      roster: r.docs.map(d => ({ email: d.id, ...d.data() })),
      members: m.docs.map(d => ({ uid: d.id, ...d.data(), at: millis(d.data().at) })),
      admins: a.exists() ? a.data().uids || [] : [],
      code: c.exists() ? c.data().code : '',
    };
  },

  // 명단에 넣기: 새 분은 그대로, 이미 있는 분은 이름·교실만 고침(교실이 비어 있으면 그대로). 500개씩 나눠 씀
  async addRoster(rows, group, existing) {
    const { F, db } = await fb();
    const have = new Map(existing.map(r => [r.email, r]));
    let added = 0, changed = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const b = F.writeBatch(db);
      for (const row of rows.slice(i, i + 400)) {
        const old = have.get(row.email);
        if (old) {
          const next = { name: row.name, dept: row.dept || old.dept };
          if (next.name === old.name && next.dept === old.dept) continue;
          b.update(F.doc(db, 'roster', row.email), { ...next, at: F.serverTimestamp() });
          changed++;
        } else {
          b.set(F.doc(db, 'roster', row.email), { name: row.name, dept: row.dept || '', group, status: 'active', at: F.serverTimestamp() });
          added++;
        }
      }
      await b.commit();
    }
    if (added || changed) await this.log('명단 넣기', `새로 ${added}명, 고침 ${changed}명`);
    return { added, changed };
  },

  // 이름·교실·구분 고치기: 명단과, 그 메일로 가입한 회원 문서를 같이
  async editRoster(email, patch, mems) {
    const { F, db } = await fb();
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'roster', email), { ...patch, at: F.serverTimestamp() });
    for (const m of mems) b.update(F.doc(db, 'members', m.uid), patch);
    await b.commit();
    await this.log('명단 고침', `${patch.name} (${email})`);
  },

  // 멈추기·다시 쓰기: 명단 상태와 회원 활성을 같이. 멈추면 그 순간부터 로그인해도 아무것도 못 봄
  async setActive(email, active, mems, name) {
    const { F, db } = await fb();
    const b = F.writeBatch(db);
    b.update(F.doc(db, 'roster', email), { status: active ? 'active' : 'inactive', at: F.serverTimestamp() });
    for (const m of mems) b.update(F.doc(db, 'members', m.uid), { active });
    await b.commit();
    await this.log(active ? '다시 쓰기' : '멈추기', `${name} (${email})`);
  },

  // 명단에서 지우기: 명단과 회원 문서. (로그인 계정은 Firebase 콘솔에서 따로 지워야 다시 가입할 때 새 PIN을 정할 수 있음)
  async removeRoster(email, mems, name) {
    const { F, db } = await fb();
    const b = F.writeBatch(db);
    b.delete(F.doc(db, 'roster', email));
    for (const m of mems) b.delete(F.doc(db, 'members', m.uid));
    await b.commit();
    await this.log('명단에서 지움', `${name} (${email})`);
  },

  // 같은 메일의 예전 회원 문서 지우기 (로그인 계정을 지우고 다시 가입하면 생김)
  async removeMember(uid, label) {
    const { F, db } = await fb();
    await F.deleteDoc(F.doc(db, 'members', uid));
    await this.log('예전 계정 정리', label);
  },

  async setAdmins(uids, action, target) {
    const { F, db } = await fb();
    await F.setDoc(F.doc(db, 'config', 'admins'), { uids });
    await this.log(action, target);
  },

  async setCode(code) {
    const { F, db } = await fb();
    await F.setDoc(F.doc(db, 'config', 'signup'), { code: normCode(code) });
    await this.log('가입 코드 바꿈');
  },

  async logs(n = 60) {
    const { F, db } = await fb();
    const s = await F.getDocs(F.query(F.collection(db, 'adminLog'), F.orderBy('at', 'desc'), F.limit(n)));
    return s.docs.map(d => ({ ...d.data(), at: millis(d.data().at) }));
  },
};
