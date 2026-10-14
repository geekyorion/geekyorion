import { SHAPES, type ParticleData } from '../engine/types';
import { LM, PX, setLandmarks } from './landmarks';
import { buildRig, type Rig } from './rig';

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

export interface FaceOptions {
  count: number;
}

/**
 * A face baked by tools/bake_face.py: a complete 3D head as textured points in
 * the 1024 px reference frame (u right, v down, z = MediaPipe depth). The front
 * is my photo on a consensus face mesh, the sides and back a lathe built from
 * my silhouette, plus a mouth interior. Ships the 478 landmarks and their
 * triangulation for the expression rig.
 */
export interface BakedFace {
  n: number;
  u: Float32Array;
  v: Float32Array;
  z: Float32Array;
  rgb: Uint8Array;
  /** 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 hair shell (sides/back), 6 mouth interior, 7 skin shell (neck) */
  cls: Uint8Array;
  /** surface normals, reference frame, int8 * 127 */
  normal: Int8Array;
  rig: Rig;
  /** CSR grid over (u, v) of front-facing points, for nearest-point lookups, 8 px cells */
  cellStart: Uint32Array;
  cellItems: Uint32Array;
}

const CELL = 8;
const GRID = 1024 / CELL;

export async function loadBakedFace(url: string): Promise<BakedFace> {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'GFB2') throw new Error('bad face.bin');
  const n = dv.getUint32(4, true);
  const jsonLen = dv.getUint32(8, true);
  setLandmarks(JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))));
  let o = 12 + jsonLen;
  o += (4 - (o % 4)) % 4;
  const lm = new Float32Array(buf.slice(o, o + 478 * 12));
  o += 478 * 12;
  const nTri = dv.getUint32(o, true);
  o += 4;
  const tris = new Uint16Array(buf.slice(o, o + nTri * 6));
  o += nTri * 6;
  o += (4 - (o % 4)) % 4;
  const u = Float32Array.from(new Uint16Array(buf, o, n), (x) => x / 32);
  const v = Float32Array.from(new Uint16Array(buf, o + n * 2, n), (x) => x / 32);
  const z = Float32Array.from(new Int16Array(buf, o + n * 4, n), (x) => x / 16);
  const rgb = new Uint8Array(buf, o + n * 6, n * 3);
  const cls = new Uint8Array(buf, o + n * 9, n);
  const normal = new Int8Array(buf, o + n * 10, n * 3);

  // counting sort of the front-facing points into grid cells
  const front = (i: number) => cls[i] < 5 && normal[i * 3 + 2] < 0;
  const cellOf = (i: number) => Math.min(GRID - 1, (v[i] / CELL) | 0) * GRID + Math.min(GRID - 1, (u[i] / CELL) | 0);
  const cellStart = new Uint32Array(GRID * GRID + 1);
  for (let i = 0; i < n; i++) if (front(i)) cellStart[cellOf(i) + 1]++;
  for (let c = 0; c < GRID * GRID; c++) cellStart[c + 1] += cellStart[c];
  const fillPos = cellStart.slice(0, GRID * GRID);
  const cellItems = new Uint32Array(cellStart[GRID * GRID]);
  for (let i = 0; i < n; i++) if (front(i)) cellItems[fillPos[cellOf(i)]++] = i;
  return { n, u, v, z, rgb, cls, normal, rig: buildRig(lm, tris), cellStart, cellItems };
}

/** Nearest front-facing baked point to (u, v) within `maxDist` px, or -1. */
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

/** Depth of the nose tip in world units; the rest of the head sits behind it. */
const NOSE_Z = 0.3;
const worldZ = (z: number) => -(z - LM.zNose) * PX + NOSE_Z;

/** Centre depth of the sphere-style head (world units). */
export const SPHERE_Z = -0.3;

/** World-space pivot (y, z) of the head: the skull axis at ear height. */
export function headPivot(): [number, number] {
  return [-((LM.eyeL.y + LM.eyeR.y) / 2 + 50 - LM.center.y) * PX, worldZ(LM.axisZ ?? LM.zNose + 330)];
}

/** Lift shadows so dark hair still reads on a dark background. */
const lift = (c: number) => Math.pow(c / 255, 0.8) * 0.92 + 0.05;

/**
 * Pack blendshape deltas (reference px) as world-space half floats. The spare
 * high halves of the first three shapes carry the surface normal, which the
 * compute shader uses to hide points facing away from the camera.
 * A normal of (0, 0, 9) marks the mouth interior; (0, 0, 0) means always visible.
 */
function writeDeltas(deltas: Uint32Array, p: number, bs: Float32Array, n: [number, number, number]) {
  for (let k = 0; k < SHAPES; k++) {
    const o = (p * SHAPES + k) * 2;
    deltas[o] = pack(bs[k * 3] * PX, -bs[k * 3 + 1] * PX);
    deltas[o + 1] = pack(-bs[k * 3 + 2] * PX, k < 3 ? n[k] : 0);
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
 * Photo style: the baked head, as-is. Any prefix of the pool is an even
 * subsample; beyond the pool, points are reused with a sub-pixel jitter.
 */
export function sampleFace(face: BakedFace, opts: FaceOptions): ParticleData {
  const n = opts.count;
  const base = new Float32Array(n * 4);
  const color = new Float32Array(n * 4);
  const deltas = new Uint32Array(n * SHAPES * 2);
  const bs = new Float32Array(SHAPES * 3);
  const neckTop = LM.chin.y - 20;

  // Budget: the photo surface first (it is what people look at), the head shell gets the rest.
  // No depth buffer, so draw order does the occlusion: mouth interior first, then the
  // photo surface, then the shell, so hair covers anything seen from behind.
  const groups: number[][] = [[], [], []];
  for (let i = 0; i < face.n; i++) {
    const c = face.cls[i];
    groups[c === 6 ? 0 : c === 5 || c === 7 ? 2 : 1].push(i);
  }
  const take = (g: number[], k: number) => g.slice(0, Math.max(0, Math.min(g.length, k)));
  const inner = take(groups[0], Math.round(n * 0.04));
  const surface = take(groups[1], Math.max(n * 0.6, n - inner.length - groups[2].length));
  const shell = take(groups[2], n - inner.length - surface.length);
  const order = [...inner, ...surface, ...shell];
  for (let p = order.length; p < n; p++) order.push(face.n + p); // beyond the pool: jittered repeats

  for (let p = 0; p < n; p++) {
    const q = order[p] % face.n;
    const j = order[p] >= face.n ? 1.2 : 0;
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

    face.rig.sample(u, v, face.z[q], k, bs);
    const nr = face.normal;
    const nw: [number, number, number] = k === 6 ? [0, 0, 9] : [nr[q * 3] / 127, -nr[q * 3 + 1] / 127, -nr[q * 3 + 2] / 127];
    writeDeltas(deltas, p, bs, nw);
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
  const cu = 512, cv = LM.eyeL.y + 30, ru = 238, rv = 318, rz = 0.78;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const zc = SPHERE_Z;
  const none: [number, number, number] = [0, 0, 0];

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

    let wz = zc + z * rz;
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
        wz += clamp(worldZ(face.z[i]) - NOSE_Z + 0.3, -0.1, 0.4) * z * 0.5;
        rgb = px.map(lift);
        // halftone: bright skin -> big dots, dark eyes/brows/hair -> small dots, so the gaps draw the features
        const t = smooth(0.04, 0.62, l);
        size = (0.5 + 1.15 * t) * (0.65 + 0.35 * z);
        // dark regions (hair, brows) get a cool slate tint so the hairline still reads
        const dark = 1 - smooth(0.03, 0.22, l);
        rgb = rgb.map((c, k) => c * (0.75 + 0.5 * t) * (1 - dark * 0.7) + [0.34, 0.42, 0.58][k] * dark * 0.7);
        alpha = 0.35 + 0.65 * fade;
        face.rig.sample(u, v, face.z[i], face.cls[i], bs);
      }
    }

    base.set([(u - LM.center.x) * PX, -(v - LM.center.y) * PX, wz, size], p * 4);
    color.set([rgb[0], rgb[1], rgb[2], alpha], p * 4);
    writeDeltas(deltas, p, bs, none);
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
