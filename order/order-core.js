'use strict';
// 주문 모으기 계산 (화면 없음): order.js 가 쓰고, tests/order.test.js 가 Node에서 확인
// 장난감 상자(kkonoo/toy_box games/order/order-core.js)에서 가져왔어요. 다른 점: 주문 글 첫 줄에 이모지 대신 판 이름,
// 메뉴판 읽기 프롬프트는 Worker(worker/)가 가짐
// 메뉴 한 줄 = 이름 + 끝에 온도 표시. (아이스/따뜻한)은 둘을 따로, (아이스만)·(따뜻한만)은 그 하나만 셈
// → 개수는 "아이스 이름"·"따뜻한 이름"으로. 표시가 없으면 이름 그대로 한 칸

const MENU_MAX = 80; // 메뉴 줄 수 (사진을 잘못 읽어 너무 길어지지 않게)
const NAME_MAX = 40; // 메뉴 이름 글자 수
const TEMP_MARK = { both: ' (아이스/따뜻한)', ice: ' (아이스만)', hot: ' (따뜻한만)' };
const TEMP_WORD = { ice: '아이스', hot: '따뜻한' };
// 줄 끝의 온도 표시 (괄호는 있어도 없어도): (아이스/따뜻한) · HOT/ICE · 핫/아이스 … / (아이스만) · ICE ONLY · 아이스 전용 … / (따뜻한만) · HOT ONLY …
const TEMP_RE = {
  both: /\s*[([]?\s*(?:(?:아이스|ice)\s*[/·,|]\s*(?:따뜻한|따뜻|핫|hot)|(?:따뜻한|따뜻|핫|hot)\s*[/·,|]\s*(?:아이스|ice))\s*[)\]]?\s*$/i,
  ice: /\s*[([]?\s*(?:(?:아이스|ice)\s*(?:만|only|전용)|only\s*ice)\s*[)\]]?\s*$/i,
  hot: /\s*[([]?\s*(?:(?:따뜻한|따뜻|핫|hot)\s*(?:만|only|전용)|only\s*hot)\s*[)\]]?\s*$/i,
};
// 같은 메뉴가 두 번 나오면 온도를 합침: 아이스만 + 따뜻한만 = 둘 다
const TEMP_BITS = { '': 0, ice: 1, hot: 2, both: 3 }, BITS_TEMP = ['', 'ice', 'hot', 'both'];
const joinTemp = (a, b) => BITS_TEMP[TEMP_BITS[a] | TEMP_BITS[b]];

// 메뉴 한 줄 → { name, temp }: temp는 'both' · 'ice' · 'hot' · ''(나누지 않음)
function readEntry(line) {
  const s = String(line).replace(/\s+/g, ' ').trim(), temp = ['both', 'ice', 'hot'].find(t => TEMP_RE[t].test(s)) || '';
  return { name: (temp ? s.replace(TEMP_RE[temp], '').trim() : s).slice(0, NAME_MAX), temp };
}
const entryLine = ({ name, temp }) => name + (TEMP_MARK[temp] || '');
// 메뉴 한 줄이 세는 칸들: 둘 다면 아이스·따뜻한, 하나만이면 그 하나, 아니면 이름 그대로
const entryKeys = line => {
  const { name, temp } = readEntry(line);
  if (!temp) return [{ key: name, temp: '' }];
  return (temp === 'both' ? ['ice', 'hot'] : [temp]).map(t => ({ key: `${TEMP_WORD[t]} ${name}`, temp: t }));
};

// 적은 글 → 메뉴 줄들: 한 줄에 하나, 앞뒤 빈칸·빈 줄 빼고, 같은 이름은 한 번만(온도는 합침)
// "아메리카노 (아이스/따뜻한)"이 있으면 따로 적은 "아이스 아메리카노"·"따뜻한 아메리카노" 줄은 빼서 같은 칸을 두 번 세지 않게
const parseMenu = text => cleanEntries(String(text).split('\n'));
function cleanEntries(list) {
  const out = [];
  for (const v of list) {
    const e = readEntry(typeof v === 'string' ? v : v.name);
    if (typeof v !== 'string') e.temp = joinTemp(e.temp, Object.hasOwn(TEMP_BITS, v.temp) ? v.temp : '');
    if (!e.name) continue;
    const same = out.find(x => x.name === e.name);
    if (same) same.temp = joinTemp(same.temp, e.temp); else out.push(e);
  }
  const counted = new Set(out.filter(e => e.temp).flatMap(e => entryKeys(entryLine(e)).map(k => k.key)));
  return out.filter(e => e.temp || !counted.has(e.name)).slice(0, MENU_MAX).map(entryLine);
}
// 지금 메뉴 글에 새로 읽은 메뉴 붙이기 (이미 있는 이름은 빼고)
const addNames = (text, entries) => cleanEntries([...parseMenu(text), ...entries]).join('\n');

// 개수 → 바를 정(正) 획 묶음: 12 → [5, 5, 2]
function tallyGroups(n) {
  const out = [];
  for (let left = Math.max(0, Math.floor(n)); left > 0; left -= 5) out.push(Math.min(5, left));
  return out;
}

// 메뉴가 바뀔 때 개수 옮기기: 남은 칸은 개수 그대로, 빠진 칸 중 개수가 있던 것은 dropped로 알려 줌
function keepCounts(counts, menu) {
  const keys = menu.flatMap(line => entryKeys(line).map(k => k.key)), kept = {}, dropped = [];
  for (const [key, n] of Object.entries(counts)) {
    if (!(n > 0)) continue;
    if (keys.includes(key)) kept[key] = n; else dropped.push([key, n]);
  }
  return { counts: kept, dropped };
}
const totalOf = counts => Object.values(counts).reduce((s, n) => s + (n > 0 ? n : 0), 0);
const entryTotal = (line, counts) => entryKeys(line).reduce((s, k) => s + (counts[k.key] || 0), 0);

// 주문판 두 가지: 카페(늘)와 식당(필요할 때)
const BOARDS = { cafe: { label: '카페 주문', unit: '잔', icon: 'coffee' }, meal: { label: '식당 주문', unit: '개', icon: 'utensils' } };

// 카운터에 보여 주거나 단톡방에 붙여 넣을 글 (메뉴 순서, 아이스 먼저, 0개는 빼고)
function orderText(menu, counts, kind = 'cafe') {
  const b = BOARDS[kind] || BOARDS.cafe;
  const lines = menu.flatMap(line => entryKeys(line)).filter(k => counts[k.key] > 0).map(k => `${k.key} ${counts[k.key]}`);
  return [`${b.label} (모두 ${totalOf(counts)}${b.unit})`, ...lines].join('\n');
}

// 사진 줄이기: 긴 쪽을 max 이하로 (작으면 그대로)
function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// ---------- 메뉴판 사진 읽기 (Worker가 Claude에게 묻고 { items: [{ name, temp }] }로 돌려줌) ----------
// Claude 답(JSON 글) → 메뉴 줄들. 모르는 temp는 나누지 않음, 모양이 다른 것은 빼고, 전혀 다르면 빈 목록
function parseMenuReply(text) {
  try {
    const items = JSON.parse(text)?.items;
    if (!Array.isArray(items)) return [];
    return cleanEntries(items.filter(v => typeof v?.name === 'string').map(v => ({ name: v.name, temp: v.temp })));
  } catch { return []; }
}
