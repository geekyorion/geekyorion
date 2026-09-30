import { SHAPES, type ParticleData } from '../engine/types';
import { BS, LM, PX, setLandmarks } from './landmarks';

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

/**
 * A face baked by tools/bake_face.py: a shuffled pool of textured 3D points in
 * the 1024 px reference frame. Depth is a consensus of MediaPipe face meshes
 * from several photos; hair/neck use a proxy continuous with the mesh.
 */
export interface BakedFace {
  n: number;
  u: Float32Array;
  v: Float32Array;
  z: Float32Array;
  rgb: Uint8Array;
  /** 1 hair, 2 body skin, 3 face skin, 4 clothes */
  cls: Uint8Array;
  /** CSR grid over (u, v) for nearest-point lookups, 8 px cells */
  cellStart: Uint32Array;
  cellItems: Uint32Array;
}

const CELL = 8;
const GRID = 1024 / CELL;

export async function loadBakedFace(url: string): Promise<BakedFace> {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'GFB1') throw new Error('bad face.bin');
  const n = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(8, true);
  setLandmarks(JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))));
  let o = 12 + jsonLen;
  o += (4 - (o % 4)) % 4;
  const u16 = (k: number) => new Uint16Array(buf, o + k * n * 2, n);
  const uq = u16(0), vq = u16(1), zq = new Int16Array(buf, o + 2 * n * 2, n);
  const rgb = new Uint8Array(buf, o + 6 * n, n * 3);
  const cls = new Uint8Array(buf, o + 9 * n, n);
  const u = Float32Array.from(uq, (x) => x / 32);
  const v = Float32Array.from(vq, (x) => x / 32);
  const z = Float32Array.from(zq, (x) => x / 16);

  // counting sort of points into grid cells
  const cellOf = (i: number) => Math.min(GRID - 1, (v[i] / CELL) | 0) * GRID + Math.min(GRID - 1, (u[i] / CELL) | 0);
  const cellStart = new Uint32Array(GRID * GRID + 1);
  for (let i = 0; i < n; i++) cellStart[cellOf(i) + 1]++;
  for (let c = 0; c < GRID * GRID; c++) cellStart[c + 1] += cellStart[c];
  const fillPos = cellStart.slice(0, GRID * GRID);
  const cellItems = new Uint32Array(n);
  for (let i = 0; i < n; i++) cellItems[fillPos[cellOf(i)]++] = i;
  return { n, u, v, z, rgb, cls, cellStart, cellItems };
}

/** Nearest baked point to (u, v) within `maxDist` px, or -1. */
function nearest(face: BakedFace, u: number, v: number, maxDist: number) {
  const cx = (u / CELL) | 0, cy = (v / CELL) | 0;
  const r = Math.ceil(maxDist / CELL);
  let best = -1, bestD = maxDist * maxDist;
  for (let y = Math.max(0, cy - r); y <= Math.min(GRID - 1, cy + r); y++)
    for (let x = Math.max(0, cx - r); x <= Math.min(GRID - 1, cx + r); x++) {
      const c = y * GRID + x;
      for (let k = face.cellStart[c]; k < face.cellStart[c + 1]; k++) {
        const i = face.cellItems[k];
        const d = (face.u[i] - u) ** 2 + (face.v[i] - v) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
  return best;
}

/** Depth of the nose tip in world units; the rest of the face sits behind it. */
const NOSE_Z = 0.6;
const worldZ = (z: number) => -(z - LM.zNose) * PX + NOSE_Z - 0.3;

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
 * Photo style: the baked pool, as-is. Any prefix of the pool is an even
 * subsample; beyond the pool, points are reused with a sub-pixel jitter.
 */
export function sampleFace(face: BakedFace, opts: FaceOptions): ParticleData {
  const n = opts.count;
  const base = new Float32Array(n * 4);
  const color = new Float32Array(n * 4);
  const deltas = new Uint32Array(n * SHAPES * 2);
  const bs = new Float32Array(SHAPES * 3);
  const neckTop = LM.chin.y - 20;

  for (let p = 0; p < n; p++) {
    const q = p % face.n;
    const j = p >= face.n ? 1.2 : 0;
    const u = face.u[q] + (Math.random() - 0.5) * j;
    const v = face.v[q] + (Math.random() - 0.5) * j;
    const k = face.cls[q];
    base[p * 4] = (u - LM.center.x) * PX;
    base[p * 4 + 1] = -(v - LM.center.y) * PX;
    base[p * 4 + 2] = worldZ(face.z[q]);
    base[p * 4 + 3] = k === 4 ? 0 : 1 - smooth(neckTop, neckTop + 140, v);

    color[p * 4] = lift(face.rgb[q * 3]);
    color[p * 4 + 1] = lift(face.rgb[q * 3 + 1]);
    color[p * 4 + 2] = lift(face.rgb[q * 3 + 2]);
    color[p * 4 + 3] = (1 - smooth(720, 880, v)) * (k === 4 ? 0.4 : 0.95);

    blendshapes(u, v, bs);
    writeDeltas(deltas, p, bs);
  }
  return { count: n, base, color, deltas, start: galaxy(n) };
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
 * rest, they only sparkle into view while the face is being scattered.
 */
export function sampleSphereFace(face: BakedFace, opts: SphereOptions): ParticleData {
  const n = opts.count;
  const M = Math.min(opts.dots, n);
  // ellipsoid in reference pixels, centred on the face; depth radius in world units
  const cu = 512, cv = LM.eyeL.y + 30, ru = 238, rv = 318, rz = 0.78;
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
      const i = nearest(face, u, v, 7);
      const fade = 1 - smooth(640, 740, v);
      if (i >= 0 && face.cls[i] !== 4 && fade > 0.02) {
        const px = [face.rgb[i * 3], face.rgb[i * 3 + 1], face.rgb[i * 3 + 2]];
        const l = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255;
        // real relief from the baked depth, pressed onto the sphere
        wz += clamp(worldZ(face.z[i]) - (NOSE_Z - 0.3) + 0.3, -0.1, 0.4) * z * 0.5;
        rgb = px.map(lift);
        // halftone: bright skin -> big dots, dark eyes/brows/hair -> small dots, so the gaps draw the features
        const t = smooth(0.04, 0.62, l);
        size = (0.5 + 1.15 * t) * (0.65 + 0.35 * z);
        // dark regions (hair, brows) get a cool slate tint so the hairline still reads
        const dark = 1 - smooth(0.03, 0.22, l);
        rgb = rgb.map((c, k) => c * (0.75 + 0.5 * t) * (1 - dark * 0.7) + [0.34, 0.42, 0.58][k] * dark * 0.7);
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
