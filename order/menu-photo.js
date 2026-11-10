'use strict';
// 메뉴판 사진 읽기 단추: 사진을 고르면 긴 쪽을 줄여 Worker(/ai/menu)로 보내고, 읽은 메뉴를 메뉴 칸 끝에 붙임
// 친목회 만들기 창(카페·식당 메뉴)과 주문판이 같이 써요. Worker가 없으면(WORKER_URL 비어 있음) 단추를 만들지 않음
// 계산은 order-core.js (fitSize · addNames), 부르기는 js/session.js workerCall
const PHOTO_MAX = 6, PHOTO_EDGE = 2000; // 한 번에 읽는 사진 수, 보낼 때 줄이는 긴 쪽(px)

async function shrinkPhoto(file) {
  let img;
  try { img = await createImageBitmap(file); } catch { throw new Error('사진을 열지 못했어요. 다른 사진(JPG·PNG)으로 해 보세요'); }
  const [w, hh] = fitSize(img.width, img.height, PHOTO_EDGE), c = h('canvas');
  c.width = w;
  c.height = hh;
  c.getContext('2d').drawImage(img, 0, 0, w, hh);
  img.close();
  const url = c.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1); // base64만
}

// getText·setText: 메뉴 칸 글을 읽고 바꾸는 함수. 돌려주는 것: 단추와 결과 한 줄이 든 칸 (또는 null)
function menuPhotoButton(getText, setText) {
  if (typeof WORKER_URL === 'undefined' || !WORKER_URL) return null;
  const box = h('div', 'photo-read');
  const input = h('input');
  Object.assign(input, { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const note = h('p', 'hint'); // 읽은 결과·오류 한 줄 (처음엔 숨김)
  note.hidden = true;
  const btn = withIcon(button('메뉴판 사진으로 읽기', () => input.click(), 'btn small'), 'camera');
  input.addEventListener('change', async () => {
    const all = [...input.files], files = all.slice(0, PHOTO_MAX);
    input.value = ''; // 같은 사진을 다시 골라도 되게
    if (!files.length) return;
    if (all.length > PHOTO_MAX) toast(`사진은 한 번에 ${PHOTO_MAX}장까지 읽어요`);
    note.className = 'hint';
    note.hidden = true;
    const label = btn.lastChild, was = label.textContent;
    btn.disabled = true;
    label.textContent = '메뉴판 읽는 중…';
    try {
      const { items } = await workerCall('/ai/menu', { method: 'POST', body: { images: await Promise.all(files.map(shrinkPhoto)) } });
      const before = parseMenu(getText()).length, after = addNames(getText(), items || []);
      setText(after);
      const added = parseMenu(after).length - before;
      note.hidden = false;
      note.textContent = !items?.length ? '메뉴를 찾지 못했어요. 메뉴판이 잘 보이게 다시 찍어 보세요.'
        : added ? `메뉴 ${added}개를 넣었어요. 틀린 이름은 고쳐 주세요.` : '읽은 메뉴가 이미 다 있어요.';
    } catch (e) {
      note.textContent = e.message;
      note.hidden = false;
      note.className = 'hint err';
    } finally {
      btn.disabled = false;
      label.textContent = was;
    }
  });
  box.append(btn, input, note);
  return box;
}
