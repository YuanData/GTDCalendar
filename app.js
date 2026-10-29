(function () {
'use strict';

const DEFAULT_DATA = 'gtd-data.js';   // 與 index.html 同一個資料夾
// 線上 DEMO（GitHub Pages）：讀 demo-data.js 的範例，不連結、不寫任何檔案。本機測試可加 ?demo=1
const DEMO = /\.github\.io$/.test(location.hostname) || new URLSearchParams(location.search).get('demo') === '1';
const LANE_H = 26;
const WD = ['一', '二', '三', '四', '五', '六', '日'];
// 色盤排成三列：[色名, 中文名, 色碼]；null 代表「無色」按鈕
const PALETTE_ROWS = [
  [['mint', '薄荷', '#D2ECD9'], ['teal', '青', '#CDEBEC'], ['sky', '天藍', '#CEE4F9'], ['lavender', '薰衣草', '#E4D7F8']],
  [['yellow', '淡黃', '#F5F0C1'], ['amber', '琥珀', '#FAE6C6'], ['coral', '珊瑚', '#F9D5D3'], ['pink', '粉紅', '#F8D3E3']],
  [['gray', '灰', '#E3E3E1'], ['brown', '深咖啡', '#C4A898'], ['dgray', '深灰', '#BDBDB9'], null],
];
const COLOR_HEX = {};
PALETTE_ROWS.forEach(r => r.forEach(c => { if (c) COLOR_HEX[c[0]] = c[2]; }));
const NEW_CYCLE = ['mint', 'teal', 'sky', 'lavender'];   // 新增事項依序套用的預設色
const SPAN_DEFAULT = 'mint';

function tint(hex, t) {   // 與白色混合，t 越大越接近白色
  const n = parseInt(hex.slice(1), 16);
  const m = v => Math.round(v + (255 - v) * t);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => m(v).toString(16).padStart(2, '0')).join('');
}
// 事項顯示色：已過期或已勾選時換成更淺的變化色
function shownColor(it, todayStr, fallback) {
  const name = it.color || fallback;
  if (!name) return null;
  const hex = COLOR_HEX[name];
  const faded = it.done || (it.end || it.date) < todayStr;
  return faded ? tint(hex, 0.65) : hex;
}

const HEADER =
  '// GTD 資料檔（可直接手改，存檔時程式會自動整理排版）\n' +
  '// 欄位：date 起始日 YYYY-MM-DD；done 是否完成；text 事項；end 結束日（有才是跨日事項）；color 色名（可省略）；strikeout 為 true 才有，文字畫刪除線\n' +
  '// color 可用：mint teal sky lavender yellow amber coral pink gray brown dgray；已過期或已勾選的事項會自動顯示成較淺的顏色\n' +
  '// weeks 為顯示週數（3~8）；items 依 date 倒序，同一天內由上而下就是畫面順序\n';

// ---------- 日期工具 ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const diffDays = (a, b) => Math.round((a - b) / 864e5);
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
const cmp = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const DEFAULT_WEEKS = 7;
const clampWeeks = w => { w = Math.round(Number(w)); return isNaN(w) ? DEFAULT_WEEKS : Math.min(8, Math.max(3, w)); };
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// ---------- 狀態 ----------
let data = { weeks: DEFAULT_WEEKS, items: [] };
let persistedWeeks = DEFAULT_WEEKS;   // 已寫進檔案的週數；滑桿改了還沒按存檔鈕時，和 data.weeks 不同
let viewStart = mondayOf(new Date());
let seq = 0;
let link = 'none';          // none | ok | needperm | unsupported | mismatch | demo
let handle = null;
let statusText = '', statusBad = false;
let adding = null;          // 正在新增事項的日期
let drag = null;
let palTarget = null;
// 加密狀態：off 明文｜on 加密中（記憶體是明文）｜locked 尚未解鎖（事項顯示 🔒）｜preview naisho.js 沒有密鑰，用輸入的密鑰唯讀試解
let crypt = { mode: 'off', key: null };
const PREFIX = Cipher.PREFIX;
const isLocked = () => crypt.mode === 'locked' || crypt.mode === 'preview';

const $ = id => document.getElementById(id);
const byId = id => data.items.find(x => x._id === id);

function h(tag, props, kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'text') e.textContent = props[k];
    else if (k === 'style') e.style.cssText = props[k];
    else e.setAttribute(k, props[k]);
  }
  (kids || []).forEach(c => e.appendChild(c));
  return e;
}

// ---------- 資料載入／格式化 ----------
function load(raw) {
  const out = { weeks: DEFAULT_WEEKS, items: [] };
  if (raw && typeof raw === 'object') {
    out.weeks = clampWeeks(raw.weeks);
    (Array.isArray(raw.items) ? raw.items : []).forEach(it => {
      if (!it || typeof it.text !== 'string' || !validDate(it.date)) return;
      const o = { _id: ++seq, date: it.date, text: it.text, done: it.done === true };
      if (validDate(it.end) && it.end > it.date) o.end = it.end;
      const cn = typeof it.color === 'string' ? it.color.replace(/-dark$/, '') : '';   // 舊版深色名稱併回主色
      if (COLOR_HEX[cn]) o.color = cn;
      if (it.strikeout === true) o.strikeout = true;
      out.items.push(o);
    });
  }
  out.items.sort(cmp);
  return out;
}

function serialize(d = data) {
  const weeks = d === data ? persistedWeeks : d.weeks;   // 週數要按存檔鈕才寫入
  const encOn = d === data && crypt.mode === 'on';        // 只有目前資料在加密開啟時才加密；其餘原樣輸出，避免二次加密
  d.items.sort(cmp);
  const J = JSON.stringify;
  const lines = d.items.map(it => {
    const p = ['"date": ' + J(it.date), '"done": ' + (it.done ? 'true' : 'false'), '"text": ' + J(encOn ? Cipher.encrypt(it.text, crypt.key) : it.text)];
    if (it.end) p.push('"end": ' + J(it.end));
    if (it.color) p.push('"color": ' + J(it.color));
    if (it.strikeout) p.push('"strikeout": true');
    return '    {' + p.join(', ') + '}';
  });
  return HEADER + 'window.GTD_DATA = {\n  "weeks": ' + weeks + ',\n  "items": [\n' +
    lines.join(',\n') + (lines.length ? '\n' : '') + '  ]\n};\n';
}

function parseFileText(text) {
  const i = text.indexOf('window.GTD_DATA');
  if (i < 0) throw new Error('找不到 window.GTD_DATA');
  const a = text.indexOf('{', i), b = text.lastIndexOf('}');
  return JSON.parse(text.slice(a, b + 1));
}

// ---------- 存檔 ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gtd', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}

let saveTimer = null;
function save() {
  if (isLocked()) { statusText = '已鎖定，未存檔'; statusBad = true; renderStatus(); return; }
  if (link === 'demo') { statusText = 'DEMO：改動不會儲存'; statusBad = false; renderStatus(); return; }
  statusText = link === 'ok' ? '儲存中…' : '未存檔'; statusBad = link !== 'ok';
  renderStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 150);
}
async function doSave() {
  if (link !== 'ok' || !handle || isLocked()) { renderStatus(); return; }
  try {
    const w = await handle.createWritable();
    await w.write(serialize());
    await w.close();
    const n = new Date();
    statusText = '已存檔 ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
    statusBad = false;
  } catch (err) {
    console.error(err);
    statusText = '存檔失敗：' + err.message; statusBad = true;
    link = 'needperm'; renderBanner();
  }
  renderStatus();
}

const FILE_TYPES = [{ description: 'GTD 資料檔 (.js)', accept: { 'text/javascript': ['.js'] } }];

async function pickExisting() {
  try {
    const [fh] = await showOpenFilePicker({ id: 'gtd', types: FILE_TYPES });
    if (await fh.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
    const text = await (await fh.getFile()).text();
    data = load(parseFileText(text)); persistedWeeks = data.weeks; clearHistory(); detectCrypt();
    handle = fh; link = 'ok';
    await idbSet('handle', fh).catch(() => {});
    statusText = '已連結 ' + fh.name; statusBad = false;
    renderAll();
    if (crypt.mode === 'locked') { await askUnlock(); renderAll(); }
  } catch (err) { if (err.name !== 'AbortError') { alert('讀取失敗：' + err.message); } }
}
async function createNew() {
  try {
    const fh = await showSaveFilePicker({ suggestedName: 'gtd-data.js', id: 'gtd', types: FILE_TYPES });
    handle = fh; link = 'ok';
    await idbSet('handle', fh).catch(() => {});
    await doSave();
    renderAll();
  } catch (err) { if (err.name !== 'AbortError') { alert('建立失敗：' + err.message); } }
}
async function regrant() {
  try {
    if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
      link = 'ok'; await verifyHandle();
      if (link === 'ok') await doSave();
      renderAll();
    }
  } catch (err) { alert('授權失敗：' + err.message); }
}
function downloadFile() {
  const a = h('a', { href: URL.createObjectURL(new Blob([serialize()], { type: 'text/javascript' })), download: 'gtd-data.js' });
  document.body.appendChild(a); a.click(); a.remove();
}

async function initLink() {
  if (!('showOpenFilePicker' in window)) { link = 'unsupported'; return; }
  try {
    handle = await idbGet('handle');
    if (handle) {
      link = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'needperm';
      if (link === 'ok') { await verifyHandle(); }
    }
  } catch (err) { handle = null; link = 'none'; }
}
// 寫入前先確認連結的檔案內容和 index.html 載入的是同一份；不同就暫停存檔，避免寫到別處（例如舊的 Downloads 檔）
async function verifyHandle() {
  try {
    const text = await (await handle.getFile()).text();
    if (serialize(load(parseFileText(text))) === serialize()) statusText = '已連結 ' + handle.name;
    else { link = 'mismatch'; statusText = '存檔已暫停'; statusBad = true; }
  } catch (err) { handle = null; link = 'none'; }   // 檔案已不存在或無法讀取
}

// ---------- 加密（防君子不防小人；key 存在 naisho.js 的 NAISHO）----------
const NAISHO_HEADER = '// 加密密鑰（由程式自動寫入，請勿外流；已列入 .gitignore）\n';
const naishoValue = () => (typeof window.NAISHO === 'string' ? window.NAISHO : '');
let naishoHandle = null;

// 跳出輸入密鑰的對話框。opts: { title, hint, confirm, validate(pass) -> 錯誤訊息或 null }；回傳密鑰，取消則回傳 null
function promptKey(opts) {
  return new Promise(resolve => {
    const dlg = $('kdlg'), form = $('kForm');
    $('kTitle').textContent = opts.title; $('kHint').textContent = opts.hint || '';
    $('kPass').value = ''; $('kPass2').value = '';
    $('kConfirmRow').hidden = !opts.confirm; $('kErr').hidden = true;
    let finished = false;
    const finish = v => {   // 只結算一次；不依賴 close 事件（部分環境不會觸發）
      if (finished) return;
      finished = true;
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onCancel); dlg.removeEventListener('cancel', onCancel);
      resolve(v);
    };
    const onCancel = () => finish(null);
    const onSubmit = e => {
      if (!e.submitter || e.submitter.value !== 'ok') { finish(null); return; }   // 「取消」按鈕
      const p = $('kPass').value;
      let err = null;
      if (!p) err = '請輸入密鑰。';
      else if (opts.confirm && p !== $('kPass2').value) err = '兩次輸入的密鑰不一樣。';
      else if (opts.validate) err = opts.validate(p);
      if (err) { e.preventDefault(); $('kErr').textContent = err; $('kErr').hidden = false; return; }
      finish(p);
    };
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onCancel); dlg.addEventListener('cancel', onCancel);
    dlg.showModal(); $('kPass').focus();
  });
}

// 載入後判斷要不要解鎖：資料裡有密文，或 naisho.js 有密鑰
function detectCrypt() {
  const hasEnc = data.items.some(it => Cipher.isCipher(it.text));
  crypt = { mode: (hasEnc || naishoValue()) ? 'locked' : 'off', key: null };
}
function applyKey(key) {
  data.items.forEach(it => { if (Cipher.isCipher(it.text)) it.text = Cipher.decrypt(it.text, key); });
  crypt = { mode: 'on', key };
  clearHistory();
}
async function askUnlock() {
  const naisho = naishoValue();
  const pass = await promptKey({
    title: '輸入密鑰',
    hint: naisho ? '' : '找不到 naisho.js 的密鑰，無法驗證。輸入後會先唯讀預覽解密結果，確認內容正確再重建。',
    validate: p => (naisho && Cipher.deriveKey(p) !== naisho ? '密鑰不對。' : null),
  });
  if (pass === null) return false;      // 取消：維持鎖定
  const key = Cipher.deriveKey(pass);
  if (naisho) applyKey(key); else crypt = { mode: 'preview', key };
  return true;
}
async function retryUnlock() { if (await askUnlock()) renderAll(); }
async function confirmPreview() {       // 預覽內容正確：用這組密鑰重建 naisho.js
  if (!(await writeNaisho(crypt.key))) return;
  applyKey(crypt.key);
  renderAll();
}

async function writeNaisho(value) {
  try {
    if (!naishoHandle) naishoHandle = await idbGet('naisho').catch(() => null);
    if (naishoHandle) {
      try { await naishoHandle.getFile(); } catch (err) { naishoHandle = null; }   // 檔案已不存在：不沿用舊的控制代碼
    }
    if (naishoHandle && await naishoHandle.queryPermission({ mode: 'readwrite' }) !== 'granted'
        && await naishoHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') naishoHandle = null;
    if (!naishoHandle) {
      naishoHandle = await showSaveFilePicker({ suggestedName: 'naisho.js', id: 'gtd', types: FILE_TYPES });
      await idbSet('naisho', naishoHandle).catch(() => {});
    }
    const w = await naishoHandle.createWritable();
    await w.write(NAISHO_HEADER + 'var NAISHO = ' + JSON.stringify(value) + ';\n');
    await w.close();
    window.NAISHO = value;
    return true;
  } catch (err) {
    toast(err.name === 'AbortError' ? '已取消，未更動' : 'naisho.js 寫入失敗：' + err.message);
    return false;
  }
}

async function enableEncryption() {
  if (link !== 'ok') { toast('請先連結資料檔，再開啟加密'); return false; }
  const pass = await promptKey({ title: '開啟加密：設定密鑰', confirm: true, hint: '密鑰可以很短，但請牢記；忘記密鑰就無法還原事項文字。' });
  if (pass === null) return false;
  const key = Cipher.deriveKey(pass);
  if (!(await writeNaisho(key))) return false;
  crypt = { mode: 'on', key };
  clearHistory();
  await doSave();                       // 立刻把密文寫進資料檔
  return true;
}
async function disableEncryption() {
  if (link !== 'ok') { toast('請先連結資料檔，再關閉加密'); return false; }
  const key = crypt.key;
  const pass = await promptKey({
    title: '關閉加密：輸入密鑰確認', hint: '確認後事項文字會還原成明文，並清除 naisho.js 裡的密鑰。',
    validate: p => (Cipher.deriveKey(p) !== key ? '密鑰不對。' : null),
  });
  if (pass === null) return false;
  crypt = { mode: 'off', key: null };
  await doSave();                       // 先把明文寫進資料檔
  if (link !== 'ok') { crypt = { mode: 'on', key }; toast('資料檔寫入失敗，加密維持開啟'); return false; }
  clearHistory();
  if (!(await writeNaisho(''))) toast('已還原成明文，但 naisho.js 的密鑰沒有清除');
  return true;
}
function renderCryptUI() {
  const t = $('encToggle');
  t.checked = crypt.mode !== 'off';
  t.disabled = isLocked();
  t.closest('label').hidden = DEMO;   // DEMO 不提供加密
  document.body.classList.toggle('locked', isLocked());
}
// 加密關閉時，「enc:」開頭保留給密文使用，避免下次載入被誤判成密文
const reservedText = t => crypt.mode === 'off' && t.startsWith(PREFIX);

// ---------- 資料操作 ----------
function lastIndexOfDate(date) {
  let last = -1;
  data.items.forEach((x, i) => { if (x.date === date) last = i; });
  return last;
}
function insertAtDayEnd(it) {
  const last = lastIndexOfDate(it.date);
  if (last >= 0) data.items.splice(last + 1, 0, it); else data.items.push(it);
}
function commit() { data.items.sort(cmp); save(); render(); }

// ---------- 復原／重做（整份 items 快照；只在記憶體，重新整理就清空）----------
const HISTORY_MAX = 100;
let undoStack = [], redoStack = [];     // 元素 { snap, label }
const snapshot = () => JSON.stringify(data.items);
const shortText = t => (t.length > 12 ? t.slice(0, 12) + '…' : t);
// 執行一個會改資料的動作；結果真的有變才記一步（一個動作一步）
function mutate(label, fn) {
  if (isLocked()) return;   // 鎖定／唯讀預覽時不改資料
  const snap = snapshot();
  fn();
  data.items.sort(cmp);
  if (snapshot() === snap) return;
  undoStack.push({ snap, label });
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack = [];
  renderHistoryBtns();
}
function clearHistory() { undoStack = []; redoStack = []; renderHistoryBtns(); }
function stepHistory(from, to, verb) {
  const s = from.pop();
  if (!s) return;
  to.push({ snap: snapshot(), label: s.label });
  data.items = JSON.parse(s.snap);
  data.items.sort(cmp);
  adding = null; closePalette();
  renderHistoryBtns();
  save(); render();
  toast(verb + '：' + s.label);
}
const undo = () => stepHistory(undoStack, redoStack, '已復原');
const redo = () => stepHistory(redoStack, undoStack, '已重做');
function renderHistoryBtns() {
  const u = undoStack[undoStack.length - 1], r = redoStack[redoStack.length - 1];
  $('undo').disabled = !u; $('undo').title = u ? '復原：' + u.label : '沒有可復原的動作';
  $('redo').disabled = !r; $('redo').title = r ? '重做：' + r.label : '沒有可重做的動作';
}
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function addItem(date, text) {
  if (reservedText(text)) { toast('「enc:」開頭保留給加密使用，請換個寫法'); return; }
  mutate('新增「' + shortText(text) + '」', () =>
    insertAtDayEnd({ _id: ++seq, date, text, done: false, color: NEW_CYCLE[data.items.length % NEW_CYCLE.length] }));
  save();
}
function removeItem(it) {
  mutate('刪除「' + shortText(it.text) + '」', () => data.items.splice(data.items.indexOf(it), 1));
  commit();
}

// ---------- 畫面 ----------
function renderStatus() {
  const s = $('status'); s.textContent = statusText; s.title = statusText; s.className = statusBad ? 'bad' : '';
}
function renderBanner() {
  const b = $('banner'); b.innerHTML = '';
  const btn = (t, fn) => { const x = h('button', { text: t, type: 'button' }); x.onclick = fn; return x; };
  if (crypt.mode === 'locked') {
    b.hidden = false;
    b.appendChild(h('span', { text: '已鎖定：事項文字已加密，輸入正確密鑰才能檢視與編輯，目前不會存檔。' }));
    b.appendChild(btn('輸入密鑰', retryUnlock));
    return;
  }
  if (crypt.mode === 'preview') {
    b.hidden = false;
    b.appendChild(h('span', { text: 'naisho.js 沒有密鑰，無法驗證密鑰是否正確。畫面是用你輸入的密鑰試解的結果；內容正確的話，按「確認並重建」。' }));
    b.appendChild(btn('確認並重建', confirmPreview));
    b.appendChild(btn('重新輸入', retryUnlock));
    return;
  }
  if (link === 'ok') { b.hidden = true; return; }
  b.hidden = false;
  if (link === 'demo') {
    b.appendChild(h('span', { text: '線上 DEMO：可以隨意新增、拖曳、改色、復原，改動不會儲存，重新整理即還原；要保存請按右下角「下載備份」。' }));
    const a = h('a', { href: 'https://github.com/YuanData/GTDCalendar', target: '_blank', rel: 'noopener', text: '原始碼' });
    b.appendChild(a);
  } else if (link === 'mismatch') {
    b.appendChild(h('span', { text: '已連結的檔案內容，和 index.html 同資料夾的 gtd-data.js 不一致，可能連到別的位置（例如舊的 Downloads 檔）。為避免寫錯地方，已暫停存檔。' }));
    b.appendChild(btn('改選檔案', pickExisting));
  } else if (link === 'needperm') {
    b.appendChild(h('span', { text: '需要重新授權才能寫入資料檔。' }));
    b.appendChild(btn('允許', regrant));
    b.appendChild(btn('改選其他檔', pickExisting));
  } else if (link === 'unsupported') {
    b.appendChild(h('span', { text: '此瀏覽器不支援直接寫檔，請改用 Chrome 或 Edge；目前改動請用「下載備份」保存。' }));
  } else {
    b.appendChild(h('span', { text: '尚未連結資料檔，改動不會被存下來。' }));
    b.appendChild(btn('選擇現有檔', pickExisting));
    b.appendChild(btn('建立新檔', createNew));
  }
}

// ---- 國定假日（TaiwanCalendar），只快取 isHoliday=true 的日期 ----
const HOLIDAY_URL = y => 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/' + y + '.json';
const HOLIDAY_CACHE_KEY = 'gtd-holidays-v1';
const HOLIDAY_SHOW_KEY = 'gtd-holidays-show';
const HOLIDAY_SEED_YEARS = [2026, 2027];
let holidayCache = {};            // { 年: { 'YYYY-MM-DD': 說明 } }
let showHolidays = true;
const holidayBusy = new Set(), holidayFailed = new Set();
try { holidayCache = JSON.parse(localStorage.getItem(HOLIDAY_CACHE_KEY)) || {}; } catch (e) { holidayCache = {}; }
try { showHolidays = localStorage.getItem(HOLIDAY_SHOW_KEY) !== '0'; } catch (e) {}

function parseHolidays(year, json) {
  if (!Array.isArray(json)) throw new Error('內容不是陣列');
  const out = {};
  json.forEach((r, i) => {
    if (!r || !/^\d{8}$/.test(r.date) || typeof r.isHoliday !== 'boolean') throw new Error('第 ' + (i + 1) + ' 筆格式不符');
    if (r.date.slice(0, 4) !== String(year)) throw new Error('第 ' + (i + 1) + ' 筆年份不是 ' + year);
    if (r.isHoliday && r.description) out[r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6)] = String(r.description);
  });
  return out;
}
async function loadHolidayYear(year) {
  if (holidayCache[year] || holidayBusy.has(year) || holidayFailed.has(year)) return;
  holidayBusy.add(year);
  try {
    const res = await fetch(HOLIDAY_URL(year));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    holidayCache[year] = parseHolidays(year, await res.json());
    try { localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(holidayCache)); } catch (e) {}
    render();
  } catch (err) {
    holidayFailed.add(year);
    toast(year + ' 年國定假日解析失敗：' + err.message);
  } finally { holidayBusy.delete(year); }
}
function ensureHolidays() {
  if (!showHolidays) return;
  const last = addDays(viewStart, data.weeks * 7 - 1).getFullYear();
  const years = new Set(HOLIDAY_SEED_YEARS);
  for (let y = viewStart.getFullYear(); y <= last; y++) years.add(y);
  years.forEach(loadHolidayYear);
}
function renderHolidayBtn() {
  const b = $('holidayBtn');
  b.classList.toggle('on', showHolidays); b.setAttribute('aria-pressed', String(showHolidays));
}

function render() {
  ensureHolidays();
  const weeks = data.weeks;
  const todayStr = fmt(new Date());
  $('weeks').value = String(weeks);
  $('weeksVal').textContent = weeks;
  renderWeeksBtn();
  renderCryptUI();
  renderHolidayBtn();
  const grid = $('grid'); grid.innerHTML = '';

  for (let w = 0; w < weeks; w++) {
    const ws = addDays(viewStart, w * 7);
    const wsStr = fmt(ws), weStr = fmt(addDays(ws, 6));

    // 跨日事項分配到橫條車道
    const spans = data.items.filter(it => it.end && it.date <= weStr && it.end >= wsStr).map(it => ({
      it,
      a: Math.max(0, diffDays(parse(it.date), ws)),
      b: Math.min(6, diffDays(parse(it.end), ws)),
    }));
    spans.sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
    const laneEnds = [];
    spans.forEach(s => {
      let l = laneEnds.findIndex(e => e < s.a);
      if (l < 0) { l = laneEnds.length; laneEnds.push(-1); }
      laneEnds[l] = s.b; s.lane = l;
    });
    const L = laneEnds.length;

    const week = h('div', { class: 'week', 'data-ws': wsStr, style: 'grid-template-rows: 22px repeat(' + L + ', ' + LANE_H + 'px) 1fr;' });
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), ds = fmt(d);
      const cls = ['day'];
      if (i >= 5) cls.push('we');
      if (ds < todayStr) cls.push('past');
      if (ds === todayStr) cls.push('today');
      if (d.getDate() === 1) cls.push('m1');
      const hol = showHolidays && holidayCache[d.getFullYear()] && holidayCache[d.getFullYear()][ds];
      const ab = h('button', { class: 'addbtn', type: 'button', text: '＋', title: '新增事項' });
      const dlabel = h('div', { class: 'dlabel', title: '點一下新增事項' }, [
        h('span', { class: 'dl-date', text: (d.getDate() === 1 ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[i] + ')' }), ab, h('span', { class: 'hol', text: hol || '' })]);
      dlabel.onclick = () => { adding = ds; render(); };   // 整列都是新增的點擊範圍
      const ul = h('ul', { class: 'list', style: 'margin-top:' + (L * LANE_H) + 'px' });
      data.items.filter(it => !it.end && it.date === ds).forEach(it => ul.appendChild(itemEl(it)));
      const day = h('div', { class: cls.join(' '), 'data-date': ds, style: 'grid-column:' + (i + 1) }, [dlabel, ul]);
      if (i === 6) day.appendChild(h('span', { class: 'wk-no', title: '第 ' + isoWeek(d) + ' 週（ISO）', text: String(isoWeek(d)) }));
      if (adding === ds) {
        const inp = h('input', { class: 'add-in', type: 'text', placeholder: '新增事項，Enter 送出' });
        let fin = false;
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const t = inp.value.trim(); fin = true;
            if (t) { addItem(ds, t); } render();
          } else if (e.key === 'Escape') { fin = true; adding = null; render(); }
        });
        inp.addEventListener('blur', () => {
          if (fin) return; fin = true;
          const t = inp.value.trim(); if (t) addItem(ds, t);
          adding = null; render();
        });
        ul.appendChild(h('li', null, [inp]));
        setTimeout(() => inp.focus(), 0);
      }
      week.appendChild(day);
    }
    spans.forEach(s => week.appendChild(spanEl(s, wsStr, weStr)));
    wireWeek(week, ws);
    grid.appendChild(week);
  }
}

function toolsEl(it) {
  const dot = h('button', { class: 'dot', type: 'button', title: '顏色', style: it.color ? '--c:' + COLOR_HEX[it.color] : '' });   // 色點永遠顯示主色
  dot.onclick = e => { e.stopPropagation(); openPalette(it, dot); };
  const ed = h('button', { type: 'button', text: '⋯', title: '編輯日期／設為跨日' });
  ed.onclick = e => { e.stopPropagation(); openDialog(it); };
  const del = h('button', { type: 'button', text: '×', title: '刪除' });
  del.onclick = e => { e.stopPropagation(); removeItem(it); };
  return h('span', { class: 'tools' }, [dot, ed, del]);
}
function chkEl(it) {
  const c = h('input', { class: 'chk', type: 'checkbox' });
  c.checked = it.done;
  c.onchange = () => {
    mutate((c.checked ? '勾選「' : '取消勾選「') + shortText(it.text) + '」', () => { it.done = c.checked; });
    save(); render();
  };
  c.addEventListener('mousedown', e => e.stopPropagation());
  return c;
}
function displayText(it) {
  if (crypt.mode === 'locked') return Cipher.isCipher(it.text) ? '🔒' : it.text;
  if (crypt.mode === 'preview') return Cipher.decrypt(it.text, crypt.key);
  return it.text;
}
function txtEl(it) {
  const t = h('span', { class: 'txt', text: displayText(it) });
  t.ondblclick = () => editText(it, t);
  return t;
}
function editText(it, t) {
  const inp = h('input', { class: 'edit-in', type: 'text' });
  inp.value = it.text;
  t.replaceWith(inp); inp.focus(); inp.select();
  let fin = false;
  const done = ok => {
    if (fin) return; fin = true;
    const v = inp.value.trim();
    if (ok && v && v !== it.text && reservedText(v)) { toast('「enc:」開頭保留給加密使用，請換個寫法'); render(); return; }
    if (ok && v && v !== it.text) { mutate('修改「' + shortText(it.text) + '」', () => { it.text = v; }); save(); }
    render();
  };
  inp.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
  inp.onblur = () => done(true);
}

function itemEl(it) {
  const c = shownColor(it, fmt(new Date()), null);
  const li = h('li', { class: 'item' + (it.done ? ' done' : '') + (it.strikeout ? ' strike' : ''), draggable: 'true', 'data-id': it._id,
    style: c ? 'background:' + c : '' }, [chkEl(it), txtEl(it), toolsEl(it)]);
  li.addEventListener('dragstart', e => {
    drag = { kind: 'single', it };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(it._id));
    setTimeout(() => li.classList.add('dragging'), 0);
  });
  li.addEventListener('dragend', endDrag);
  return li;
}
function spanEl(s, wsStr, weStr) {
  const it = s.it;
  const cls = ['span'];
  if (it.done) cls.push('done');
  if (it.strikeout) cls.push('strike');
  if (it.date < wsStr) cls.push('cl');
  if (it.end > weStr) cls.push('cr');
  const hex = shownColor(it, fmt(new Date()), SPAN_DEFAULT);
  const el = h('div', { class: cls.join(' '), draggable: 'true', 'data-id': it._id,
    style: '--c:' + hex + ';grid-column:' + (s.a + 1) + '/' + (s.b + 2) + ';grid-row:' + (s.lane + 2) }, [chkEl(it), txtEl(it), toolsEl(it)]);
  el.addEventListener('dragstart', e => {
    const week = el.closest('.week');
    drag = { kind: 'span', it, grab: dateAt(week, e.clientX) };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(it._id));
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  el.addEventListener('dragend', endDrag);
  return el;
}

// ---------- 拖曳 ----------
function dateAt(week, x) {
  const r = week.getBoundingClientRect();
  const col = Math.min(6, Math.max(0, Math.floor((x - r.left) / (r.width / 7))));
  return fmt(addDays(parse(week.dataset.ws), col));
}
function clearMarks() {
  document.querySelectorAll('.drop').forEach(e => e.classList.remove('drop'));
  document.querySelectorAll('.ins-before,.ins-after').forEach(e => e.classList.remove('ins-before', 'ins-after'));
}
function endDrag() { drag = null; clearMarks(); document.querySelectorAll('.dragging').forEach(e => e.classList.remove('dragging')); }

function wireWeek(week) {
  week.addEventListener('dragover', e => {
    if (!drag) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    clearMarks();
    const ds = dateAt(week, e.clientX);
    const day = week.querySelector('.day[data-date="' + ds + '"]');
    if (day) day.classList.add('drop');
    if (drag.kind === 'single') {
      const li = e.target.closest && e.target.closest('li.item');
      if (li && Number(li.dataset.id) !== drag.it._id) {
        const r = li.getBoundingClientRect();
        li.classList.add(e.clientY < r.top + r.height / 2 ? 'ins-before' : 'ins-after');
      }
    }
  });
  week.addEventListener('drop', e => {
    if (!drag) return;
    e.preventDefault();
    const ds = dateAt(week, e.clientX);
    const it = drag.it;
    const li = e.target.closest && e.target.closest('li.item');
    const target = li ? byId(Number(li.dataset.id)) : null;
    const before = li ? e.clientY < li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2 : false;
    const grab = drag.grab, kind = drag.kind;
    mutate('搬移「' + shortText(it.text) + '」', () => {
      if (kind === 'span') {
        const shift = diffDays(parse(ds), parse(grab));
        if (shift) {
          it.date = fmt(addDays(parse(it.date), shift));
          it.end = fmt(addDays(parse(it.end), shift));
        }
      } else {
        data.items.splice(data.items.indexOf(it), 1);
        it.date = ds;
        if (target && target !== it && target.date === ds) {
          const idx = data.items.indexOf(target);
          data.items.splice(before ? idx : idx + 1, 0, it);
        } else insertAtDayEnd(it);
      }
    });
    endDrag(); commit();
  });
}

// ---------- 色盤 ----------
function openPalette(it, anchor) {
  const pal = $('pal'); pal.innerHTML = '';
  palTarget = it;
  PALETTE_ROWS.forEach(r => {
    const row = h('div', { class: 'row' });
    r.forEach(c => {
      if (!c) {
        const none = h('button', { class: 'sw none' + (it.color ? '' : ' sel'), type: 'button', text: it.color ? '無' : '無✓', title: '無色' });
        none.onclick = () => { mutate('改色「' + shortText(it.text) + '」', () => { delete it.color; }); closePalette(); commit(); };
        row.appendChild(none);
        return;
      }
      const on = it.color === c[0];
      const sw = h('button', { class: 'sw' + (on ? ' sel' : ''), type: 'button', text: on ? '✓' : '', title: c[1], style: '--c:' + c[2] });
      sw.onclick = () => { mutate('改色「' + shortText(it.text) + '」', () => { it.color = c[0]; }); closePalette(); commit(); };
      row.appendChild(sw);
    });
    pal.appendChild(row);
  });
  pal.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pal.offsetWidth;
  pal.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left)) + 'px';
  pal.style.top = Math.min(window.innerHeight - pal.offsetHeight - 4, r.bottom + 4) + 'px';
}
function closePalette() { $('pal').hidden = true; palTarget = null; }
document.addEventListener('mousedown', e => { if (!$('pal').hidden && !e.target.closest('#pal') && !e.target.closest('.dot')) closePalette(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePalette(); });

// ---------- 編輯對話框 ----------
let dlgItem = null;
function openDialog(it) {
  dlgItem = it;
  $('dText').value = it.text; $('dDate').value = it.date; $('dEnd').value = it.end || '';
  $('dStrike').checked = !!it.strikeout;
  $('dErr').hidden = true;
  $('dlg').showModal();
}
$('dlgForm').addEventListener('submit', e => {
  const ok = e.submitter && e.submitter.value === 'ok';
  if (!ok) return;
  const t = $('dText').value.trim(), d = $('dDate').value, en = $('dEnd').value;
  if (!t || !validDate(d) || (en && !validDate(en)) || (en && en <= d)) {
    e.preventDefault();
    $('dErr').textContent = en && en <= d ? '結束日必須晚於起始日；單日事項請把結束日留空。' : '請填寫內容與日期。';
    $('dErr').hidden = false; return;
  }
  if (reservedText(t)) {
    e.preventDefault(); $('dErr').textContent = '「enc:」開頭保留給加密使用，請換個寫法。'; $('dErr').hidden = false; return;
  }
  const it = dlgItem;
  mutate('編輯「' + shortText(it.text) + '」', () => {
    it.text = t; it.date = d;
    if (en) it.end = en; else delete it.end;
    if ($('dStrike').checked) it.strikeout = true; else delete it.strikeout;
  });
  commit();
});

// ---------- 導覽與初始化 ----------
function shiftMonth(dir) {
  const d = viewStart;
  const t = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  viewStart = mondayOf(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), dim)));
  render();
}
$('prevMonth').onclick = () => shiftMonth(-1);
$('nextMonth').onclick = () => shiftMonth(1);
$('prevWeek').onclick = () => { viewStart = addDays(viewStart, -7); render(); };
$('nextWeek').onclick = () => { viewStart = addDays(viewStart, 7); render(); };
$('today').onclick = () => { viewStart = mondayOf(new Date()); render(); };
$('download').onclick = downloadFile;
$('holidayBtn').onclick = () => {
  showHolidays = !showHolidays;
  try { localStorage.setItem(HOLIDAY_SHOW_KEY, showHolidays ? '1' : '0'); } catch (e) {}
  render();
};
$('undo').onclick = undo;
$('redo').onclick = redo;
// 拖動滑桿只改畫面；要按旁邊的磁碟片按鈕，才把週數存進檔案（其他存檔動作不會順便存週數）
function renderWeeksBtn() { $('saveWeeks').style.visibility = data.weeks !== persistedWeeks ? 'visible' : 'hidden'; }
$('weeks').oninput = e => { data.weeks = clampWeeks(e.target.value); render(); };
$('saveWeeks').onclick = () => { persistedWeeks = data.weeks; renderWeeksBtn(); save(); };
$('wd').append(...WD.map((t, i) => h('div', { class: i >= 5 ? 'we' : '', text: '週' + t })));

function renderAll() { renderBanner(); renderStatus(); render(); }

$('encToggle').onchange = async () => {
  if (crypt.mode === 'off') await enableEncryption(); else await disableEncryption();
  renderAll();   // 取消或失敗時，開關也會回到實際狀態
};

async function boot(raw) {
  data = load(raw); persistedWeeks = data.weeks; clearHistory(); detectCrypt();
  renderAll();
  if (crypt.mode === 'locked') { await askUnlock(); renderAll(); }
  if (DEMO) { link = 'demo'; statusText = 'DEMO：改動不會儲存'; } else await initLink();
  renderAll();
}
function loadScript(src) {
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(true); s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
(async () => {
  if (DEMO) {
    const ok = await loadScript('demo-data.js');
    const today = new Date(), demo = ok && window.GTD_DEMO;
    boot(demo && {
      weeks: demo.weeks,
      items: demo.items.map(({ d, end, ...rest }) => {
        const it = { ...rest, date: fmt(addDays(today, d)) };
        if (end !== undefined) it.end = fmt(addDays(today, end));
        return it;
      }),
    });
    return;
  }
  const params = new URLSearchParams(location.search);
  await loadScript(params.get('naisho') || 'naisho.js');   // 沒有這個檔案也沒關係，視為沒有密鑰
  const ok = await loadScript(params.get('data') || DEFAULT_DATA);
  boot(ok ? window.GTD_DATA : null);
})();
})();
