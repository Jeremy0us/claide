// BARBARIAN — a tribute to the 1987 Atari ST sword-fighting classic.
// Everything (sprites, backdrops, sound) is generated in code; no original assets are used.
// The game renders into a 320x200 frame buffer, like the ST's low-resolution mode, at 50 ticks/sec (PAL).
'use strict';
(() => {

// ---------------------------------------------------------------------------
// Screen & raster primitives
// ---------------------------------------------------------------------------
const W = 320, H = 200, GROUND = 188, HUD_H = 26, TICK = 1000 / 50;
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const frame = ctx.createImageData(W, H);
const screen = new Uint32Array(frame.data.buffer);
let tgt = screen;

// The ST palette: 3 bits per channel.
const st = (r, g, b) => ((255 << 24) | (Math.round(b * 255 / 7) << 16) | (Math.round(g * 255 / 7) << 8) | Math.round(r * 255 / 7)) >>> 0;
const pal = (...cs) => cs.map(c => st(c[0], c[1], c[2]));
const BLACK = st(0, 0, 0), WHITE = st(7, 7, 7);

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function pset(x, y, c) { x |= 0; y |= 0; if (x >= 0 && x < W && y >= 0 && y < H) tgt[y * W + x] = c; }
function rect(x, y, w, h, c) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) { const o = yy * W; for (let xx = x0; xx < x1; xx++) tgt[o + xx] = c; }
}
// Tapered capsule from (ax,ay) radius ra to (bx,by) radius rb.
function seg(ax, ay, bx, by, ra, rb, c) {
  const x0 = Math.max(0, Math.floor(Math.min(ax - ra, bx - rb))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax + ra, bx + rb)));
  const y0 = Math.max(0, Math.floor(Math.min(ay - ra, by - rb))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay + ra, by + rb)));
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++) {
    const qy = y + 0.5 - ay;
    for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5 - ax;
      let t = l2 > 0 ? (qx * dx + qy * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = qx - dx * t, ey = qy - dy * t, r = ra + (rb - ra) * t;
      if (ex * ex + ey * ey <= r * r) tgt[y * W + x] = c;
    }
  }
}
const disc = (x, y, r, c) => seg(x, y, x, y, r, r, c);
function line(x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    pset(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
function poly(pts, c) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
  const n = pts.length / 2;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const sy = y + 0.5, xs = [];
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + (sy - ay) * (bx - ax) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) tgt[y * W + x] = c;
    }
  }
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const dith = (x, y, f) => f > BAYER[(y & 3) * 4 + (x & 3)];
const halve = c => (((c >>> 1) & 0x7f7f7f) | 0xff000000) >>> 0;
function mix(c, d) { return ((((c & 0xfefefe) >>> 1) + ((d & 0xfefefe) >>> 1)) | 0xff000000) >>> 0; }
function darken(cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
    if (u * u + v * v <= 1) tgt[y * W + x] = halve(tgt[y * W + x]);
  }
}

// Shaded limb: outline, shadow, mid tone, highlight — lit from the top left.
const LX = -0.62, LY = -0.78;
function chain(segs, p) {
  for (const s of segs) seg(s[0], s[1], s[2], s[3], s[4] + 1, s[5] + 1, p[0]);
  for (const s of segs) seg(s[0], s[1], s[2], s[3], s[4], s[5], p[1]);
  for (const s of segs) { const o = s[4] * 0.28; seg(s[0] + LX * o, s[1] + LY * o, s[2] + LX * o, s[3] + LY * o, s[4] * 0.72, s[5] * 0.72, p[2]); }
  for (const s of segs) { const o = s[4] * 0.5; seg(s[0] + LX * o, s[1] + LY * o, s[2] + LX * o, s[3] + LY * o, s[4] * 0.34, s[5] * 0.34, p[3]); }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font
// ---------------------------------------------------------------------------
const FONT_SRC = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 10001 01010 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  ' ': '00000 00000 00000 00000 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100',
  '!': '00100 00100 00100 00100 00100 00000 00100', '-': '00000 00000 00000 11111 00000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000', ',': '00000 00000 00000 00000 01100 00100 01000',
  '/': '00001 00010 00010 00100 01000 01000 10000', '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000', '?': '01110 10001 00001 00010 00100 00000 00100',
  "'": '01100 00100 01000 00000 00000 00000 00000', '+': '00000 00100 00100 11111 00100 00100 00000',
  '=': '00000 00000 11111 00000 11111 00000 00000', '>': '01000 00100 00010 00001 00010 00100 01000',
  '<': '00010 00100 01000 10000 01000 00100 00010', '*': '00000 10101 01110 11111 01110 10101 00000',
};
const FONT = {};
for (const k in FONT_SRC) FONT[k] = FONT_SRC[k].replace(/ /g, '');

function text(s, x, y, col, sc = 1) {
  s = String(s).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i]];
    if (!g) continue;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r * 5 + c] === '1') rect(x + i * 6 * sc + c * sc, y + r * sc, sc, sc, typeof col === 'function' ? col(r * sc) : col);
    }
  }
}
const textW = (s, sc = 1) => String(s).length * 6 * sc - sc;
function textS(s, x, y, col, sc = 1, sh = BLACK) { text(s, x + sc, y + sc, sh, sc); text(s, x, y, col, sc); }
function textC(s, y, col, sc = 1, sh = BLACK) { textS(s, Math.round((W - textW(s, sc)) / 2), y, col, sc, sh); }

const YELLOW = st(7, 6, 1), ORANGE = st(7, 4, 0), GREY = st(5, 5, 5), RED = st(6, 0, 0);
const gradFire = (h) => (r) => { const f = r / h; return f < 0.25 ? st(7, 7, 5) : f < 0.45 ? st(7, 6, 1) : f < 0.65 ? st(7, 4, 0) : f < 0.85 ? st(6, 2, 0) : st(4, 0, 0); };

// ---------------------------------------------------------------------------
// Sound — synthesised with WebAudio
// ---------------------------------------------------------------------------
const SND = { ctx: null, out: null, nb: null, muted: false };
function sndInit() {
  if (SND.ctx) { if (SND.ctx.state === 'suspended') SND.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    SND.ctx = new AC();
    SND.out = SND.ctx.createGain(); SND.out.gain.value = 0.5; SND.out.connect(SND.ctx.destination);
    const n = SND.ctx.sampleRate; SND.nb = SND.ctx.createBuffer(1, n, n);
    const d = SND.nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { SND.ctx = null; }
}
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function nz(t, dur, type, f0, f1, q, peak) {
  const c = SND.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = SND.nb; s.loop = true;
  f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q;
  env(g, t, 0.004, peak, dur);
  s.connect(f); f.connect(g); g.connect(SND.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function osc(t, dur, type, f0, f1, peak, filt, vib) {
  const c = SND.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.006, peak, dur);
  let node = o;
  if (filt) { const f = c.createBiquadFilter(); f.type = filt[0]; f.frequency.value = filt[1]; f.Q.value = filt[2]; o.connect(f); node = f; }
  if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  node.connect(g); g.connect(SND.out); o.start(t); o.stop(t + dur + 0.05);
}
function sfx(name, p = 1) {
  if (!SND.ctx || SND.muted) return;
  const t = SND.ctx.currentTime + 0.005;
  switch (name) {
    case 'swish': nz(t, 0.17, 'bandpass', 700, 3800, 2.2, 0.32); break;
    case 'clang':
      [1180, 1655, 2310, 2970, 3720, 5120].forEach((f, i) => osc(t, 0.55 - i * 0.06, i % 2 ? 'triangle' : 'sine', f * p, f * p * 0.996, 0.13));
      nz(t, 0.05, 'highpass', 2500, 0, 0.7, 0.4); break;
    case 'chop': nz(t, 0.14, 'lowpass', 1800, 260, 1, 0.7); osc(t, 0.12, 'square', 190, 50, 0.16); break;
    case 'grunt': osc(t, 0.26, 'sawtooth', 160 * p, 88 * p, 0.38, ['bandpass', 650, 2.5]); nz(t, 0.16, 'bandpass', 900, 500, 3, 0.14); break;
    case 'hup': osc(t, 0.14, 'sawtooth', 200 * p, 150 * p, 0.25, ['bandpass', 800, 3]); break;
    case 'scream': osc(t, 1.25, 'sawtooth', 640 * p, 160 * p, 0.32, ['bandpass', 1100, 3.5], [7, 22]); osc(t, 1.1, 'sawtooth', 480 * p, 130 * p, 0.18, ['bandpass', 700, 3]); break;
    case 'squelch': nz(t, 0.55, 'lowpass', 2600, 140, 7, 0.55); nz(t + 0.05, 0.4, 'bandpass', 500, 220, 5, 0.3); break;
    case 'thud': osc(t, 0.22, 'sine', 120, 40, 0.6); nz(t, 0.12, 'lowpass', 500, 120, 1, 0.35); break;
    case 'land': osc(t, 0.12, 'sine', 90, 40, 0.35); break;
    case 'laugh': for (let i = 0; i < 5; i++) osc(t + i * 0.12, 0.09, 'square', 560 - i * 34, 420 - i * 34, 0.12, ['bandpass', 1300, 2.5]); break;
    case 'zap': osc(t, 0.4, 'sawtooth', 1500, 160, 0.18); nz(t, 0.3, 'bandpass', 3000, 500, 3, 0.2); break;
    case 'boom': nz(t, 1.4, 'lowpass', 900, 50, 1, 0.8); osc(t, 1.1, 'sine', 90, 28, 0.5); break;
    case 'magic': for (let i = 0; i < 6; i++) osc(t + i * 0.05, 0.12, 'triangle', 900 + i * 220, 1200 + i * 220, 0.1); break;
    case 'drum': osc(t, 0.32, 'sine', 110 * p, 42 * p, 0.7); nz(t, 0.08, 'lowpass', 600, 150, 1, 0.3); break;
    case 'bass': osc(t, 0.42, 'triangle', 110 * p, 110 * p * 0.99, 0.22); break;
    case 'blip': osc(t, 0.06, 'square', 880, 880, 0.06); break;
  }
}

// ---------------------------------------------------------------------------
// Fighter skeleton & poses
// Angles in degrees: 0 = down, 90 = forward (toward the opponent), 180 = up, -90 = backward.
// ---------------------------------------------------------------------------
const NUM_KEYS = ['hx', 'to', 'he', 'uf', 'ff', 'ub', 'fb', 'tf', 'sf', 'tb', 'sb', 'ftf', 'ftb', 'sw', 'sl', 'rot'];
const ANG_KEYS = ['to', 'he', 'uf', 'ff', 'ub', 'fb', 'tf', 'sf', 'tb', 'sb', 'sw'];
const IDLE = { hx: 0, to: 174, he: 176, uf: 22, ff: 118, ub: 12, fb: 108, tf: 22, sf: -2, tb: -16, sb: -8, ftf: 90, ftb: 90, sw: 166, sl: 1, rot: 0, flip: false };
const P = (o, base = IDLE) => Object.assign({}, base, o);
const dv = a => { const r = a * 0.017453292519943295; return [Math.sin(r), Math.cos(r)]; };
const ad = (o, a, l) => { const d = dv(a); return [o[0] + d[0] * l, o[1] + d[1] * l]; };
const ease = t => t * t * (3 - 2 * t);

function lerpPose(a, b, t) {
  const o = {};
  for (const k of NUM_KEYS) o[k] = a[k] + (b[k] - a[k]) * t;
  o.flip = t < 0.5 ? a.flip : b.flip;
  return o;
}
function normFrom(from, to) {
  const o = Object.assign({}, from);
  for (const k of ANG_KEYS) { while (o[k] - to[k] > 180) o[k] -= 360; while (o[k] - to[k] < -180) o[k] += 360; }
  return o;
}

// Head detail points around centre C, with head "up" angle he.
function headPts(C, he, J) {
  const u = dv(he), n = dv(he - 90);
  const p = (a, b) => [C[0] + n[0] * a + u[0] * b, C[1] + n[1] * a + u[1] * b];
  J.head = C;
  J.jawA = p(0.8, -0.5); J.jawB = p(2.4, -3.2);
  J.hairA = p(-1.3, 1.3); J.hairB = p(-2.2, -0.8);
  J.maneA = p(-2.8, 0.5); J.maneB = p(-4.6, -8);
  J.bandA = p(-3.7, 1.7); J.bandB = p(3.8, 1.5);
  J.eye = p(2.6, 0.3); J.nose = p(4.6, -0.6);
  return J;
}

function skel(p) {
  const J = {};
  const hip = [p.hx, -30], td = dv(p.to), tn = dv(p.to - 90);
  const sh = ad(hip, p.to, 20);
  J.hip = hip; J.sh = sh; J.shB = [sh[0] - 2, sh[1] + 1]; J.hipB = [hip[0] - 1.5, hip[1]];
  J.neck = ad(sh, p.to, 3);
  headPts(ad(J.neck, p.he, 4.5), p.he, J);
  J.elF = ad(sh, p.uf, 11); J.haF = ad(J.elF, p.ff, 10); J.wrF = ad(J.haF, p.ff, -2.6);
  J.elB = ad(J.shB, p.ub, 11); J.haB = ad(J.elB, p.fb, 10); J.wrB = ad(J.haB, p.fb, -2.6);
  J.knF = ad(hip, p.tf, 15); J.anF = ad(J.knF, p.sf, 14); J.toF = ad(J.anF, p.sf + p.ftf, 6);
  J.knB = ad(J.hipB, p.tb, 15); J.anB = ad(J.knB, p.sb, 14); J.toB = ad(J.anB, p.sb + p.ftb, 6);
  J.btF = ad(J.knF, p.sf, 6); J.btB = ad(J.knB, p.sb, 6);
  J.clF = ad(hip, p.tf, 6.5); J.clB = ad(J.hipB, p.tb, 6.5);
  const q = (o, a, b) => [o[0] + td[0] * a + tn[0] * b, o[1] + td[1] * a + tn[1] * b];
  J.chestA = q(sh, -7, 2.6); J.chestB = q(sh, -3, 2.2); J.butt = q(hip, 1, -2);
  J.beltA = q(hip, 2, -5.2); J.beltB = q(hip, 2, 5.2);
  J.flapA = q(hip, 1, 3.5); J.flapB = q(hip, -7, 4.2);
  J.swP = ad(J.haF, p.sw, -3.5); J.swG = ad(J.haF, p.sw, 2.2); J.swT = ad(J.haF, p.sw, 2.2 + 27 * p.sl);
  const gn = dv(p.sw - 90);
  J.gA = [J.swG[0] + gn[0] * 3, J.swG[1] + gn[1] * 3]; J.gB = [J.swG[0] - gn[0] * 3, J.swG[1] - gn[1] * 3];
  // whole-body rotation (rolls) and mirroring (spins)
  if (p.rot) {
    const pv = [hip[0] + 3, hip[1] - 6];
    for (const k in J) {
      const x = J[k][0] - pv[0], y = J[k][1] - pv[1], a = Math.atan2(x, y) * 57.29577951308232 + p.rot, l = Math.hypot(x, y), d = dv(a);
      J[k] = [pv[0] + d[0] * l, pv[1] + d[1] * l];
    }
  }
  if (p.flip) for (const k in J) J[k] = [2 * p.hx - J[k][0], J[k][1]];
  // feet (or whatever is lowest) rest on the ground
  let my = -Infinity;
  for (const k of ['anF', 'toF', 'anB', 'toB', 'knF', 'knB', 'hip', 'sh', 'elF', 'elB', 'butt']) my = Math.max(my, J[k][1]);
  my = Math.max(my, J.head[1] + 4.5);
  for (const k in J) J[k] = [J[k][0], J[k][1] - my];
  return J;
}

const LUNGE = { tf: 42, sf: 8, tb: -34, sb: -8 };
const CROUCH = P({ to: 162, he: 168, uf: 35, ff: 128, ub: 25, fb: 115, tf: 82, sf: -4, tb: 12, sb: -82, sw: 160 });
const TUCK = P({ to: 120, he: 105, uf: 80, ff: 150, ub: 70, fb: 150, tf: 130, sf: 10, tb: 120, sb: 0, sw: 160 });
const TUCKJ = P({ tf: 100, sf: -15, tb: 70, sb: -40, uf: 30, ff: 140, ub: 20, fb: 130, sw: 172, to: 170 });
const BLOCKH = P({ to: 180, he: 180, uf: 150, ff: 172, ub: 140, fb: 165, sw: 100 });
const BLOCKL = P({ to: 172, he: 172, uf: 40, ff: 98, ub: 30, fb: 92, sw: 10 });
const HITP = P({ to: 196, he: 206, uf: -30, ff: 40, ub: -20, fb: 50, sw: 140, tf: 32, sf: 8, tb: -28, sb: -10 });
const HITP2 = P({ to: 190, he: 196, uf: -10, ff: 70, ub: 0, fb: 70, sw: 150, tf: 30, sf: 4, tb: -24, sb: -8 });
const LIE = P({ to: 268, he: 272, uf: 250, ff: 262, ub: 240, fb: 256, tf: 92, sf: 94, tb: 86, sb: 96, sw: 262 });
const KNEEL = P({ to: 150, he: 128, uf: 15, ff: 35, ub: 5, fb: 25, sw: 25, tf: 84, sf: -4, tb: 12, sb: -82 });
const HEADLESS = P({ to: 186, uf: -40, ff: 30, ub: -30, fb: 40, sw: 120, tf: 30, sf: 6, tb: -26, sb: -10 });
const HEADLESS2 = P({ to: 180, uf: -20, ff: 60, ub: -10, fb: 60, sw: 100, tf: 24, sf: 0, tb: -20, sb: -8 });
const WIN1 = P({ to: 180, he: 184, uf: 168, ff: 178, ub: 150, fb: 172, sw: 180, tf: 28, sf: -4, tb: -24, sb: -6 });
const WIN2 = P({ to: 182, he: 188, uf: 174, ff: 184, ub: 156, fb: 178, sw: 186, tf: 28, sf: -4, tb: -24, sb: -6 });
const ARMX = { uf: 75, ff: 88, ub: 65, fb: 85, to: 168 };

const K = (p, d, x) => Object.assign({ p, d }, x);
const ANIMS = {
  idle: { loop: true, keys: [K(IDLE, 26), K(P({ to: 172, uf: 25, ff: 115, ub: 14, fb: 106, sw: 163 }), 26)] },
  walk: { loop: true, keys: [K(P({ tf: 30, sf: 2, tb: -18, sb: -4 }), 7), K(P({ tf: 26, sf: 0, tb: 0, sb: -30 }), 7), K(P({ tf: 14, sf: -4, tb: -8, sb: -6 }), 7), K(P({ tf: 45, sf: 5, tb: -14, sb: -6 }), 7)] },
  walkB: { loop: true, keys: [K(P({ tf: 45, sf: 5, tb: -14, sb: -6 }), 7), K(P({ tf: 14, sf: -4, tb: -8, sb: -6 }), 7), K(P({ tf: 26, sf: 0, tb: 0, sb: -30 }), 7), K(P({ tf: 30, sf: 2, tb: -18, sb: -4 }), 7)] },
  crouch: { keys: [K(CROUCH, 5)] },
  blockH: { keys: [K(BLOCKH, 5)] },
  blockL: { keys: [K(BLOCKL, 5)] },
  jump: { keys: [K(P({ tf: 50, sf: -25, tb: 25, sb: -55, to: 166 }), 4, { sfx: 'hup' }), K(TUCKJ, 9), K(TUCKJ, 9), K(IDLE, 6, { sfx: 'land' }), K(P({ tf: 45, sf: -20, tb: 15, sb: -45, to: 166 }), 4), K(IDLE, 6)] },
  roll: { lin: true, keys: [K(CROUCH, 4), K(P({ rot: -90 }, TUCK), 6, { sfx: 'land' }), K(P({ rot: -180 }, TUCK), 6), K(P({ rot: -270 }, TUCK), 6), K(P({ rot: -360 }, TUCK), 6, { sfx: 'land' })] },
  rollStop: { keys: [K(CROUCH, 6), K(IDLE, 8)] },
  hit: { keys: [K(HITP, 4, { mv: -6 }), K(HITP2, 8, { mv: -4 }), K(IDLE, 8)] },
  hitBig: { keys: [K(HITP, 4, { mv: -12 }), K(HITP2, 10, { mv: -6 }), K(IDLE, 8)] },
  knock: { keys: [K(LIE, 10, { mv: -10, sfx: 'thud' }), K(LIE, 28), K(CROUCH, 10), K(IDLE, 8)] },
  die: { keys: [K(KNEEL, 14), K(KNEEL, 16), K(LIE, 12, { sfx: 'thud' })] },
  decap: { keys: [K(HEADLESS, 8, { mv: -4 }), K(HEADLESS2, 18, { mv: -3 }), K(KNEEL, 14), K(LIE, 12, { sfx: 'thud' })] },
  win: { loop: true, keys: [K(WIN1, 14), K(WIN2, 16), K(WIN1, 16)] },

  // --- attacks (act = the frame where the blow lands) ---
  overhead: { zone: 'high', hitsLow: true, dmg: 2, reach: [16, 52], pts: 250, keys: [
    K(P({ to: 186, he: 180, uf: 170, ff: 200, ub: 160, fb: 195, sw: 225 }), 9),
    K(P({ to: 187, he: 180, uf: 172, ff: 203, ub: 162, fb: 197, sw: 228 }), 3, { sfx: 'swish' }),
    K(P(Object.assign({ to: 160, he: 165, uf: 95, ff: 88, ub: 85, fb: 85, sw: 80 }, LUNGE)), 4, { act: true, mv: 4 }),
    K(P(Object.assign({ to: 155, uf: 70, ff: 50, ub: 60, fb: 50, sw: 40 }, LUNGE)), 6),
    K(IDLE, 10)] },
  neck: { zone: 'high', dmg: 2, reach: [18, 52], pts: 300, keys: [
    K(P({ to: 180, uf: -50, ff: 265, ub: -30, fb: 280, sw: 268 }), 8, { sfx: 'swish' }),
    K(P({ to: 172, uf: 30, ff: 80, ub: 25, fb: 80, sw: 92, sl: 0.25 }), 2),
    K(P(Object.assign({ to: 166, uf: 88, ff: 92, ub: 78, fb: 90, sw: 92 }, LUNGE)), 2, { act: true, mv: 4 }),
    K(P(Object.assign({ to: 162, uf: 70, ff: 60, ub: 60, fb: 60, sw: 70, sl: 0.5 }, LUNGE)), 6),
    K(IDLE, 10)] },
  body: { zone: 'mid', dmg: 2, reach: [18, 50], pts: 200, keys: [
    K(P({ to: 180, uf: -40, ff: 250, ub: -25, fb: 265, sw: 260 }), 7, { sfx: 'swish' }),
    K(P({ to: 172, uf: 20, ff: 70, ub: 15, fb: 70, sw: 80, sl: 0.3 }), 2),
    K(P(Object.assign({ to: 165, uf: 55, ff: 85, ub: 45, fb: 85, sw: 96 }, LUNGE)), 2, { act: true, mv: 4 }),
    K(P(Object.assign({ uf: 40, ff: 40, ub: 35, fb: 40, sw: 40, sl: 0.6 }, LUNGE)), 6),
    K(IDLE, 9)] },
  legchop: { zone: 'low', low: true, dmg: 2, reach: [18, 50], pts: 200, keys: [
    K(P({ uf: -30, ff: 250, ub: -20, fb: 250, sw: 250, to: 165 }, CROUCH), 7, { sfx: 'swish' }),
    K(P({ to: 150, uf: 30, ff: 60, ub: 25, fb: 60, sw: 60, sl: 0.3 }, CROUCH), 2),
    K(P({ to: 140, he: 150, uf: 70, ff: 95, ub: 60, fb: 95, sw: 100 }, CROUCH), 2, { act: true, mv: 2 }),
    K(P({ to: 145, uf: 50, ff: 40, ub: 45, fb: 40, sw: 30, sl: 0.7 }, CROUCH), 6),
    K(IDLE, 10)] },
  kick: { zone: 'mid', dmg: 1, reach: [8, 34], pts: 100, knock: 'big', keys: [
    K(P({ to: 186, he: 180, tf: 105, sf: 20, tb: -8, sb: -4, uf: 10, ff: 140, sw: 170 }), 6, { sfx: 'hup' }),
    K(P({ to: 192, he: 182, tf: 92, sf: 92, tb: -12, sb: -4, uf: 10, ff: 140, sw: 172 }), 3, { act: true, mv: 2 }),
    K(P({ to: 192, he: 182, tf: 92, sf: 92, tb: -12, sb: -4, uf: 10, ff: 140, sw: 172 }), 5),
    K(IDLE, 8)] },
  headbutt: { zone: 'high', dmg: 1, reach: [8, 30], pts: 150, knock: 'down', keys: [
    K(P({ to: 192, he: 200, uf: 0, ff: 120, sw: 170 }), 6, { sfx: 'hup' }),
    K(P(Object.assign({ to: 128, he: 115, uf: 30, ff: 120, sw: 150 }, LUNGE)), 3, { act: true, mv: 6 }),
    K(P(Object.assign({ to: 130, he: 118, uf: 30, ff: 120, sw: 150 }, LUNGE)), 6),
    K(IDLE, 10)] },
  web: { zone: 'mid', dmg: 2, reach: [16, 48], pts: 300, lin: true, keys: [
    K(P(Object.assign({ sw: 200 }, ARMX)), 5, { sfx: 'swish' }), K(P(Object.assign({ sw: 110 }, ARMX)), 3),
    K(P(Object.assign({ sw: 20, uf: 85 }, ARMX)), 3, { act: true, mv: 2 }), K(P(Object.assign({ sw: -70 }, ARMX)), 3, { sfx: 'swish' }),
    K(P(Object.assign({ sw: -160 }, ARMX)), 3), K(P(Object.assign({ sw: -250 }, ARMX)), 3),
    K(P(Object.assign({ sw: -340, uf: 85 }, ARMX)), 3, { act: true, zone: 'high', mv: 2 }), K(P(Object.assign({ sw: -430 }, ARMX)), 3),
    K(P(Object.assign({ sw: -520 }, ARMX)), 3), K(IDLE, 10, { norm: true })] },
  flying: { zone: 'high', decap: true, dmg: 3, reach: [18, 56], pts: 500, keys: [
    K(P({ to: 178, uf: -30, ff: 200, ub: -20, fb: 200, sw: 200, tf: 10, sf: -5, tb: -10, sb: -5 }), 6),
    K(P({ flip: true, to: 170, uf: 60, ff: 150, ub: 50, fb: 150, sw: 150, tf: 30, sf: 0, tb: -20, sb: -10 }), 6, { mv: 6, sfx: 'swish' }),
    K(P({ to: 170, uf: 20, ff: 60, ub: 15, fb: 60, sw: 92, sl: 0.3 }), 3, { mv: 3 }),
    K(P(Object.assign({ to: 165, uf: 92, ff: 92, ub: 82, fb: 90, sw: 92 }, LUNGE)), 3, { act: true, mv: 4 }),
    K(P(Object.assign({ uf: 70, ff: 50, ub: 60, fb: 50, sw: 50, sl: 0.6 }, LUNGE)), 8),
    K(IDLE, 12)] },
};
for (const k in ANIMS) { const a = ANIMS[k]; a.name = k; a.act = a.keys.findIndex(x => x.act); }

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------
const SKIN = [[2, 1, 0], [5, 2, 1], [6, 4, 2], [7, 5, 3]];
const SKIN2 = [[1, 0, 0], [4, 2, 1], [5, 3, 1], [6, 4, 2]];
const HAIR = {
  brown: [[1, 0, 0], [2, 1, 0], [3, 2, 1], [4, 3, 1]], black: [[0, 0, 0], [1, 1, 1], [2, 1, 1], [3, 2, 2]],
  blond: [[3, 2, 0], [5, 4, 1], [6, 5, 2], [7, 7, 4]], red: [[2, 0, 0], [4, 1, 0], [5, 2, 0], [6, 3, 1]],
  grey: [[1, 1, 1], [3, 3, 3], [5, 5, 5], [6, 6, 6]],
};
const CLOTH = {
  tan: [[2, 1, 0], [4, 2, 1], [5, 3, 1], [6, 4, 2]], red: [[2, 0, 0], [4, 0, 0], [5, 1, 0], [6, 2, 1]],
  blue: [[0, 0, 1], [1, 1, 3], [2, 2, 4], [3, 3, 5]], green: [[0, 1, 0], [1, 3, 0], [2, 4, 1], [3, 5, 2]],
  purple: [[1, 0, 1], [3, 0, 3], [4, 1, 4], [5, 3, 5]], black: [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]],
};
const BOOT = [[1, 1, 0], [3, 2, 1], [4, 3, 1], [5, 4, 2]];
function look(hair, cloth, band, skin = SKIN) {
  const dk = a => [a[0], a[1].map(v => Math.max(0, v - 1)), a[1], a[2]];
  return { skin: pal(...skin), skinB: pal(...dk(skin)), hair: pal(...HAIR[hair]), cloth: pal(...CLOTH[cloth]), clothB: pal(...dk(CLOTH[cloth])),
    boot: pal(...BOOT), bootB: pal(...dk(BOOT)), band: st(...band), leather: st(2, 1, 0) };
}
const LOOK_HERO = look('brown', 'tan', [6, 0, 0]);
const LOOK_P2 = look('black', 'red', [1, 2, 6], SKIN2);
const OPPONENTS = [
  { d: 0.10, look: look('black', 'red', [6, 6, 6]) },
  { d: 0.22, look: look('blond', 'blue', [6, 0, 0], SKIN2) },
  { d: 0.33, look: look('red', 'green', [6, 6, 0]) },
  { d: 0.44, look: look('black', 'purple', [6, 6, 6], SKIN2) },
  { d: 0.54, look: look('grey', 'black', [6, 0, 0]) },
  { d: 0.64, look: look('blond', 'red', [1, 1, 1], SKIN2) },
  { d: 0.75, look: look('black', 'blue', [6, 5, 0]) },
  { d: 0.88, look: look('red', 'black', [6, 0, 0], SKIN2) },
];

// ---------------------------------------------------------------------------
// Drawing characters
// ---------------------------------------------------------------------------
function drawHead(J, L) {
  const S = (a, b, ra, rb) => [J[a][0], J[a][1], J[b][0], J[b][1], ra, rb];
  chain([S('maneA', 'maneB', 2.8, 1.6)], L.hair);
  chain([S('head', 'head', 4.4, 4.4), S('jawA', 'jawB', 2.3, 2.0)], L.skin);
  pset(J.nose[0], J.nose[1], L.skin[1]);
  chain([S('hairA', 'hairB', 3.6, 3.2)], L.hair);
  seg(J.bandA[0], J.bandA[1], J.bandB[0], J.bandB[1], 0.85, 0.85, L.band);
  pset(J.eye[0], J.eye[1], st(1, 0, 0));
}

function drawFighter(f) {
  const J = f.W, L = f.look;
  if (!J) return;
  const S = (a, b, ra, rb) => [J[a][0], J[a][1], J[b][0], J[b][1], ra, rb];
  // back leg & arm
  chain([S('hipB', 'knB', 3.7, 2.9), S('knB', 'anB', 2.7, 1.9), S('anB', 'toB', 1.7, 1.3)], L.skinB);
  chain([S('btB', 'anB', 2.9, 2.6), S('anB', 'toB', 2.0, 1.6)], L.bootB);
  chain([S('hipB', 'clB', 4.4, 4.0)], L.clothB);
  chain([S('shB', 'elB', 2.9, 2.4), S('elB', 'haB', 2.4, 1.9), S('haB', 'haB', 2.0, 2.0)], L.skinB);
  seg(J.wrB[0], J.wrB[1], J.wrB[0], J.wrB[1], 2.3, 2.3, L.leather);
  // torso
  chain([S('hip', 'sh', 5.2, 6.4), S('chestA', 'chestB', 4.3, 4.3), S('butt', 'butt', 4.2, 4.2), S('sh', 'neck', 2.8, 2.8)], L.skin);
  // front leg & loincloth
  chain([S('hip', 'knF', 3.9, 3.0), S('knF', 'anF', 2.8, 2.0), S('anF', 'toF', 1.8, 1.4)], L.skin);
  chain([S('btF', 'anF', 3.0, 2.7), S('anF', 'toF', 2.1, 1.7)], L.boot);
  chain([S('hip', 'clF', 4.6, 4.1), S('flapA', 'flapB', 2.6, 2.0)], L.cloth);
  seg(J.beltA[0], J.beltA[1], J.beltB[0], J.beltB[1], 1.5, 1.5, L.leather);
  // head
  if (!f.headless) drawHead(J, L);
  else { disc(J.neck[0], J.neck[1], 2.4, st(4, 0, 0)); disc(J.neck[0], J.neck[1] - 0.5, 1.3, st(7, 1, 1)); }
  // sword
  seg(J.swP[0], J.swP[1], J.swG[0], J.swG[1], 1.4, 1.4, st(1, 0, 0));
  seg(J.swP[0], J.swP[1], J.swG[0], J.swG[1], 0.8, 0.8, st(4, 2, 1));
  seg(J.swG[0], J.swG[1], J.swT[0], J.swT[1], 1.6, 0.9, st(1, 1, 1));
  seg(J.swG[0], J.swG[1], J.swT[0], J.swT[1], 0.95, 0.35, st(5, 5, 6));
  seg(J.swG[0] + LX * 0.4, J.swG[1] + LY * 0.4, J.swT[0] + LX * 0.4, J.swT[1] + LY * 0.4, 0.45, 0.1, st(7, 7, 7));
  seg(J.gA[0], J.gA[1], J.gB[0], J.gB[1], 1.3, 1.3, st(2, 1, 0));
  seg(J.gA[0], J.gA[1], J.gB[0], J.gB[1], 0.7, 0.7, st(6, 5, 1));
  disc(J.swP[0], J.swP[1], 1.4, st(6, 5, 1));
  // front arm
  chain([S('sh', 'elF', 3.1, 2.6), S('elF', 'haF', 2.6, 2.1), S('haF', 'haF', 2.2, 2.2)], L.skin);
  seg(J.wrF[0], J.wrF[1], J.wrF[0], J.wrF[1], 2.4, 2.4, L.leather);
}

function worldJ(f) {
  const J = skel(f.pose), out = {};
  for (const k in J) out[k] = [f.x + J[k][0] * f.facing, GROUND + J[k][1] + f.yOff];
  return out;
}

function drawLooseHead(h) {
  const J = headPts([0, 0], h.ang, {});
  for (const k in J) J[k] = [h.x + J[k][0] * h.facing, h.y + J[k][1]];
  drawHead(J, h.look);
  if (h.t < 80) { const n = J.maneA; pset(n[0], n[1] + 2, st(6, 0, 0)); }
}

const GOB = pal([0, 1, 0], [1, 3, 0], [2, 4, 1], [3, 5, 2]);
const GOB_B = pal([0, 1, 0], [1, 2, 0], [1, 3, 0], [2, 4, 1]);
function drawGoblin(g) {
  const f = g.facing, X = lx => g.x + lx * f, Y = ly => GROUND + ly;
  const walking = g.mode === 'walk' || g.mode === 'drag';
  const sw = walking ? Math.sin(g.t * 0.35) : 0;
  const lean = g.mode === 'drag' ? 3 : 0;
  const bob = walking ? Math.abs(Math.sin(g.t * 0.35)) * -1 : 0;
  const S = (a, b, c, d, ra, rb) => [X(a), Y(b), X(c), Y(d), ra, rb];
  chain([S(-1, -10, -1 - sw * 3, -5, 1.8, 1.5), S(-1 - sw * 3, -5, -1 - sw * 4, -1, 1.5, 1.3), S(-1 - sw * 4, -1, 2 - sw * 4, -1, 1.2, 1)], GOB_B);
  const kicking = g.mode === 'kick' && g.k > 3 && g.k < 12;
  if (kicking) chain([S(1, -10, 6, -9, 1.8, 1.5), S(6, -9, 11, -7, 1.5, 1.3), S(11, -7, 13, -9, 1.2, 1)], GOB);
  else chain([S(1, -10, 1 + sw * 3, -5, 1.8, 1.5), S(1 + sw * 3, -5, 1 + sw * 4, -1, 1.5, 1.3), S(1 + sw * 4, -1, 4 + sw * 4, -1, 1.2, 1)], GOB);
  if (g.mode === 'drag') chain([S(2 + lean, -18 + bob, -5, -14, 1.6, 1.3), S(-5, -14, -9, -10, 1.3, 1.2)], GOB_B);
  chain([S(0, -10 + bob, 2 + lean, -19 + bob, 4, 4.6)], GOB);
  seg(X(-2), Y(-10), X(2), Y(-10), 2.4, 2.4, st(3, 1, 0));
  const hx = 5 + lean, hy = -24 + bob + (g.mode === 'laugh' ? Math.sin(g.t * 0.8) : 0);
  poly([X(hx - 3), Y(hy - 1), X(hx - 11), Y(hy - 7), X(hx - 2), Y(hy - 4)], GOB[1]);
  chain([S(hx, hy, hx, hy, 4.8, 4.8), S(hx + 4, hy + 1, hx + 6, hy + 4, 1.5, 1.2)], GOB);
  pset(X(hx + 2), Y(hy - 2), st(7, 7, 0)); pset(X(hx + 3), Y(hy - 2), st(7, 0, 0));
  line(X(hx + 1), Y(hy + 3), X(hx + 4), Y(hy + 3), st(0, 0, 0)); pset(X(hx + 3), Y(hy + 4), WHITE);
  if (g.mode === 'drag') chain([S(2 + lean, -18 + bob, -6, -13, 1.6, 1.3), S(-6, -13, -10, -9, 1.3, 1.2)], GOB);
  else chain([S(2, -18 + bob, 5 - sw * 3, -13, 1.6, 1.3), S(5 - sw * 3, -13, 7 - sw * 3, -9, 1.3, 1.2)], GOB);
}

const ROBE = pal([0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 1, 4]);
function drawDrax(d) {
  if (d.state === 'gone') return;
  const f = d.facing, X = lx => d.x + lx * f, Y = ly => GROUND + ly;
  const flash = d.flash > 0 && (d.flash >> 1) & 1;
  const casting = d.state === 'cast' && d.st < 22;
  const fade = d.state === 'tele' ? Math.abs(d.st - 20) / 20 : d.state === 'die' ? 1 - d.st / 90 : 1;
  const R = flash ? pal([7, 7, 7], [7, 7, 7], [7, 7, 7], [7, 7, 7]) : ROBE;
  const save = tgt; let layer = null;
  if (fade < 1) { layer = new Uint32Array(W * H); layer.set(screen); tgt = layer; }
  // staff in the rear hand
  seg(X(-9), Y(0), X(-9), Y(-64), 1.4, 1.2, st(1, 0, 0)); seg(X(-9), Y(0), X(-9), Y(-64), 0.7, 0.7, st(4, 2, 1));
  const glow = [st(7, 2, 7), st(5, 1, 7), st(7, 6, 7)][(d.t >> 2) % 3];
  disc(X(-9), Y(-66), 3, st(2, 0, 3)); disc(X(-9), Y(-66), 2, glow);
  chain([[X(-6), Y(-42), X(-9), Y(-34), 3, 2.4]], R);
  // robe
  poly([X(-11), Y(0), X(13), Y(0), X(8), Y(-42), X(-7), Y(-42)], R[0]);
  poly([X(-10), Y(-1), X(12), Y(-1), X(7), Y(-41), X(-6), Y(-41)], R[1]);
  poly([X(-1), Y(-1), X(10), Y(-1), X(6), Y(-40), X(0), Y(-40)], R[2]);
  for (const lx of [-4, 2, 6]) line(X(lx), Y(-2), X(lx * 0.6), Y(-34), R[3]);
  rect(Math.min(X(-7), X(9)), Y(-29), 16, 2, flash ? WHITE : st(6, 5, 1));
  chain([[X(-6), Y(-43), X(6), Y(-43), 4.5, 4.5]], R);
  // hood, face and beard
  poly([X(-7), Y(-44), X(7), Y(-44), X(5), Y(-56), X(-2), Y(-63), X(-8), Y(-52)], R[0]);
  poly([X(-6), Y(-45), X(6), Y(-45), X(4), Y(-55), X(-2), Y(-61), X(-7), Y(-52)], R[1]);
  disc(X(3), Y(-50), 3.2, flash ? WHITE : st(2, 1, 1));
  pset(X(3), Y(-51), st(7, 1, 0)); pset(X(5), Y(-51), st(7, 1, 0));
  poly([X(0), Y(-48), X(7), Y(-48), X(5), Y(-33), X(2), Y(-36)], st(5, 5, 5));
  line(X(3), Y(-47), X(4), Y(-36), st(7, 7, 7));
  // casting arm
  const hand = casting ? [14, -50] : [9, -31];
  chain([[X(5), Y(-41), X(hand[0]), Y(hand[1]), 3, 2.4]], R);
  disc(X(hand[0] + 1), Y(hand[1]), 1.6, st(5, 4, 3));
  if (casting) { disc(X(hand[0] + 2), Y(hand[1]), 2 + (d.st % 4 > 1 ? 1 : 0), glow); }
  if (layer) {
    tgt = save;
    for (let i = 0; i < W * H; i++) if (layer[i] !== screen[i] && Math.random() < fade) screen[i] = layer[i];
  }
}

function drawPrincess(p) {
  const f = p.facing, X = lx => p.x + lx * f, Y = ly => GROUND + ly;
  const kneel = p.state === 'kneel' ? Math.min(1, p.t / 20) : 0;
  const drop = kneel * 12;
  const sway = p.state === 'walk' ? Math.sin(p.t * 0.3) * 1.5 : 0;
  const DRESS = pal([3, 0, 2], [5, 2, 4], [6, 4, 5], [7, 6, 7]), SK = pal(...SKIN), HR = pal(...HAIR.blond);
  if (p.state === 'chained') {
    line(X(-6), Y(-62), X(-9), Y(-74), st(3, 3, 3)); line(X(6), Y(-62), X(9), Y(-74), st(3, 3, 3));
    chain([[X(-3), Y(-34), X(-6), Y(-62), 1.4, 1.2], [X(3), Y(-34), X(6), Y(-62), 1.4, 1.2]], SK);
  }
  const hem = 9 + kneel * 4;
  poly([X(-hem + sway), Y(0), X(hem + sway), Y(0), X(4), Y(-24 + drop), X(-4), Y(-24 + drop)], DRESS[0]);
  poly([X(-hem + 1 + sway), Y(-1), X(hem - 1 + sway), Y(-1), X(3), Y(-23 + drop), X(-3), Y(-23 + drop)], DRESS[1]);
  poly([X(sway), Y(-1), X(hem - 2 + sway), Y(-1), X(3), Y(-22 + drop), X(0), Y(-22 + drop)], DRESS[2]);
  chain([[X(0), Y(-24 + drop), X(0.5), Y(-34 + drop), 3.4, 3.8]], DRESS);
  chain([[X(-2), Y(-41 + drop), X(-3), Y(-26 + drop), 3, 2]], HR);
  chain([[X(1), Y(-34 + drop), X(1), Y(-36 + drop), 1.4, 1.4], [X(1.5), Y(-39 + drop), X(1.5), Y(-39 + drop), 3.6, 3.6]], SK);
  chain([[X(0), Y(-41.5 + drop), X(-1.5), Y(-39 + drop), 2.6, 2.6]], HR);
  pset(X(3), Y(-40 + drop), st(1, 0, 2));
  if (p.state !== 'chained') chain([[X(2), Y(-33 + drop), X(5), Y(-25 + drop), 1.2, 1.1]], SK);
}

function drawBolt(b) {
  const flick = (b.t >> 1) & 1;
  disc(b.x, b.y, 4.5, st(6, 1, 0)); disc(b.x, b.y, 3.2, flick ? st(7, 5, 0) : st(7, 4, 2)); disc(b.x, b.y, 1.6, st(7, 7, 6));
}

// ---------------------------------------------------------------------------
// Backdrops (built once per arena into bgBuf), HUD panel included
// ---------------------------------------------------------------------------
const bgBuf = new Uint32Array(W * H);
function withTarget(buf, fn) { const p = tgt; tgt = buf; fn(); tgt = p; }
function gradient(y0, y1, cols) {
  for (let y = y0; y < y1; y++) {
    const f = (y - y0) / (y1 - y0) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(f)), fr = f - i;
    for (let x = 0; x < W; x++) tgt[y * W + x] = dith(x, y, fr) ? cols[i + 1] : cols[i];
  }
}
function ridge(R, y0, amp, col, yEnd, freq = 1, edge) {
  const ph = [R() * 6, R() * 6, R() * 6];
  for (let x = 0; x < W; x++) {
    const h = y0 + amp * (Math.sin(x * 0.013 * freq + ph[0]) * 0.5 + Math.sin(x * 0.037 * freq + ph[1]) * 0.3 + Math.sin(x * 0.11 * freq + ph[2]) * 0.2);
    const y = Math.max(0, Math.floor(h));
    for (let yy = y; yy < yEnd; yy++) tgt[yy * W + x] = col;
    if (edge != null) pset(x, y, edge);
  }
}
function blob(R, x, y, r, c) {
  disc(x, y, r, c[0]);
  disc(x - r * 0.2, y - r * 0.25, r * 0.78, c[1]);
  const hx = x - r * 0.35, hy = y - r * 0.4, hr = r * 0.48;
  for (let yy = Math.floor(hy - hr); yy <= hy + hr; yy++) for (let xx = Math.floor(hx - hr); xx <= hx + hr; xx++) {
    const d = Math.hypot(xx + 0.5 - hx, yy + 0.5 - hy) / hr;
    if (d < 1 && dith(xx, yy, 1 - d)) pset(xx, yy, c[2]);
  }
  for (let k = 0; k < r * 4; k++) {
    const a = R() * 6.28, rr = R() * r;
    pset(x + Math.cos(a) * rr, y + Math.sin(a) * rr, c[R() < 0.6 ? 0 : 3]);
  }
}
function trunk(R, x, w, y0, y1, c) {
  const streak = []; for (let i = -40; i <= 40; i++) streak.push(R());
  for (let y = y0; y < y1; y++) {
    const flare = y > y1 - 14 ? (y - (y1 - 14)) * 0.6 : 0, hw = w + flare;
    for (let dx = -Math.floor(hw); dx <= hw; dx++) {
      const s = dx / hw;
      let i = s < -0.5 ? 3 : s < 0.1 ? 2 : s < 0.65 ? 1 : 0;
      if (streak[(dx + 40) | 0] < 0.25 && ((y * 3 + dx) % 7) < 4) i = Math.max(0, i - 1);
      if (i > c.length - 1) i = c.length - 1;
      pset(x + dx, y, c[i]);
    }
  }
}
function stone(R, x, y, w, h, jag) {
  const pts = [x + R() * 2, y + (jag ? R() * 8 : R() * 2), x + w * 0.5, y + (jag ? -R() * 4 : 0), x + w - R() * 2, y + (jag ? R() * 10 : R() * 2), x + w, y + h, x, y + h];
  poly(pts, st(1, 1, 1));
  const inner = pts.map((v, i) => i % 2 === 0 ? (v < x + w / 2 ? v + 1 : v - 1) : (v < y + h / 2 ? v + 1 : v));
  poly(inner, st(3, 3, 3));
  for (let yy = y; yy < y + h; yy++) for (let xx = x + 1; xx < x + w - 1; xx++) {
    const i = yy * W + xx; if (xx < 0 || xx >= W || yy < 0 || yy >= H || tgt[i] !== st(3, 3, 3)) continue;
    const s = (xx - x) / w;
    if (s < 0.28 && dith(xx, yy, 0.7)) tgt[i] = st(4, 4, 4);
    else if (s > 0.72 && dith(xx, yy, 0.6)) tgt[i] = st(2, 2, 2);
    if (R() < 0.08) tgt[i] = R() < 0.5 ? st(2, 2, 2) : st(5, 5, 4);
    if (yy > y + h - 10 && R() < 0.25 * (yy - (y + h - 10)) / 10) tgt[i] = st(1, 3, 1);
  }
  let cx = x + w * (0.3 + R() * 0.4), cy = y + 4;
  for (let k = 0; k < 6; k++) { const nx = cx + (R() - 0.5) * 6, ny = cy + 3 + R() * 5; line(cx, cy, nx, ny, st(1, 1, 1)); cx = nx; cy = ny; }
}
function speckleGround(R, y0, cols, n) {
  for (let i = 0; i < n; i++) { const x = R() * W, y = y0 + R() * (H - y0); pset(x, y, cols[(R() * cols.length) | 0]); }
}
function hudPanel(R) {
  for (let y = 0; y < HUD_H; y++) for (let x = 0; x < W; x++) {
    const r = R();
    tgt[y * W + x] = r < 0.12 ? st(3, 3, 3) : r < 0.2 ? st(1, 1, 1) : st(2, 2, 2);
  }
  rect(0, 0, W, 1, st(4, 4, 3)); rect(0, HUD_H - 2, W, 1, st(4, 4, 3)); rect(0, HUD_H - 1, W, 1, BLACK);
  for (let i = 0; i < 6; i++) { orbSocket(20 + i * 10, 17); orbSocket(300 - i * 10, 17); }
  rect(140, 2, 40, 20, st(1, 1, 1)); rect(141, 3, 38, 18, st(0, 0, 0));
}
function orbSocket(x, y) { disc(x, y, 4.6, st(1, 0, 0)); disc(x, y, 3.6, st(0, 0, 0)); }

function buildArena(n) {
  withTarget(bgBuf, () => {
    const R = rng(1000 + n * 77);
    hudPanel(R);
    if (n === 0) {      // forest glade
      gradient(HUD_H, 126, pal([0, 0, 2], [1, 1, 3], [1, 2, 4], [2, 3, 5], [3, 4, 5], [4, 5, 5]));
      ridge(R, 112, 10, st(1, 2, 3), 172);
      ridge(R, 128, 7, st(1, 2, 2), 172, 1.6);
      for (let i = 0; i < 9; i++) trunk(R, R() * W, 1.5 + R() * 1.5, HUD_H, 168, pal([1, 1, 1], [1, 1, 2], [2, 2, 2]));
      const dark = pal([0, 1, 0], [0, 2, 1], [1, 2, 1], [1, 3, 1]), lite = pal([0, 1, 0], [1, 3, 0], [2, 4, 1], [4, 5, 2]);
      for (let i = 0; i < 50; i++) blob(R, R() * W, HUD_H + R() * 28, 6 + R() * 9, dark);
      for (const [x, w] of [[18, 9], [98, 5], [214, 6], [298, 11]]) trunk(R, x, w, HUD_H, 174, pal([1, 0, 0], [2, 1, 0], [3, 2, 1], [4, 3, 1]));
      for (let i = 0; i < 46; i++) blob(R, R() * W, HUD_H - 4 + R() * 30, 6 + R() * 9, lite);
      for (let i = 0; i < 30; i++) blob(R, R() * W, 163 + R() * 7, 4 + R() * 6, R() < 0.5 ? dark : lite);
      gradient(168, 200, pal([1, 3, 0], [2, 3, 0], [3, 3, 1], [3, 2, 1], [4, 3, 1], [4, 3, 2]));
      speckleGround(R, 170, pal([2, 1, 0], [5, 4, 2], [2, 4, 0], [3, 2, 1]), 900);
      for (let i = 0; i < 70; i++) { const x = R() * W, y = 168 + R() * 6; line(x, y, x + (R() - 0.5) * 3, y - 2 - R() * 3, R() < 0.5 ? st(2, 5, 1) : st(1, 3, 0)); }
      for (let i = 0; i < 14; i++) { const x = R() * W, y = 190 + R() * 9; disc(x, y, 1 + R() * 2, st(2, 2, 2)); pset(x - 1, y - 1, st(5, 5, 5)); }
    } else if (n === 1) { // wasteland & standing stones
      gradient(HUD_H, 134, pal([1, 0, 2], [2, 0, 2], [4, 1, 2], [6, 2, 1], [7, 4, 1], [7, 6, 2]));
      for (let y = 80; y < 128; y++) for (let x = 200; x < 270; x++) {
        const d = Math.hypot(x - 234, y - 104);
        if (d < 15) pset(x, y, st(7, 7, 5)); else if (d < 22 && dith(x, y, (22 - d) / 7)) pset(x, y, st(7, 6, 3));
      }
      ridge(R, 104, 22, st(2, 0, 2), 172, 0.8, st(3, 1, 3));
      ridge(R, 126, 14, st(3, 1, 1), 172, 1.3, st(5, 2, 1));
      ridge(R, 144, 8, st(4, 2, 1), 172, 2, st(5, 3, 1));
      stone(R, 24, 98, 16, 74); stone(R, 64, 98, 16, 74); stone(R, 18, 88, 68, 12);
      stone(R, 248, 122, 18, 50, true); stone(R, 290, 108, 16, 64, true); stone(R, 150, 150, 10, 22, true);
      gradient(168, 200, pal([5, 3, 1], [5, 3, 2], [4, 3, 1], [4, 2, 1], [3, 2, 1]));
      speckleGround(R, 170, pal([3, 2, 1], [6, 4, 2], [2, 1, 0], [5, 4, 3]), 1100);
      for (let i = 0; i < 18; i++) { const x = R() * W, y = 176 + R() * 22, r = 1 + R() * 2.5; disc(x, y, r, st(2, 2, 2)); disc(x - 0.5, y - 0.5, r * 0.6, st(4, 4, 4)); }
    } else {            // Drax's lair
      rect(0, HUD_H, W, 170 - HUD_H, st(1, 1, 1));
      const bricks = pal([3, 2, 1], [2, 1, 1], [3, 3, 3], [4, 3, 2], [2, 2, 2], [3, 2, 2]);
      for (let row = 0, y = HUD_H; y < 168; y += 8, row++) {
        for (let x = -(row % 2) * 10; x < W; x += 20) {
          const c = bricks[(R() * bricks.length) | 0];
          rect(x + 1, y + 1, 18, 6, c); rect(x + 1, y + 1, 18, 1, mix(c, st(6, 6, 5))); rect(x + 1, y + 6, 18, 1, halve(c));
          for (let k = 0; k < 6; k++) pset(x + 2 + R() * 16, y + 2 + R() * 4, halve(c));
        }
      }
      for (let y = HUD_H; y < HUD_H + 44; y++) for (let x = 0; x < W; x++) if (dith(x, y, 1 - (y - HUD_H) / 44)) pset(x, y, BLACK);
      disc(160, 104, 27, st(4, 4, 3)); rect(133, 104, 54, 66, st(4, 4, 3));
      disc(160, 104, 23, BLACK); rect(137, 104, 46, 66, BLACK);
      for (const tx of [74, 246]) {
        for (let y = 70; y < 140; y++) for (let x = tx - 34; x < tx + 34; x++) {
          const d = Math.hypot(x - tx, y - 100) / 34;
          if (d < 1 && dith(x, y, (1 - d) * 0.6)) pset(x, y, mix(bgBufAt(x, y), st(7, 4, 1)));
        }
        rect(tx - 2, 104, 4, 10, st(1, 1, 1)); rect(tx - 4, 102, 8, 3, st(3, 2, 1));
      }
      for (const px of [0, 306]) { rect(px, HUD_H, 14, 144, st(2, 2, 2)); rect(px + 2, HUD_H, 4, 144, st(4, 4, 4)); rect(px + 11, HUD_H, 3, 144, st(1, 1, 1)); }
      gradient(168, 200, pal([2, 2, 2], [2, 2, 2], [3, 3, 2], [3, 3, 3]));
      for (const y of [168, 172, 178, 186, 197]) rect(0, y, W, 1, st(1, 1, 1));
      for (let x0 = -200; x0 < 520; x0 += 40) line(x0, 199, 160 + (x0 - 160) * 0.55, 168, st(1, 1, 1));
      speckleGround(R, 170, pal([1, 1, 1], [4, 4, 3]), 500);
    }
  });
}
function bgBufAt(x, y) { return bgBuf[y * W + x]; }

function drawTorches() {
  for (const tx of [74, 246]) {
    const j = () => (Math.random() - 0.5) * 2;
    disc(tx + j() * 0.5, 98 + j(), 4.5, st(6, 2, 0));
    disc(tx + j() * 0.5, 96 + j(), 3, st(7, 5, 0));
    disc(tx, 98, 1.6, st(7, 7, 5));
    if (Math.random() < 0.5) pset(tx + j() * 3, 90 + j() * 2, st(7, 4, 0));
  }
}

// ---------------------------------------------------------------------------
// Input: keyboard, gamepads, touch
// ---------------------------------------------------------------------------
const keys = new Set();
const pressed = new Set();
const KEYSET_A = { up: ['KeyW'], down: ['KeyS', 'KeyX'], left: ['KeyA'], right: ['KeyD'], ul: ['KeyQ'], ur: ['KeyE'], dl: ['KeyZ'], dr: ['KeyC'], fire: ['Space', 'KeyF', 'ShiftLeft'] };
const KEYSET_B = { up: ['ArrowUp', 'Numpad8'], down: ['ArrowDown', 'Numpad2', 'Numpad5'], left: ['ArrowLeft', 'Numpad4'], right: ['ArrowRight', 'Numpad6'],
  ul: ['Numpad7'], ur: ['Numpad9'], dl: ['Numpad1'], dr: ['Numpad3'], fire: ['Enter', 'NumpadEnter', 'ControlRight', 'Numpad0', 'ShiftRight'] };
const GAME_KEYS = new Set(Object.values(KEYSET_A).concat(Object.values(KEYSET_B)).flat());
addEventListener('keydown', e => {
  sndInit();
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readKeys(set) {
  const any = a => a.some(k => keys.has(k));
  let x = 0, y = 0;
  if (any(set.left)) x--; if (any(set.right)) x++; if (any(set.up)) y--; if (any(set.down)) y++;
  if (any(set.ul)) { x = -1; y = -1; } if (any(set.ur)) { x = 1; y = -1; }
  if (any(set.dl)) { x = -1; y = 1; } if (any(set.dr)) { x = 1; y = 1; }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), fire: any(set.fire) };
}
function readPad(i) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = pads && pads[i];
  if (!p) return null;
  const b = n => p.buttons[n] && p.buttons[n].pressed;
  let x = 0, y = 0;
  if ((p.axes[0] || 0) < -0.4 || b(14)) x = -1; if ((p.axes[0] || 0) > 0.4 || b(15)) x = 1;
  if ((p.axes[1] || 0) < -0.4 || b(12)) y = -1; if ((p.axes[1] || 0) > 0.4 || b(13)) y = 1;
  return { x, y, fire: b(0) || b(1) || b(2) || b(3), start: b(9) };
}
const touch = { x: 0, y: 0, fire: false, tapped: false };
function merge(...ins) {
  const o = { x: 0, y: 0, fire: false };
  for (const i of ins) if (i) { if (i.x) o.x = i.x; if (i.y) o.y = i.y; o.fire = o.fire || i.fire; }
  return o;
}
let padPrev = [false, false];
function humanInput(id) {
  if (G.mode === 2) return id === 0 ? merge(readKeys(KEYSET_A), readPad(0), touch) : merge(readKeys(KEYSET_B), readPad(1));
  return merge(readKeys(KEYSET_A), readKeys(KEYSET_B), readPad(0), touch);
}
function anyFirePressed() {
  let hit = [...pressed].some(k => KEYSET_A.fire.includes(k) || KEYSET_B.fire.includes(k));
  for (let i = 0; i < 2; i++) { const p = readPad(i); const f = !!(p && (p.fire || p.start)); if (f && !padPrev[i]) hit = true; padPrev[i] = f; }
  if (touch.tapped) { hit = true; }
  return hit;
}

(function setupTouch() {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  document.body.classList.add('touch');
  const stick = document.getElementById('stick'), knob = document.getElementById('knob'), fire = document.getElementById('fire');
  let sid = null;
  const upd = e => {
    const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), m = Math.min(d, 44);
    knob.style.transform = d ? `translate(${dx / d * m}px, ${dy / d * m}px)` : '';
    if (d < 16) { touch.x = 0; touch.y = 0; return; }
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const dirs = { 0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0], '-4': [-1, 0], '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1] };
    [touch.x, touch.y] = dirs[a];
  };
  stick.addEventListener('pointerdown', e => { sndInit(); sid = e.pointerId; stick.setPointerCapture(sid); upd(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) upd(e); });
  const end = e => { if (e.pointerId === sid) { sid = null; touch.x = touch.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  fire.addEventListener('pointerdown', e => { sndInit(); e.preventDefault(); touch.fire = true; touch.tapped = true; fire.classList.add('on'); });
  const fu = () => { touch.fire = false; fire.classList.remove('on'); };
  fire.addEventListener('pointerup', fu); fire.addEventListener('pointercancel', fu); fire.addEventListener('pointerleave', fu);
  canvas.addEventListener('pointerdown', () => { sndInit(); touch.tapped = true; });
})();

// ---------------------------------------------------------------------------
// Fighters
// ---------------------------------------------------------------------------
const FREE = new Set(['idle', 'walk', 'walkB', 'crouch', 'blockH', 'blockL']);
const NOIN = { x: 0, y: 0, fire: false };
const MOVE_INPUT = { overhead: [0, -1], neck: [1, -1], headbutt: [-1, -1], body: [1, 0], flying: [-1, 0], legchop: [1, 1], web: [-1, 1], kick: [0, 1] };

function newFighter(id, x, facing, lk) {
  const f = { id, x, yOff: 0, facing, hp: 12, state: 'idle', st: 0, pose: Object.assign({}, IDLE), look: lk, cpu: null,
    fireHeld: 0, attackId: 0, hitDone: false, atk: null, jvx: 0, headless: false, bleed: 0 };
  play(f, 'idle');
  f.W = worldJ(f);
  return f;
}
function play(f, name) {
  const a = ANIMS[name];
  f.anim = a; f.k = 0; f.kt = 0; f.done = false; f.from = normFrom(f.pose, a.keys[0].p);
}
function setState(f, s, anim) { f.state = s; f.st = 0; play(f, anim || s); }
function stepAnim(f) {
  const a = f.anim;
  if (f.done) return true;
  const key = a.keys[f.k];
  f.kt++;
  if (key.mv) f.x += f.facing * key.mv / key.d;
  const t = Math.min(1, f.kt / key.d);
  f.pose = lerpPose(f.from, key.p, a.lin ? t : ease(t));
  if (f.kt >= key.d) {
    if (key.act) resolveAttack(f, key);
    if (key.sfx) sfx(key.sfx, f.id ? 0.85 : 1);
    f.k++; f.kt = 0;
    if (f.k >= a.keys.length) {
      if (a.loop) { f.k = 0; f.from = key.p; }
      else { f.k = a.keys.length - 1; f.kt = key.d; f.done = true; f.from = key.p; return true; }
    } else f.from = a.keys[f.k].norm ? normFrom(key.p, a.keys[f.k].p) : key.p;
  }
  return false;
}

const isLow = f => f.state === 'crouch' || f.state === 'roll' || (f.state === 'attack' && f.atk.low);
const isAir = f => f.state === 'jump' && f.yOff < -12;
const canBeHit = f => f && !f.kind && !['down', 'dying', 'dead'].includes(f.state);
function oppOf(f) { return G.drax || G.f[1 - f.id]; }

function startAttack(f, name) {
  f.atk = ANIMS[name]; f.hitDone = false; f.attackId++;
  setState(f, 'attack', name);
}

function control(f, inp) {
  const fwd = inp.x * f.facing, y = inp.y;
  if (inp.fire) {
    f.fireHeld++;
    let mv = null;
    if (y < 0) mv = fwd > 0 ? 'neck' : fwd < 0 ? 'headbutt' : 'overhead';
    else if (y > 0) mv = fwd > 0 ? 'legchop' : fwd < 0 ? 'web' : 'kick';
    else if (fwd > 0) mv = 'body';
    else if (fwd < 0) mv = 'flying';
    else if (f.fireHeld >= 8) mv = 'body';
    if (mv) { f.fireHeld = 0; return startAttack(f, mv); }
    return free(f, 'idle');
  }
  f.fireHeld = 0;
  if (y < 0 && fwd < 0) return free(f, 'blockH');
  if (y > 0 && fwd < 0) return free(f, 'blockL');
  if (y > 0 && fwd > 0) return setState(f, 'roll');
  if (y > 0) return free(f, 'crouch');
  if (y < 0) { f.jvx = fwd > 0 ? f.facing * 1.1 : 0; return setState(f, 'jump'); }
  if (fwd > 0) return free(f, 'walk');
  if (fwd < 0) return free(f, 'walkB');
  free(f, 'idle');
}
function free(f, s) { if (f.state !== s) setState(f, s); }

function updateFighter(f, o, inp) {
  f.st++;
  if (FREE.has(f.state)) {
    if (o && Math.abs(o.x - f.x) > 1) f.facing = o.x > f.x ? 1 : -1;
    control(f, inp || NOIN);
  }
  const done = stepAnim(f);
  switch (f.state) {
    case 'walk': f.x += f.facing * 1.25; break;
    case 'walkB': f.x -= f.facing * 1.0; break;
    case 'jump': {
      const t = f.st;
      f.yOff = t >= 4 && t <= 30 ? -Math.sin(Math.PI * (t - 4) / 26) * 30 : 0;
      if (t >= 4 && t <= 30) f.x += f.jvx;
      if (done) setState(f, 'idle');
      break;
    }
    case 'roll':
      if (f.st >= 4 && f.st <= 28) f.x += f.facing * 2.3;
      rollCheck(f, o);
      if (done) { f.pose.rot = 0; setState(f, 'idle'); }
      break;
    case 'attack': case 'hit': case 'down': case 'busy': if (done) setState(f, 'idle'); break;
    case 'dying': if (done) f.state = 'dead'; break;
  }
  if (f.state !== 'jump' && f.yOff < 0) f.yOff = Math.min(0, f.yOff + 3);
  f.W = worldJ(f);
  if (f.bleed > 0) {
    f.bleed--;
    const n = f.W.neck;
    for (let i = 0; i < 2; i++) G.parts.push({ x: n[0], y: n[1], vx: rnd(-0.7, 0.7) - f.facing * 0.4, vy: rnd(-3.6, -1.6), g: 0.22, life: 80, c: [RED, st(5, 0, 0), st(7, 1, 1)][i], stain: true });
  }
}

function rollCheck(f, o) {
  if (!o || o.kind || f.st < 4 || f.st > 26) return;
  const d = (o.x - f.x) * f.facing;
  if (d > 0 && d < 22 && canBeHit(o) && !isLow(o) && !isAir(o)) {
    f.pose.rot = 0; f.state = 'busy'; f.st = 0; play(f, 'rollStop');
    G.score[f.id] += 100;
    damage(o, 1, f, 'down', o.x, GROUND - 20, true);
  }
}

function resolveAttack(att, key) {
  if (att.hitDone || !att.atk) return;
  const a = att.atk, def = oppOf(att);
  if (!def) return;
  const dist = (def.x - att.x) * att.facing;
  if (dist < a.reach[0] || dist > a.reach[1]) return;
  if (def.kind === 'drax') return hitDrax(att, def);
  if (!canBeHit(def)) return;
  const zone = key.zone || a.zone;
  if (zone === 'high' && isLow(def) && !a.hitsLow) return;
  if (zone === 'low' && isAir(def)) return;
  if (zone === 'mid' && def.state === 'roll') return;
  att.hitDone = true;
  const cx = def.x - att.facing * 5, cy = GROUND + def.yOff - (zone === 'high' ? 52 : zone === 'mid' ? 36 : 12);
  const facesAtt = def.facing === -att.facing;
  const blocked = facesAtt && ((zone === 'high' && def.state === 'blockH') || (zone !== 'high' && def.state === 'blockL'));
  if (blocked) {
    sfx('clang', 0.9 + Math.random() * 0.2); sparks(cx, cy, 14);
    att.x -= att.facing * 3; def.x += att.facing * 3; G.score[def.id] += 10;
    return;
  }
  G.freeze = 3;
  G.score[att.id] += a.pts;
  if (a.decap) return decapitate(def, att);
  damage(def, a.dmg, att, a.knock, cx, cy);
}

function damage(def, n, att, knock, cx, cy, noBlood) {
  def.hp = Math.max(0, def.hp - n);
  G.snake[def.id] = { t: 36, orb: Math.min(5, def.hp >> 1) };
  if (!noBlood) blood(cx, cy, att ? att.facing : 1, 8 + n * 5);
  if (def.hp <= 0) { setState(def, 'dying', 'die'); sfx('chop'); sfx('scream', def.id ? 0.85 : 1); return; }
  sfx(noBlood ? 'thud' : 'chop'); sfx('grunt', def.id ? 0.85 : 1);
  if (knock === 'down') setState(def, 'down', 'knock');
  else setState(def, 'hit', knock === 'big' ? 'hitBig' : 'hit');
}

function decapitate(def, att) {
  def.hp = 0; def.headless = true; def.bleed = 60;
  G.snake[def.id] = { t: 36, orb: 0 };
  const h = def.W.head;
  G.heads.push({ x: h[0], y: h[1], vx: att.facing * rnd(1.2, 2.2), vy: -4.4, ang: def.pose.he, spin: -att.facing * def.facing * 14, facing: def.facing, look: def.look, t: 0 });
  setState(def, 'dying', 'decap');
  blood(h[0], h[1] + 4, att.facing, 36);
  G.freeze = 7;
  sfx('chop'); sfx('squelch');
}

function blood(x, y, dir, n) {
  for (let i = 0; i < n; i++) G.parts.push({ x: x + rnd(-2, 2), y: y + rnd(-3, 3), vx: dir * rnd(0.2, 2.4) + rnd(-0.5, 0.5), vy: rnd(-3, 0.5), g: 0.2, life: 90, c: [RED, st(5, 0, 0), st(7, 1, 1)][i % 3], stain: true });
}
function sparks(x, y, n, cols) {
  cols = cols || [WHITE, st(7, 7, 3), st(7, 5, 0)];
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = rnd(0.8, 3); G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, g: 0.08, life: rnd(8, 18) | 0, c: cols[i % cols.length] }); }
}

function separate() {
  const [a, b] = G.f;
  if (!a || !b) return;
  const solid = f => !['roll', 'dying', 'dead', 'down'].includes(f.state) && f.yOff > -12;
  if (!solid(a) || !solid(b)) return;
  const dx = b.x - a.x, d = Math.abs(dx);
  if (d < 22) { const s = dx >= 0 ? 1 : -1, p = (22 - d) / 2; a.x -= s * p; b.x += s * p; }
}

// ---------------------------------------------------------------------------
// Computer opponent
// ---------------------------------------------------------------------------
class CPU {
  constructor(d) { this.d = d; this.hold = 0; this.inp = NOIN; this.seen = -1; }
  out(f, fwd, y, fire, hold) { this.inp = { x: fwd * f.facing, y, fire }; this.hold = hold | 0; return this.inp; }
  think(f, o) {
    if (!FREE.has(f.state)) { this.hold = 0; return (this.inp = NOIN); }
    if (this.hold > 0) { this.hold--; return this.inp; }
    const d = this.d, dist = Math.abs(o.x - f.x);
    // react to an incoming blow
    if (!o.kind && o.state === 'attack' && o.attackId !== this.seen && o.st >= Math.round(12 - 9 * d)) {
      this.seen = o.attackId;
      const a = o.atk;
      if (!o.hitDone && o.k <= a.act && dist <= a.reach[1] + 8 && Math.random() < 0.15 + 0.7 * d) {
        const r = Math.random();
        if (a.zone === 'high') return a.hitsLow || r < 0.55 ? this.out(f, -1, -1, false, 18) : this.out(f, 0, 1, false, 18);
        if (a.zone === 'mid') return this.out(f, -1, 1, false, 18);
        return r < 0.6 ? this.out(f, 0, -1, false, 4) : this.out(f, -1, 1, false, 18);
      }
    }
    const vuln = !o.kind && (o.state === 'hit' || o.state === 'busy' || (o.state === 'attack' && (o.hitDone || o.k > o.atk.act)));
    if (dist > 75) return Math.random() < 0.05 + 0.05 * d ? this.out(f, 1, 1, false, 2) : this.out(f, 1, 0, false, rnd(8, 16));
    if (dist > 52) return this.out(f, 1, 0, false, rnd(3, 9));
    if (Math.random() < 0.16 + 0.42 * d + (vuln ? 0.45 : 0)) {
      const [x, y] = MOVE_INPUT[this.pick(dist)];
      return this.out(f, x, y, true, 2);
    }
    const r = Math.random();
    if (dist < 24 && r < 0.5) return this.out(f, -1, 0, false, rnd(6, 12));
    if (r < 0.14) return this.out(f, -1, 0, false, 6);
    if (r < 0.26) return this.out(f, 1, 0, false, 4);
    if (r < 0.32) return this.out(f, -1, -1, false, 10);
    return this.out(f, 0, 0, false, rnd(4, 18 - 12 * d));
  }
  pick(dist) {
    const w = { kick: 1, headbutt: 0.7, body: 1.2, legchop: 1, neck: 1, overhead: 1, web: 0.8, flying: 0.3 + this.d * 0.9 };
    const opts = [];
    let tot = 0;
    for (const k in w) { const r = ANIMS[k].reach; if (dist >= r[0] && dist <= r[1] - 4) { opts.push([k, w[k]]); tot += w[k]; } }
    if (!opts.length) return 'body';
    let x = Math.random() * tot;
    for (const [k, v] of opts) { x -= v; if (x <= 0) return k; }
    return opts[0][0];
  }
}

// ---------------------------------------------------------------------------
// Drax & the princess
// ---------------------------------------------------------------------------
function hitDrax(att, d) {
  if (d.state === 'tele' || d.state === 'die' || d.state === 'gone' || d.state === 'hurt') return;
  att.hitDone = true;
  d.hp--; d.flash = 24; G.freeze = 5;
  G.score[att.id] += 1000;
  sparks(d.x, GROUND - 40, 24, [st(7, 2, 7), st(5, 1, 7), WHITE]);
  sfx('chop'); sfx('magic');
  if (d.hp <= 0) { d.state = 'die'; d.st = 0; sfx('scream', 0.6); sfx('boom'); G.bolts = []; }
  else { d.state = 'hurt'; d.st = 0; }
}
function updateDrax() {
  const d = G.drax, p = G.f[0];
  d.st++; d.t++;
  if (d.flash > 0) d.flash--;
  if (d.state !== 'die') d.facing = p.x < d.x ? -1 : 1;
  switch (d.state) {
    case 'idle':
      d.cd--;
      if (Math.abs(p.x - d.x) < 36 && d.st > 30 && Math.random() < 0.03) { d.state = 'tele'; d.st = 0; sfx('magic'); break; }
      if (d.cd <= 0 && G.scene === 'fight') { d.state = 'cast'; d.st = 0; d.high = Math.random() < 0.5; }
      break;
    case 'cast':
      if (d.st === 16) { G.bolts.push({ x: d.x + d.facing * 16, y: d.high ? GROUND - 52 : GROUND - 11, vx: d.facing * 2.7, t: 0, high: d.high }); sfx('zap'); }
      if (d.st >= 28) { d.state = 'idle'; d.st = 0; d.cd = rnd(40, 95) | 0; }
      break;
    case 'hurt': if (d.st >= 20) { d.state = 'tele'; d.st = 0; sfx('magic'); } break;
    case 'tele':
      if (d.st === 20) d.x = p.x < 160 ? rnd(240, 290) : rnd(30, 80);
      if (d.st >= 40) { d.state = 'idle'; d.st = 0; d.cd = 30; }
      break;
    case 'die':
      if (d.st % 3 === 0) sparks(d.x + rnd(-10, 10), GROUND - rnd(5, 60), 6, [st(7, 2, 7), st(7, 7, 3), WHITE, st(7, 3, 0)]);
      if (d.st >= 90) d.state = 'gone';
      break;
  }
}
function updateBolts() {
  const p = G.f[0];
  for (const b of G.bolts) {
    b.t++; b.x += b.vx;
    if (b.t % 2 === 0) G.parts.push({ x: b.x - b.vx * 2, y: b.y + rnd(-2, 2), vx: -b.vx * 0.2, vy: rnd(-0.4, 0.4), g: 0, life: 10, c: [st(7, 4, 0), st(6, 1, 0), st(7, 7, 3)][(b.t >> 1) % 3] });
    if (b.dead || !canBeHit(p) || Math.abs(b.x - p.x) > 8) continue;
    if (b.high && isLow(p)) continue;
    if (!b.high && isAir(p)) continue;
    b.dead = true;
    const facing = p.facing === -Math.sign(b.vx);
    if (facing && ((b.high && p.state === 'blockH') || (!b.high && p.state === 'blockL'))) { sparks(b.x, b.y, 16, [st(7, 4, 0), st(7, 7, 3), WHITE]); sfx('clang', 1.3); continue; }
    sparks(b.x, b.y, 12, [st(7, 4, 0), st(7, 7, 3)]); sfx('zap');
    damage(p, 2, { facing: Math.sign(b.vx) }, null, b.x, b.y, true);
  }
  G.bolts = G.bolts.filter(b => !b.dead && b.x > -20 && b.x < W + 20);
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
const G = { scene: 'boot', t: 0, st: 0, mode: 1, level: 0, round: 0, arena: 0, f: [null, null], score: [0, 0], wins: [0, 0],
  timer: 0, banner: null, goblin: null, heads: [], parts: [], bolts: [], drax: null, princess: null, freeze: 0, paused: false,
  snake: [null, null], hiscore: 0, idle: 0, page: 0, winner: null, loser: null, beat: 0 };
try { G.hiscore = +localStorage.getItem('barbarian.hiscore') || 0; } catch (e) { /* storage unavailable */ }

function toTitle() {
  G.scene = 'title'; G.st = 0; G.idle = 0; G.mode = 1; G.page = 0;
  buildArena(0); clearRound();
  G.f = [newFighter(0, 60, 1, LOOK_HERO), newFighter(1, 260, -1, LOOK_P2)];
}
function clearRound() { G.heads = []; G.parts = []; G.bolts = []; G.goblin = null; G.drax = null; G.princess = null; G.freeze = 0; G.snake = [null, null]; G.banner = null; }
function startMatch(mode) {
  G.mode = mode; G.score = [0, 0]; G.wins = [0, 0]; G.level = 0; G.round = 0;
  startRound();
}
function startRound() {
  clearRound();
  if (G.mode === 1 && G.level >= OPPONENTS.length) return startDrax();
  G.arena = G.mode === 1 ? (G.level < 4 ? 0 : 1) : G.round % 2;
  buildArena(G.arena);
  const opp = OPPONENTS[Math.min(G.level, OPPONENTS.length - 1)];
  G.f = [newFighter(0, 80, 1, LOOK_HERO), newFighter(1, 240, -1, G.mode === 1 ? opp.look : LOOK_P2)];
  if (G.mode === 1) G.f[1].cpu = new CPU(opp.d);
  if (G.mode === 0) { G.f[0].cpu = new CPU(rnd(0.4, 0.8)); G.f[1].cpu = new CPU(rnd(0.4, 0.8)); }
  G.timer = 60 * 50;
  G.banner = G.mode === 1 ? ['OPPONENT ' + (G.level + 1)] : G.mode === 2 ? ['ROUND ' + (G.round + 1)] : ['DEMO'];
  G.scene = 'intro'; G.st = 0;
}
function startDrax() {
  G.arena = 2; buildArena(2);
  G.f = [newFighter(0, 50, 1, LOOK_HERO), null];
  G.drax = { kind: 'drax', x: 262, facing: -1, hp: 3, state: 'idle', st: 0, t: 0, cd: 70, flash: 0, high: false };
  G.princess = { x: 304, facing: -1, state: 'chained', t: 0 };
  G.timer = 90 * 50;
  G.banner = ['DRAX', 'THE EVIL SORCERER'];
  G.scene = 'intro'; G.st = 0;
}
function gameOver(won) {
  if (G.mode === 1 && G.score[0] > G.hiscore) { G.hiscore = G.score[0]; try { localStorage.setItem('barbarian.hiscore', G.hiscore); } catch (e) { /* ignore */ } }
  G.scene = 'over'; G.st = 0; G.won = !!won;
}

function inputs() {
  return G.f.map(f => {
    if (!f) return NOIN;
    if (f.cpu) return f.cpu.think(f, oppOf(f));
    return humanInput(f.id);
  });
}

function fightTick() {
  if (G.freeze > 0) { G.freeze--; return; }
  G.st++;
  const ins = inputs();
  const order = Math.random() < 0.5 ? [0, 1] : [1, 0];
  for (const i of order) if (G.f[i]) updateFighter(G.f[i], oppOf(G.f[i]), ins[i]);
  if (G.drax) { updateDrax(); updateBolts(); }
  separate();
  for (const f of G.f) if (f && f.state !== 'dead') f.x = clamp(f.x, 14, 306);
  G.timer--;
  const dying = G.f.filter(f => f && (f.state === 'dying' || f.state === 'dead'));
  if (dying.length === 2) { G.banner = ['DOUBLE KO']; G.scene = 'draw'; G.st = 0; return; }
  if (dying.length === 1) {
    G.loser = dying[0]; G.winner = G.drax || G.f[1 - G.loser.id];
    G.scene = 'ko'; G.st = 0; return;
  }
  if (G.drax && G.drax.state === 'gone') { G.bolts = []; G.scene = 'ending'; G.st = 0; G.princess.state = 'walk'; G.princess.t = 0; return; }
  if (G.timer <= 0) timeUp();
}
function timeUp() {
  const [a, b] = G.f;
  if (G.drax || (b && a.hp < b.hp)) { a.hp = 0; setState(a, 'dying', 'die'); sfx('scream'); }
  else if (b && b.hp < a.hp) { b.hp = 0; setState(b, 'dying', 'die'); sfx('scream', 0.85); }
  else { G.banner = ['TIME UP', 'DRAW']; G.scene = 'draw'; G.st = 0; }
}

function koTick() {
  if (G.freeze > 0) { G.freeze--; return; }
  G.st++;
  const L = G.loser, Wn = G.winner;
  for (const f of G.f) if (f && f !== L) updateFighter(f, L, NOIN);
  updateFighter(L, null, NOIN);
  if (G.drax) { updateDrax(); G.bolts = []; }
  if (!Wn.kind && L.state === 'dead' && FREE.has(Wn.state)) { setState(Wn, 'win'); }
  if (!G.goblin && L.state === 'dead' && G.st > 50) { G.goblin = { x: -14, facing: 1, mode: 'walk', t: 0, k: 0, phase: G.heads.length ? 'toHead' : 'toBody' }; sfx('laugh'); }
  if (G.goblin) updateGoblin();
}
function updateGoblin() {
  const g = G.goblin, L = G.loser;
  g.t++;
  const walkTo = (tx, sp = 1.5) => {
    const d = tx - g.x;
    if (Math.abs(d) <= sp) { g.x = tx; return true; }
    g.facing = Math.sign(d); g.x += g.facing * sp; g.mode = 'walk'; return false;
  };
  const h = G.heads[0];
  switch (g.phase) {
    case 'toHead':
      if (!h || h.kicked) { g.phase = 'toBody'; break; }
      if (walkTo(h.x - 8)) { g.phase = 'kick'; g.k = 0; g.facing = 1; g.mode = 'kick'; }
      break;
    case 'kick':
      g.k++;
      if (g.k === 7) { h.vx = 4.4; h.vy = -5.2; h.spin = 22; h.kicked = true; sfx('thud'); }
      if (g.k > 22) g.phase = 'toBody';
      break;
    case 'toBody': {
      const gx = Math.min(L.x + L.facing * 30, L.x - L.facing * 22);
      if (walkTo(gx - 3)) { g.phase = 'grab'; g.k = 0; g.facing = -1; g.mode = 'laugh'; g.off = L.x - g.x; sfx('laugh'); }
      break;
    }
    case 'grab': if (++g.k > 22) g.phase = 'drag'; break;
    case 'drag':
      g.mode = 'drag'; g.facing = -1; g.x -= 1.1; L.x = g.x + g.off;
      if (g.x < -30 && L.x < -50) roundOver();
      break;
  }
}
function roundOver() {
  const p1won = G.winner === G.f[0];
  if (G.mode === 1) {
    if (p1won) { G.score[0] += Math.ceil(G.timer / 50) * 10 + G.f[0].hp * 50; G.level++; startRound(); }
    else gameOver(false);
  } else {
    if (!G.winner.kind) G.wins[G.winner.id]++;
    G.round++; startRound();
  }
}

function endingTick() {
  G.st++;
  const p = G.princess, hero = G.f[0];
  updateFighter(hero, p, NOIN);
  if (G.st === 50) setState(hero, 'win');
  p.t++;
  if (p.state === 'walk') {
    const tx = hero.x + 24 * (p.x > hero.x ? 1 : -1);
    p.facing = tx < p.x ? -1 : 1;
    p.x += p.facing * 0.6;
    if (Math.abs(p.x - tx) < 1) { p.state = 'kneel'; p.t = 0; p.facing = hero.x < p.x ? -1 : 1; }
  }
  if (G.st > 600 || (G.st > 300 && anyFirePressed())) gameOver(true);
}

function updateWorld() {
  for (const p of G.parts) {
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life--;
    if (p.stain && p.y >= GROUND - 1 && p.vy > 0) {
      p.life = 0;
      const sy = GROUND - 1 + Math.random() * 8;
      if (sy < H) withTarget(bgBuf, () => pset(p.x, sy, Math.random() < 0.5 ? st(4, 0, 0) : st(3, 0, 0)));
    }
  }
  G.parts = G.parts.filter(p => p.life > 0 && p.x > -10 && p.x < W + 10 && p.y < H + 10);
  for (const h of G.heads) {
    h.t++; h.vy += 0.28; h.x += h.vx; h.y += h.vy; h.ang += h.spin;
    if (h.y > GROUND - 4.5) {
      h.y = GROUND - 4.5;
      if (h.vy > 1.5) { h.vy *= -0.35; h.vx *= 0.6; h.spin *= 0.5; sfx('land'); }
      else { h.vy = 0; h.vx *= 0.9; h.spin = h.vx * 14 * h.facing; }
    }
    if (h.t < 50 && Math.random() < 0.6) G.parts.push({ x: h.x, y: h.y + 3, vx: rnd(-0.3, 0.3), vy: rnd(-0.6, 0.4), g: 0.2, life: 60, c: RED, stain: true });
  }
  G.heads = G.heads.filter(h => h.x > -40 && h.x < W + 40);
  for (let i = 0; i < 2; i++) if (G.snake[i] && --G.snake[i].t <= 0) G.snake[i] = null;
}

function tick() {
  G.t++;
  if (pressed.has('KeyM')) SND.muted = !SND.muted;
  if (G.scene !== 'boot' && G.scene !== 'title' && (pressed.has('KeyP') || pressed.has('Pause'))) G.paused = !G.paused;
  if (pressed.has('Escape') && G.scene !== 'boot') { G.paused = false; toTitle(); }
  if (G.paused) { pressed.clear(); touch.tapped = false; return; }
  switch (G.scene) {
    case 'boot':
      if (pressed.size || touch.tapped || anyFirePressed()) { sndInit(); toTitle(); }
      break;
    case 'title': titleTick(); break;
    case 'intro':
      G.st++;
      for (const f of G.f) if (f) updateFighter(f, oppOf(f), NOIN);
      if (G.drax) updateDrax();
      if (G.st >= 100) { G.scene = 'fight'; G.st = 0; G.banner = null; }
      break;
    case 'fight': fightTick(); break;
    case 'ko': koTick(); break;
    case 'draw':
      G.st++;
      for (const f of G.f) if (f) updateFighter(f, oppOf(f), NOIN);
      if (G.st > 140) startRound();
      break;
    case 'ending': endingTick(); break;
    case 'over':
      G.st++;
      if (G.st > 400 || (G.st > 80 && anyFirePressed())) toTitle();
      break;
  }
  if (G.mode === 0 && G.scene !== 'title' && G.scene !== 'boot' && G.st > 2 && (pressed.size || touch.tapped)) toTitle();
  updateWorld();
  pressed.clear(); touch.tapped = false;
}

const DRUMS = [1, 0, 0, 2, 0, 0, 1, 0, 1, 0, 2, 0, 0, 2, 2, 0];
const BASS = [1, 0, 0, 0, 1.19, 0, 0, 0, 0.89, 0, 0, 0, 1, 0, 1.06, 0];
function titleTick() {
  G.st++; G.idle++;
  for (const f of G.f) updateFighter(f, oppOf(f), NOIN);
  if (G.st % 11 === 0) {
    const s = G.beat++ % 16;
    if (DRUMS[s]) sfx('drum', DRUMS[s] === 1 ? 0.8 : 1.3);
    if (BASS[s] && (G.beat >> 4) % 2 === 1) sfx('bass', BASS[s] * 0.5);
  }
  if (G.st % 400 === 0) G.page = (G.page + 1) % 2;
  const fire = anyFirePressed();
  if (pressed.has('Digit1') || fire) return startMatch(1);
  if (pressed.has('Digit2')) return startMatch(2);
  if (pressed.has('KeyD') || G.idle > 50 * 40) return startMatch(0);
  if (pressed.size) G.idle = 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawHud() {
  for (let p = 0; p < 2; p++) {
    const f = G.f[p], hp = f ? f.hp : (p === 1 && G.drax ? G.drax.hp * 4 : 0);
    for (let i = 0; i < 6; i++) {
      const x = p === 0 ? 20 + i * 10 : 300 - i * 10, v = clamp(hp - i * 2, 0, 2);
      if (v === 0) continue;
      const red = p === 1 && G.drax ? st(5, 1, 6) : st(6, 0, 0), hi = p === 1 && G.drax ? st(7, 5, 7) : st(7, 4, 3);
      if (v === 2) { disc(x, 17, 3.5, red); disc(x - 1, 16, 1.6, mix(red, hi)); pset(x - 1, 15, hi); }
      else for (let y = -3; y <= 3; y++) for (let dx = -3; dx <= 0; dx++) if (dx * dx + y * y <= 12.25) pset(x + dx, 17 + y, red);
    }
    drawSnake(p);
  }
  const s0 = String(G.score[0]).padStart(6, '0'), s1 = G.drax ? 'DRAX' : String(G.score[1]).padStart(6, '0');
  text(s0, 16, 4, YELLOW);
  text(s1, 305 - textW(s1), 4, YELLOW);
  if (G.scene === 'title' || G.scene === 'boot' || G.scene === 'over') { text('HI', 154, 5, GREY); textS(String(G.hiscore).padStart(6, '0').slice(-5), 145, 13, YELLOW); return; }
  const secs = Math.max(0, Math.ceil(G.timer / 50));
  const tc = secs <= 10 && (G.t >> 3) & 1 ? RED : WHITE;
  text(String(secs).padStart(2, '0'), 149, 5, tc, 2);
  if (G.mode === 2) { text(String(G.wins[0]), 128, 9, GREY); text(String(G.wins[1]), 188, 9, GREY); }
}
function drawSnake(p) {
  const bx = p === 0 ? 7 : 313, dir = p === 0 ? 1 : -1;
  const SN = pal([0, 1, 0], [1, 3, 0], [2, 5, 1], [4, 6, 2]);
  const pts = [];
  for (let i = 0; i < 8; i++) pts.push([bx + Math.sin(i * 1.2 + G.t * 0.05) * 2, 23 - i * 2.2]);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2.2 - i * 0.12, 2.1 - i * 0.12]);
  let hx = pts[7][0] + dir * 2, hy = 6;
  const s = G.snake[p];
  if (s) {
    const ox = p === 0 ? 20 + s.orb * 10 : 300 - s.orb * 10, k = Math.sin(Math.PI * (36 - s.t) / 36);
    hx += (ox - hx) * k; hy += (14 - hy) * k;
  }
  segs.push([pts[7][0], pts[7][1], hx, hy, 1.5, 1.5]);
  chain(segs, SN);
  chain([[hx, hy, hx + dir * 2.5, hy + 0.5, 2.4, 1.6]], SN);
  pset(hx + dir, hy - 1, st(7, 0, 0));
  if ((G.t >> 3) & 1 || s) line(hx + dir * 4, hy + 1, hx + dir * 6, hy + (G.t & 2 ? 0 : 2), st(7, 0, 0));
}

function render() {
  screen.set(bgBuf);
  tgt = screen;
  if (G.scene === 'boot') return renderBoot();
  if (G.arena === 2) drawTorches();
  // shadows
  for (const f of G.f) if (f && f.x > -60 && f.x < W + 60) {
    const lying = ['dead', 'down'].includes(f.state) || (f.state === 'dying' && f.k >= 2);
    darken(f.x - (lying ? f.facing * 6 : 0), GROUND + 0.5, (lying ? 26 : 13) * (1 + f.yOff / 80), 2.2);
  }
  if (G.drax && G.drax.state !== 'gone') darken(G.drax.x, GROUND + 0.5, 14, 2.2);
  if (G.princess) drawPrincess(G.princess);
  if (G.drax) drawDrax(G.drax);
  const fs = G.f.filter(Boolean).sort((a, b) => rank(a) - rank(b));
  for (const f of fs) drawFighter(f);
  if (G.goblin) drawGoblin(G.goblin);
  for (const h of G.heads) drawLooseHead(h);
  for (const b of G.bolts) drawBolt(b);
  for (const p of G.parts) { pset(p.x, p.y, p.c); if (p.stain && p.life > 70) pset(p.x + 1, p.y, p.c); }
  drawHud();
  if (G.scene === 'title') renderTitle();
  if (G.scene === 'over') renderOver();
  if (G.scene === 'ending') renderEnding();
  if (G.banner) G.banner.forEach((s, i) => textC(s, 52 + i * 22, i ? YELLOW : gradFire(14), i ? 1 : 2));
  if (G.paused) textC('PAUSED', 90, WHITE, 2);
  if (SND.muted && G.t % 100 < 50) text('MUTE', 4, 190, GREY);
}
const rank = f => f.state === 'dead' || f.state === 'dying' ? 0 : f.state === 'attack' ? 2 : 1;

function renderBoot() {
  rect(0, 0, W, H, st(0, 0, 1));
  textC('BARBARIAN', 60, gradFire(28), 4, st(2, 0, 0));
  textC('A TRIBUTE TO THE ATARI ST CLASSIC', 104, GREY);
  if ((G.t >> 4) & 1) textC('PRESS ANY KEY', 140, YELLOW);
}
function renderTitle() {
  const tw = textW('BARBARIAN', 4), tx = Math.round((W - tw) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) text('BARBARIAN', tx + dx, 34 + dy, BLACK, 4);
  text('BARBARIAN', tx + 2, 36, st(2, 0, 0), 4);
  text('BARBARIAN', tx, 34, gradFire(28), 4);
  textC('THE ULTIMATE SWORD DUEL', 68, GREY);
  if (G.page === 0) {
    textC('1  ONE PLAYER', 88, WHITE);
    textC('2  TWO PLAYERS', 100, WHITE);
    textC('D  DEMO', 112, WHITE);
    if ((G.t >> 4) & 1) textC('PRESS FIRE TO BEGIN', 132, YELLOW);
  } else {
    const L = [['FIRE + UP', 'OVERHEAD CHOP'], ['FIRE + UP FWD', 'NECK CHOP'], ['FIRE + FWD', 'BODY CHOP'], ['FIRE + DOWN FWD', 'LEG CHOP'],
      ['FIRE + DOWN', 'KICK'], ['FIRE + DOWN BACK', 'WEB OF DEATH'], ['FIRE + BACK', 'FLYING NECK CHOP'], ['FIRE + UP BACK', 'HEAD BUTT'],
      ['UP BACK / DOWN BACK', 'GUARD HEAD / BODY'], ['DOWN FWD', 'ROLL']];
    L.forEach(([a, b], i) => { textS(a, 92 - textW(a) / 2 | 0, 80 + i * 9, YELLOW); textS(b, 172, 80 + i * 9, WHITE); });
  }
}
function renderOver() {
  if (G.won) {
    textC('CONGRATULATIONS', 56, gradFire(14), 2);
    textC('YOU ARE THE ULTIMATE WARRIOR', 84, WHITE);
  } else textC('GAME OVER', 60, gradFire(14), 3);
  textC('SCORE ' + G.score[0], 110, YELLOW);
  if (G.score[0] >= G.hiscore && G.score[0] > 0) textC('NEW HIGH SCORE', 124, WHITE);
}
function renderEnding() {
  if (G.st > 40) textC('DRAX IS DEFEATED', 50, gradFire(14), 2);
  if (G.st > 160) textC('THE PRINCESS IS FREE', 80, WHITE);
  if (G.st > 280) textC('SCORE ' + G.score[0], 96, YELLOW);
}

// ---------------------------------------------------------------------------
// Main loop & scaling (4:3 display, like a monitor showing the ST's low-res mode)
// ---------------------------------------------------------------------------
function resize() {
  const touchUI = document.body.classList.contains('touch');
  const availW = innerWidth - 16, availH = innerHeight - (touchUI ? 190 : 110);
  let w = Math.min(availW, availH * 4 / 3);
  if (w >= 640) w = Math.floor(w / 320) * 320;
  canvas.style.width = Math.max(320, w | 0) + 'px';
  canvas.style.height = (Math.max(320, w | 0) * 0.75 | 0) + 'px';
}
addEventListener('resize', resize);
resize();

let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(250, now - last); last = now;
  while (acc >= TICK) { tick(); acc -= TICK; }
  render();
  ctx.putImageData(frame, 0, 0);
  requestAnimationFrame(loop);
}
buildArena(0);
requestAnimationFrame(loop);

// test hook (used by automated screenshots; harmless in play)
window.__barbarian = { G, startMatch, startRound, toTitle, tick, render, setState, startAttack, ANIMS };
})();
