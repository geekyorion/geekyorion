import { SHAPES } from '../engine/types';
import { BS } from './landmarks';

/**
 * Landmark rig. Expressions are authored as displacements of the 478
 * MediaPipe face-mesh landmarks (measured on my photo, in the 1024 px
 * reference frame: u right, v down, z = MediaPipe depth, negative = towards
 * the camera). Every particle is bound to a Delaunay triangle of the landmarks
 * with barycentric weights, so eyelids close along my real lid contours, lip
 * corners move along my real lips, and the jaw swings about its hinge.
 */

// MediaPipe indices. "R" = subject's right = screen-left.
const R_UP = [246, 161, 160, 159, 158, 157, 173];
const R_LO = [7, 163, 144, 145, 153, 154, 155];
const L_UP = [466, 388, 387, 386, 385, 384, 398];
const L_LO = [249, 390, 373, 374, 380, 381, 382];
const R_UP2 = [247, 30, 29, 27, 28, 56, 190];
const L_UP2 = [467, 260, 259, 257, 258, 286, 414];
const R_LO2 = [25, 110, 24, 23, 22, 26, 112];
const L_LO2 = [255, 339, 254, 253, 252, 256, 341];
const R_IRIS = [468, 469, 470, 471, 472];
const L_IRIS = [473, 474, 475, 476, 477];
const R_BROW = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55];
const L_BROW = [300, 293, 334, 296, 336, 276, 283, 282, 295, 285];
const FOREHEAD = [109, 67, 103, 54, 21, 68, 104, 69, 108, 151, 337, 299, 333, 298, 301, 338, 297, 332, 284, 251, 10, 9];
/** landmarks on the face outline, used to extrapolate motion to hair and neck */
const OUTLINE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

/** Maximum jaw rotation (radians) at JawOpen = 1. */
const JAW_ANGLE = 0.3;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface Rig {
  /** per shape, per landmark: du, dv, dz (reference px) */
  deltas: Float32Array;
  /** fills out[SHAPES*3] with (du, dv, dz) for a point; `kind` 6 = mouth interior */
  sample(u: number, v: number, z: number, kind: number, out: Float32Array): void;
}

export function buildRig(lm: Float32Array, tris: Uint16Array): Rig {
  const N = lm.length / 3;
  const X = (i: number) => lm[i * 3], Y = (i: number) => lm[i * 3 + 1], Z = (i: number) => lm[i * 3 + 2];
  const D = new Float32Array(SHAPES * N * 3);
  const add = (k: number, i: number, du: number, dv: number, dz = 0) => {
    const o = (k * N + i) * 3;
    D[o] += du; D[o + 1] += dv; D[o + 2] += dz;
  };

  const mouthY = (Y(13) + Y(14)) / 2;
  const mouthX = (X(13) + X(14)) / 2;
  const mouthHalfW = Math.abs(X(291) - X(61)) / 2;
  const hinge = { v: (Y(234) + Y(454)) / 2 - 8, z: Math.max(Z(234), Z(454)) + 40 };

  // ---- blinks: upper lid onto lower lid, along the real contours
  const blink = (k: number, up: number[], lo: number[], up2: number[], lo2: number[], iris: number[]) => {
    up.forEach((i, n) => {
      const j = lo[n];
      add(k, i, (X(j) - X(i)) * 0.9, (Y(j) - Y(i)) * 0.92, (Z(j) - Z(i)) * 0.9);
      add(k, up2[n], (X(j) - X(i)) * 0.35, (Y(j) - Y(i)) * 0.45, 0);
      add(k, j, 0, (Y(i) - Y(j)) * 0.08, 0);
      add(k, lo2[n], 0, (Y(i) - Y(j)) * 0.03, 0);
    });
    const lidY = lo.reduce((s, j) => s + Y(j), 0) / lo.length;
    iris.forEach((i) => add(k, i, 0, (lidY - Y(i)) * 0.85, 2));
  };
  blink(BS.BlinkL, R_UP, R_LO, R_UP2, R_LO2, R_IRIS);
  blink(BS.BlinkR, L_UP, L_LO, L_UP2, L_LO2, L_IRIS);

  // ---- eyes wide: lift the upper lids (and a touch of brow)
  [[R_UP, R_LO, R_UP2], [L_UP, L_LO, L_UP2]].forEach(([up, lo, up2]) =>
    up.forEach((i, n) => {
      const gap = Y(lo[n]) - Y(i);
      add(BS.EyeWide, i, 0, -gap * 0.35 - 2.5);
      add(BS.EyeWide, up2[n], 0, -gap * 0.25 - 2);
      add(BS.EyeWide, lo[n], 0, 1.5);
    }));

  // ---- brows
  const brow = (ids: number[], k: number, f: (i: number, inner: number, side: number) => [number, number, number?]) =>
    ids.forEach((i) => {
      const inner = smooth(110, 20, Math.abs(X(i) - mouthX));
      const side = Math.sign(X(i) - mouthX);
      const [du, dv, dz] = f(i, inner, side);
      add(k, i, du, dv, dz ?? 0);
    });
  brow(R_BROW, BS.BrowUp, (_i, inner) => [0, -13 - 6 * inner]);
  brow(L_BROW, BS.BrowUp, (_i, inner) => [0, -13 - 6 * inner]);
  FOREHEAD.forEach((i) => add(BS.BrowUp, i, 0, -5 * smooth(Y(10) - 10, Y(9) + 10, Y(i))));
  [...R_UP2, ...L_UP2].forEach((i) => add(BS.BrowUp, i, 0, -3));

  brow(R_BROW, BS.BrowDown, (_i, inner, side) => [-side * 7 * inner, 6 + 9 * inner, -2 * inner]);
  brow(L_BROW, BS.BrowDown, (_i, inner, side) => [-side * 7 * inner, 6 + 9 * inner, -2 * inner]);
  [9, 8, 151, 168].forEach((i) => add(BS.BrowDown, i, 0, 3, -1));
  [...R_UP2, ...L_UP2].forEach((i) => add(BS.BrowDown, i, 0, 3));

  brow(R_BROW, BS.BrowRaiseL, (_i, inner) => [0, -21 + 6 * inner]);
  R_UP2.forEach((i) => add(BS.BrowRaiseL, i, 0, -5));
  FOREHEAD.filter((i) => X(i) < mouthX).forEach((i) => add(BS.BrowRaiseL, i, 0, -6));

  // ---- smile (per side): corners up/out/back, cheeks up and forward, lower lid squint
  ([[BS.SmileL, 61, -1, R_LO, R_LO2], [BS.SmileR, 291, 1, L_LO, L_LO2]] as const).forEach(([k, c, s, lo, lo2]) => {
    for (let i = 0; i < N; i++) {
      const dx = X(i) - X(c), dy = Y(i) - Y(c);
      const wc = Math.exp(-(dx * dx + dy * dy) / (40 * 40));
      // lips between centre and this corner curve upwards
      const t = Math.min(1, Math.max(0, ((X(i) - mouthX) * s) / mouthHalfW));
      const lips = Math.exp(-((Y(i) - mouthY) ** 2) / (22 * 22)) * (Math.abs(X(i) - mouthX) < mouthHalfW * 1.15 ? 1 : 0);
      const cheek = Math.exp(-(((X(i) - (X(c) + s * 22)) ** 2) + (Y(i) - (Y(c) - 60)) ** 2) / (55 * 55));
      add(k, i, s * (8 * wc + 4 * t * lips), -(12 * wc + 9 * t * t * lips) - 7 * cheek, 6 * wc - 6 * cheek);
    }
    lo.forEach((i) => add(k, i, 0, -3.5));
    lo2.forEach((i) => add(k, i, 0, -4.5));
  });

  // ---- frown: corners down, chin up
  [[61, -1], [291, 1]].forEach(([c, s]) => {
    for (let i = 0; i < N; i++) {
      const wc = Math.exp(-(((X(i) - X(c)) ** 2) + (Y(i) - Y(c)) ** 2) / (36 * 36));
      add(BS.Frown, i, -s * 3 * wc, 11 * wc, 0);
    }
  });
  [152, 175, 199, 200, 18, 17].forEach((i) => add(BS.Frown, i, 0, -4, -2));

  // ---- jaw: rotate everything below the lips about the hinge
  const jaw = (_u: number, v: number, z: number, w: number, out: Float32Array | null, i = -1) => {
    const ry = v - hinge.v, rz = z - hinge.z;
    const c = Math.cos(JAW_ANGLE), s = Math.sin(JAW_ANGLE);
    const dv = (ry * c - rz * s - ry) * w;
    const dz = (ry * s + rz * c - rz) * w;
    if (out) { out[BS.JawOpen * 3 + 1] += dv; out[BS.JawOpen * 3 + 2] += dz; }
    else add(BS.JawOpen, i, 0, dv, dz);
  };
  const jawWeight = (u: number, v: number) => {
    const lateral = Math.abs(u - mouthX) / mouthHalfW;
    // sharp split between the lips, softer over the cheeks
    const soft = smooth(1.0, 1.6, lateral);
    const w = smooth(mouthY - 1 - soft * 25, mouthY + 2 + soft * 45, v);
    return w * (1 - smooth(1.8, 2.6, lateral) * 0.85);
  };
  for (let i = 0; i < N; i++) {
    jaw(X(i), Y(i), Z(i), jawWeight(X(i), Y(i)), null, i);
    // upper lip lifts a little
    if (Y(i) < mouthY && Math.abs(X(i) - mouthX) < mouthHalfW * 1.1 && Y(i) > mouthY - 30) add(BS.JawOpen, i, 0, -3);
  }

  // ---- gaze: move the irises; lids and corners stay pinned
  [...R_IRIS, ...L_IRIS].forEach((i) => {
    add(BS.LookX, i, 7, 0);
    add(BS.LookY, i, 0, 4.5);
  });

  // ---------------------------------------------------------------- binding
  const T = tris.length / 3;
  const CELL = 32, G = 1024 / CELL;
  const buckets: number[][] = Array.from({ length: G * G }, () => []);
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const x0 = Math.min(X(a), X(b), X(c)), x1 = Math.max(X(a), X(b), X(c));
    const y0 = Math.min(Y(a), Y(b), Y(c)), y1 = Math.max(Y(a), Y(b), Y(c));
    for (let gy = Math.max(0, (y0 / CELL) | 0); gy <= Math.min(G - 1, (y1 / CELL) | 0); gy++)
      for (let gx = Math.max(0, (x0 / CELL) | 0); gx <= Math.min(G - 1, (x1 / CELL) | 0); gx++) buckets[gy * G + gx].push(t);
  }
  const outline = OUTLINE;
  const f0 = (d2: number) => (1 - Math.sqrt(d2) / 70) ** 2;
  /**
   * The jaw is evaluated per particle rather than interpolated: lip particles
   * bound to triangles that span the mouth slit would otherwise smear across the
   * opening. Below the chin the neck only follows a little.
   */
  const chinY = Y(152);
  const directJaw = (u: number, v: number, z: number, out: Float32Array, scale = 1) => {
    out[BS.JawOpen * 3] = 0;
    out[BS.JawOpen * 3 + 1] = 0;
    out[BS.JawOpen * 3 + 2] = 0;
    const w = jawWeight(u, v) * (1 - 0.8 * smooth(chinY + 5, chinY + 70, v)) * scale;
    jaw(u, v, z, w, out);
    if (v < mouthY && v > mouthY - 30 && Math.abs(u - mouthX) < mouthHalfW * 1.1) out[BS.JawOpen * 3 + 1] -= 3 * scale;
  };

  return {
    deltas: D,
    sample(u, v, z, kind, out) {
      out.fill(0);
      if (kind === 6) {
        // mouth interior: lower part follows the jaw, upper teeth stay
        jaw(u, v, z, smooth(mouthY - 2, mouthY + 6, v), out);
        return;
      }
      const gx = Math.min(G - 1, Math.max(0, (u / CELL) | 0)), gy = Math.min(G - 1, Math.max(0, (v / CELL) | 0));
      for (const t of buckets[gy * G + gx]) {
        const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
        const det = (Y(b) - Y(c)) * (X(a) - X(c)) + (X(c) - X(b)) * (Y(a) - Y(c));
        const l1 = ((Y(b) - Y(c)) * (u - X(c)) + (X(c) - X(b)) * (v - Y(c))) / det;
        const l2 = ((Y(c) - Y(a)) * (u - X(c)) + (X(a) - X(c)) * (v - Y(c))) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        // particles far behind the face surface (e.g. back of the head) are not on this triangle
        const zs = l1 * Z(a) + l2 * Z(b) + l3 * Z(c);
        if (z - zs > 60) break;
        for (let k = 0; k < SHAPES; k++) {
          const o = k * N * 3;
          for (let d = 0; d < 3; d++) out[k * 3 + d] = l1 * D[o + a * 3 + d] + l2 * D[o + b * 3 + d] + l3 * D[o + c * 3 + d];
        }
        directJaw(u, v, z, out);
        return;
      }
      // outside the mesh: fade out the motion of the nearest outline landmark (hair line, jaw line)
      let best = -1, bestD = 70 * 70;
      for (const i of outline) {
        const d = (X(i) - u) ** 2 + (Y(i) - v) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0 || z - Z(best) > 80) return;
      directJaw(u, v, z, out, f0(bestD));
      const f = f0(bestD);
      for (let k = 0; k < SHAPES; k++) {
        if (k === BS.JawOpen) continue;
        const o = (k * N + best) * 3;
        out[k * 3] = D[o] * f; out[k * 3 + 1] = D[o + 1] * f; out[k * 3 + 2] = D[o + 2] * f;
      }
    },
  };
}
