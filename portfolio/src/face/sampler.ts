import { SHAPES, type ParticleData } from '../engine/types';
import { BS, LM, PX } from './landmarks';

const gauss = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));
const superGauss = (dx: number, dy: number, sx: number, sy: number) => {
  const a = (dx * dx) / (sx * sx);
  const b = (dy * dy) / (sy * sy);
  return Math.exp(-(a * a + b * b));
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Float32 -> IEEE half, packed in the same order unpack2x16float expects. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >>> 13);
}
const pack = (a: number, b: number) => (toHalf(a) | (toHalf(b) << 16)) >>> 0;

/** Relief of the facial features (nose, sockets, lips, chin) in world units. */
function features(u: number, v: number, lum: number) {
  const faceMask = smooth(300, 330, u) * (1 - smooth(694, 724, u)) * (1 - smooth(640, 700, v));
  return (
    faceMask *
    (0.2 * gauss(u - 512, v - 440, 26, 70) +
      0.08 * gauss(u - LM.noseTip.x, v - LM.noseTip.y, 24, 18) -
      0.07 * (gauss(u - LM.eyeL.x, v - LM.eyeL.y, 40, 24) + gauss(u - LM.eyeR.x, v - LM.eyeR.y, 40, 24)) +
      0.05 * gauss(u - 512, v - 560, 70, 28) +
      0.04 * gauss(u - 512, v - 662, 60, 30) +
      (lum - 0.5) * 0.02)
  );
}

/** Synthetic depth (world units) for a pixel of the portrait. */
function depth(u: number, v: number, lum: number) {
  const dx = (u - 512) / 215;
  const dy = (v - 440) / 300;
  const e = 1 - dx * dx - dy * dy;
  const head = (e > 0 ? 0.62 * Math.sqrt(e) : 0) + features(u, v, lum);
  const nx = (u - 512) / 150;
  const neck = v > 560 ? 0.34 * Math.sqrt(Math.max(0, 1 - nx * nx)) - 0.06 : 0;
  const sx = (u - 512) / 520;
  const shirt = v > 700 ? 0.42 * Math.sqrt(Math.max(0, 1 - sx * sx)) - 0.2 : -1;
  return Math.max(head, neck, shirt) - 0.3;
}

/** Blendshape deltas in pixel space (du, dv, dz) for one pixel. */
function blendshapes(u: number, v: number, out: Float32Array) {
  out.fill(0);
  const set = (k: number, du: number, dv: number, dz = 0) => {
    out[k * 3] += du;
    out[k * 3 + 1] += dv;
    out[k * 3 + 2] += dz;
  };
  const eyes = [LM.eyeL, LM.eyeR];

  // --- blinks: collapse the eye region onto the lid line -------------------
  eyes.forEach((c, side) => {
    const du = u - c.x;
    const dv = v - c.y;
    const w = superGauss(du, dv, 50, 30);
    if (w > 0.002) {
      const lid = 4;
      set(side === 0 ? BS.BlinkL : BS.BlinkR, 0, -(dv - lid) * 0.93 * w);
      // eyes wide: stretch vertically, mostly the upper lid
      set(BS.EyeWide, 0, dv * (dv < 0 ? 0.5 : 0.2) * w);
      // gaze: a warp that moves the iris and keeps the eye corners pinned
      const hw = LM.eyeHalfW;
      const fx = clamp(1 - (du / hw) ** 2, 0, 1);
      const fy = superGauss(0, dv, 1, 22);
      set(BS.LookX, 11 * fx * fy, 0);
      set(BS.LookY, 0, 6 * fx * fy * clamp(1 - (dv / 22) ** 2, 0, 1));
    }
  });

  // --- brows ----------------------------------------------------------------
  [LM.browL, LM.browR].forEach((c, side) => {
    const du = u - c.x;
    const dv = v - c.y;
    const w = gauss(du, dv, 80, 38);
    if (w > 0.002) {
      set(BS.BrowUp, 0, -17 * w);
      const s = side === 0 ? -1 : 1; // outward direction
      const inner = clamp(1 - Math.abs(u - 512) / 130, 0, 1);
      set(BS.BrowDown, -s * 7 * inner * w, (6 + 12 * inner) * w);
      if (side === 0) set(BS.BrowRaiseL, 0, -22 * w * (0.6 + 0.4 * clamp(-du / 60 + 0.5, 0, 1)));
    }
  });
  // raised brows also lift the upper lids a little
  eyes.forEach((c) => {
    const w = superGauss(u - c.x, v - (c.y - 18), 48, 16);
    if (w > 0.002) set(BS.BrowUp, 0, -4 * w);
  });

  // --- mouth: smile / frown per corner --------------------------------------
  const mouthLine = LM.mouth.y;
  [LM.mouthL, LM.mouthR].forEach((c, side) => {
    const s = side === 0 ? -1 : 1;
    const halfW = Math.abs(c.x - LM.mouth.x);
    // 0 at the philtrum -> 1 at the corner, fading out quickly past the corner
    const t = clamp(((u - LM.mouth.x) * s) / halfW, 0, 1);
    const beyond = Math.max(0, (u - c.x) * s);
    const band = gauss(beyond, v - mouthLine, 38, 30);
    const corner = gauss(u - c.x, v - c.y, 42, 38);
    const k = side === 0 ? BS.SmileL : BS.SmileR;
    set(k, s * (8 * t * band + 5 * corner), -(14 * t * t * band + 8 * corner));
    // cheek lift + lower-lid squint
    const cheek = gauss(u - (c.x + s * 18), v - (c.y - 70), 55, 45);
    const lid = superGauss(u - eyes[side].x, v - (eyes[side].y + 16), 46, 12);
    set(k, 0, -6 * cheek - 5 * lid, 6 * cheek);
    set(BS.Frown, -s * 3 * t * band, 12 * t * t * band + 7 * corner);
  });

  // --- jaw ------------------------------------------------------------------
  {
    const below = smooth(mouthLine - 2, mouthLine + 14, v);
    const jawX = Math.exp(-(((u - 512) / 140) ** 4));
    const fade = 1 - smooth(690, 770, v);
    const w = below * jawX * fade;
    if (w > 0.002) set(BS.JawOpen, 0, 44 * w, -12 * w);
    const upper = gauss(u - 512, v - (mouthLine - 10), 70, 16) * (1 - below);
    if (upper > 0.002) set(BS.JawOpen, 0, -6 * upper);
  }
}

export interface FaceOptions {
  count: number;
}

export interface Portrait {
  S: number;
  scale: number;
  px: Uint8ClampedArray;
  lum: Float32Array;
  bg: Uint8Array;
}

/** Decode the portrait once; both face styles sample from it. */
export async function loadPortrait(url: string): Promise<Portrait> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const S = img.naturalWidth;
  const scale = LM.size / S;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, S, S).data;

  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;

  // background: flood-fill near-white pixels from the image border
  const bg = new Uint8Array(S * S);
  const isWhite = (i: number) => {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    return r > 228 && g > 228 && b > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 20;
  };
  const stack: number[] = [];
  for (let x = 0; x < S; x++) stack.push(x, (S - 1) * S + x);
  for (let y = 0; y < S; y++) stack.push(y * S, y * S + S - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i] || !isWhite(i)) continue;
    bg[i] = 1;
    const x = i % S, y = (i / S) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < S - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - S);
    if (y < S - 1) stack.push(i + S);
  }
  return { S, scale, px, lum, bg };
}

/** Lift shadows so dark hair still reads on a dark background. */
const lift = (c: number) => Math.pow(c / 255, 0.8) * 0.92 + 0.05;

function writeDeltas(deltas: Uint32Array, p: number, bs: Float32Array) {
  for (let k = 0; k < SHAPES; k++) {
    const o = (p * SHAPES + k) * 2;
    deltas[o] = pack(bs[k * 3] * PX, -bs[k * 3 + 1] * PX);
    deltas[o + 1] = pack(bs[k * 3 + 2] * PX, 0);
  }
}

/** Intro: particles start on a wide, flat galaxy disc. */
function galaxy(n: number) {
  const start = new Float32Array(n * 4);
  for (let p = 0; p < n; p++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 2.5 + Math.random() * 5;
    start.set([Math.cos(a) * rad, (Math.random() - 0.5) * 0.6, Math.sin(a) * rad - 2, 1], p * 4);
  }
  return start;
}

/**
 * Photo style. Importance-samples the portrait into particles: more particles on edges
 * (eyes, brows, lips, hair strands), fewer on flat skin, none on background.
 */
export function sampleFace(portrait: Portrait, opts: FaceOptions): ParticleData {
  const { S, scale, px, lum, bg } = portrait;
  // importance weights
  const weight = new Float32Array(S * S);
  let total = 0;
  for (let y = 1; y < S - 1; y++) {
    const v = y * scale;
    if (v > 860) break;
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (bg[i]) continue;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + S] - lum[i - S];
      const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 6);
      const fade = 1 - smooth(700, 860, v);
      const w = (0.45 + edge * 1.6 + (1 - lum[i]) * 0.35) * (0.25 + 0.75 * fade);
      weight[i] = w;
      total += w;
    }
  }
  const cdf = new Float32Array(S * S);
  let acc = 0;
  for (let i = 0; i < S * S; i++) {
    acc += weight[i];
    cdf[i] = acc;
  }

  const n = opts.count;
  const base = new Float32Array(n * 4);
  const color = new Float32Array(n * 4);
  const deltas = new Uint32Array(n * SHAPES * 2);
  const start = galaxy(n);
  const bs = new Float32Array(SHAPES * 3);

  for (let p = 0; p < n; p++) {
    // stratified sampling keeps coverage even
    const r = ((p + Math.random()) / n) * total;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const x = (i % S) + Math.random();
    const y = ((i / S) | 0) + Math.random();
    const u = x * scale;
    const v = y * scale;

    const l = lum[i];
    const z = depth(u, v, l) + (Math.random() - 0.5) * 0.015;
    base[p * 4] = (u - LM.center.x) * PX;
    base[p * 4 + 1] = -(v - LM.center.y) * PX;
    base[p * 4 + 2] = z;
    base[p * 4 + 3] = 1 - smooth(650, 790, v);

    color[p * 4] = lift(px[i * 4]);
    color[p * 4 + 1] = lift(px[i * 4 + 1]);
    color[p * 4 + 2] = lift(px[i * 4 + 2]);
    color[p * 4 + 3] = (1 - smooth(700, 860, v)) * 0.95;

    blendshapes(u, v, bs);
    writeDeltas(deltas, p, bs);
  }

  return { count: n, base, color, deltas, start };
}

export interface SphereOptions extends FaceOptions {
  /** Number of dots on the whole sphere (the face covers the front half). */
  dots: number;
}

/**
 * Sphere style: the portrait is projected onto a 3D ellipsoidal head covered in
 * evenly spaced dots (a Fibonacci lattice), halftone-sized by brightness. The
 * back of the sphere keeps faint "shell" dots so it reads as a globe.
 *
 * base.w carries the dot size here (the whole sphere turns as one head).
 * Particles beyond `dots` are parked on real dots with alpha 0: invisible at
 * rest, they only show up once the pointer scatters the face.
 */
export function sampleSphereFace(portrait: Portrait, opts: SphereOptions): ParticleData {
  const { S, scale, px, lum, bg } = portrait;
  const n = opts.count;
  const M = Math.min(opts.dots, n);
  // ellipsoid in portrait pixels: centre + radii; depth radius in world units
  const cu = 512, cv = 425, ru = 238, rv = 318, rz = 0.78;
  const golden = Math.PI * (3 - Math.sqrt(5));

  const base = new Float32Array(n * 4);
  const color = new Float32Array(n * 4);
  const deltas = new Uint32Array(n * SHAPES * 2);
  const bs = new Float32Array(SHAPES * 3);
  const shell = [0.32, 0.42, 0.6];

  for (let p = 0; p < M; p++) {
    const y = 1 - (p / (M - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * p;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const u = cu + x * ru;
    const v = cv - y * rv;

    let wz = z * rz - 0.3;
    let size = 0.5;
    let rgb = shell;
    let alpha = z > 0 ? 0.32 : 0.16;
    bs.fill(0);

    if (z > 0) {
      const ix = Math.min(S - 1, Math.max(0, Math.round(u / scale)));
      const iy = Math.min(S - 1, Math.max(0, Math.round(v / scale)));
      const i = iy * S + ix;
      const fade = 1 - smooth(640, 740, v);
      const sat = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) - Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      const whitish = lum[i] > 0.68 && sat < 38;
      if (!bg[i] && !whitish && fade > 0.02) {
        const l = lum[i];
        // features push out along the surface, strongest facing the camera
        wz += features(u, v, l) * z * 1.3;
        rgb = [lift(px[i * 4]), lift(px[i * 4 + 1]), lift(px[i * 4 + 2])];
        // halftone: bright skin -> big dots, dark eyes/brows/hair -> small dots, so the gaps draw the features
        const t = smooth(0.12, 0.72, l);
        size = (0.36 + 1.38 * t) * (0.65 + 0.35 * z);
        // dark regions (hair, brows) get a cool slate tint so the hairline still reads
        const dark = 1 - smooth(0.05, 0.3, l);
        rgb = rgb.map((c, k) => (c * (0.75 + 0.5 * t)) * (1 - dark * 0.7) + [0.34, 0.42, 0.58][k] * dark * 0.7);
        alpha = 0.35 + 0.65 * fade;
        blendshapes(u, v, bs);
      }
    }

    base.set([(u - LM.center.x) * PX, -(v - LM.center.y) * PX, wz, size], p * 4);
    color.set([rgb[0], rgb[1], rgb[2], alpha], p * 4);
    writeDeltas(deltas, p, bs);
  }

  // extras: stacked on random real dots, hidden until disturbed
  for (let p = M; p < n; p++) {
    const q = (Math.random() * M) | 0;
    base.set(base.subarray(q * 4, q * 4 + 4), p * 4);
    color.set(color.subarray(q * 4, q * 4 + 3), p * 4);
    color[p * 4 + 3] = 0;
    deltas.set(deltas.subarray(q * SHAPES * 2, (q + 1) * SHAPES * 2), p * SHAPES * 2);
  }

  return { count: n, base, color, deltas, start: galaxy(n) };
}
