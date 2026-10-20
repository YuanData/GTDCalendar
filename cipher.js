// 簡易加密：防君子不防小人。純函式、不連網、不依賴瀏覽器功能。
// 流程：短密鑰 --deriveKey(迭代 SHA-256)--> 64 字元 hex 長 key --keystream(計數器模式 SHA-256)--> XOR --> Base64
(function (root) {
'use strict';

const PREFIX = 'enc:';

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const ror = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(msg) {
  const l = msg.length;
  const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  buf.set(msg);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(l / 0x20000000));
  dv.setUint32(buf.length - 4, (l << 3) >>> 0);
  const H = H0.slice();
  const w = new Uint32Array(64);
  for (let o = 0; o < buf.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ror(a, 7) ^ ror(a, 18) ^ (a >>> 3);
      const s1 = ror(b, 17) ^ ror(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

const utf8 = s => new TextEncoder().encode(s);
const concat = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
const toHex = u8 => Array.from(u8, v => v.toString(16).padStart(2, '0')).join('');
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function fromB64(b64) { const s = atob(b64); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }

// 短密鑰 -> 64 字元 hex 長 key（存進 naisho.js 的 NAISHO）
function deriveKey(pass) {
  const p = utf8(pass);
  let h = sha256(concat(utf8('naisho:'), p));
  for (let i = 0; i < 1000; i++) h = sha256(concat(h, p));
  return toHex(h);
}

// 金鑰流：第 i 區塊 = SHA-256(key || i)，串接到需要的長度
function keystream(keyHex, n) {
  const key = utf8(keyHex);
  const out = new Uint8Array(Math.ceil(n / 32) * 32);
  for (let i = 0; i * 32 < n; i++) {
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, i);
    out.set(sha256(concat(key, ctr)), i * 32);
  }
  return out.subarray(0, n);
}

function xor(bytes, keyHex) {
  const ks = keystream(keyHex, bytes.length);
  const r = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) r[i] = bytes[i] ^ ks[i];
  return r;
}

const isCipher = t => typeof t === 'string' && t.startsWith(PREFIX);
const encrypt = (text, keyHex) => PREFIX + toB64(xor(utf8(text), keyHex));
// 只剝一層 enc: 前綴；格式不對時原樣回傳
function decrypt(cipher, keyHex) {
  if (!isCipher(cipher)) return cipher;
  try { return new TextDecoder().decode(xor(fromB64(cipher.slice(PREFIX.length)), keyHex)); }
  catch (err) { return cipher; }
}

const api = { PREFIX, sha256, deriveKey, keystream, encrypt, decrypt, isCipher, toHex, utf8 };
root.Cipher = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
