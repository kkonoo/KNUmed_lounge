'use strict';
// Firebase 연결과 로그인 상태. 로그인이 필요한 화면(친목회·관리자·로그인)이 씀. 공개 화면(연구실 둘러보기)은 안 씀
// 설정은 js/firebase-config.js, 데이터를 지키는 건 firestore.rules, 계산은 js/account-core.js
//   config/admins { uids }          관리자 계정 목록 (누구나 읽음, 관리자만 고침, 마지막 한 분은 못 뺌)
//   config/signup { code }          가입 코드 (관리자만)
//   roster/{메일}                   명단 { name, dept, group, status } (관리자, 그리고 그 메일로 로그인한 본인만 읽음)
//   members/{uid}                   회원 { email, name, dept, group, active, joinCode, at } (회원끼리 읽음)
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.19.0/';
const LOUNGE_ROOT = new URL('..', document.currentScript.src).href; // 사이트 맨 위 (이 파일은 js/ 안)

let fbReady = null;
function fb() {
  fbReady ||= (async () => {
    const [{ getApps, initializeApp }, A, F] = await Promise.all(['app', 'auth', 'firestore'].map(n => import(`${FIREBASE}firebase-${n}.js`)));
    const app = getApps()[0] || initializeApp(firebaseConfig);
    const auth = A.getAuth(app); // 로그인은 이 기기에 남음 (브라우저를 닫아도 유지)
    await auth.authStateReady();
    return { A, F, auth, db: F.getFirestore(app) };
  })().catch(e => { fbReady = null; throw e; }); // 실패하면 다음에 처음부터 다시
  return fbReady;
}

// 지금 로그인 상태: { user, member, isAdmin, adminUids }
//   user 없음 = 로그인 안 함 · member 없음 = 로그인은 됐는데 가입(가입 코드)을 안 마침 · member.active false = 비활성화됨
async function session() {
  const { F, auth, db } = await fb();
  const user = auth.currentUser;
  const adminSnap = await F.getDoc(F.doc(db, 'config', 'admins'));
  const adminUids = adminSnap.exists() ? adminSnap.data().uids || [] : [];
  if (!user) return { user: null, member: null, isAdmin: false, adminUids, setupNeeded: !adminSnap.exists() };
  const m = await F.getDoc(F.doc(db, 'members', user.uid));
  return {
    user,
    member: m.exists() ? { uid: user.uid, ...m.data() } : null,
    isAdmin: adminUids.includes(user.uid),
    adminUids,
    setupNeeded: !adminSnap.exists(),
  };
}
const isActiveMember = s => !!(s.member && s.member.active);

// 로그인이 필요한 화면: 안 됐으면 로그인 화면으로 (다 되면 이 화면으로 돌아옴)
function goLogin() {
  location.href = `${LOUNGE_ROOT}login/?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}

const account = {
  async signIn(email, pin) {
    const { A, auth } = await fb();
    await A.signInWithEmailAndPassword(auth, normEmail(email), pinToPassword(pin));
    return session();
  },

  // 처음 가입: 계정 만들기 → 명단 확인 → 가입 코드와 함께 회원 문서 쓰기 (코드는 firestore.rules가 확인)
  // 코드를 틀려도 계정(메일+PIN)은 남아서, 같은 PIN으로 다시 하면 이어서 됨
  async signUp(email, code, pin) {
    const { A, F, auth, db } = await fb();
    email = normEmail(email);
    const pw = pinToPassword(pin);
    try {
      await A.createUserWithEmailAndPassword(auth, email, pw);
    } catch (e) {
      if (!/email-already-in-use/.test(e.code)) throw e;
      try { await A.signInWithEmailAndPassword(auth, email, pw); } catch (e2) {
        if (/too-many-requests|network/.test(e2.code)) throw e2;
        throw new Error('이 메일로 이미 PIN을 정하셨어요. 로그인 칸에서 그 PIN으로 들어오세요. 잊으셨으면 관리자에게 초기화를 부탁해 주세요');
      }
    }
    return account.join(code);
  },

  // 가입 마치기 (로그인은 된 상태): 명단 확인 → 가입 코드와 함께 회원 문서 쓰기
  async join(code) {
    const { A, F, auth, db } = await fb();
    const uid = auth.currentUser.uid, email = normEmail(auth.currentUser.email);
    if ((await F.getDoc(F.doc(db, 'members', uid))).exists()) return session(); // 이미 가입을 마친 분

    const r = await F.getDoc(F.doc(db, 'roster', email));
    if (!r.exists()) { await A.signOut(auth); throw new Error('명단에 없는 메일이에요. 친목회 공지를 받는 메일 주소로 해 주세요'); }
    const ro = r.data();
    if (ro.status !== 'active') { await A.signOut(auth); throw new Error('사용이 멈춘 계정이에요. 관리자에게 알려 주세요'); }
    try {
      await F.setDoc(F.doc(db, 'members', uid), {
        email, name: ro.name, dept: ro.dept, group: ro.group, active: true, joinCode: normCode(code), at: F.serverTimestamp(),
      });
    } catch (e) { // 로그인은 그대로 두고 코드만 다시 받음
      if (/permission/.test(e.code)) throw new Error('가입 코드가 맞지 않아요. 친목회 공지 메일의 코드를 확인해 주세요');
      throw e;
    }
    return session();
  },

  async signOut() {
    const { A, auth } = await fb();
    await A.signOut(auth);
  },

  // PIN 바꾸기: 지금 PIN으로 한 번 더 확인하고 바꿈
  async changePin(oldPin, newPin) {
    const { A, auth } = await fb();
    const user = auth.currentUser;
    await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, pinToPassword(oldPin)));
    await A.updatePassword(user, pinToPassword(newPin));
  },
};

// 머리 줄 끝 계정 단추(#accountBtn): 로그인 전엔 '로그인', 뒤엔 이름 첫 글자 동그라미. 누르면 로그인 화면(= 내 계정)
function accountButton(s) {
  const a = h('a', s.member ? 'avatar' : 'btn small');
  a.id = 'accountBtn';
  a.href = `${LOUNGE_ROOT}login/${s.user ? '' : `?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`}`;
  a.textContent = s.member ? s.member.name.slice(0, 1) : s.user ? '가입 마치기' : '로그인';
  a.title = s.member ? `${s.member.name} 교수님 · 내 계정` : a.textContent;
  return a;
}
// 그 옆 '내 프로필': 대문과 연구실 둘러보기에서만 (mountAccountChip(s, { myProfile: true })), 가입을 마친 교수님만
function myProfileButton() {
  const a = h('a', 'btn small my-profile');
  a.id = 'myProfileBtn';
  a.href = `${LOUNGE_ROOT}people/me/`;
  a.title = '내 프로필';
  a.setAttribute('aria-label', '내 프로필');
  a.append(icon('user'), h('span', '', '내 프로필'));
  return a;
}
function mountAccountChip(s, { myProfile = false } = {}) {
  const head = document.querySelector('.topbar');
  if (!head) return;
  let end = head.querySelector('.head-end');
  if (!end) { end = h('span', 'head-end'); head.append(end); }
  end.querySelector('#accountBtn')?.remove();
  end.querySelector('#myProfileBtn')?.remove();
  end.prepend(accountButton(s));
  if (myProfile && isActiveMember(s)) end.prepend(myProfileButton());
}
