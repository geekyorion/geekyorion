/**
 * Morph targets. Each returns `n` points as [x, y, z, paletteT] in world units.
 * All are generated procedurally at runtime: no models, no textures.
 */
export type ShapeName = 'git' | 'terrain' | 'sphere' | 'knot' | 'cube' | 'text';

const TAU = Math.PI * 2;
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

function fill(n: number, gen: (i: number, out: Float32Array, o: number) => void) {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) gen(i, out, i * 4);
  return out;
}

/** Fibonacci sphere with a couple of orbit rings: the "tech stack" globe. */
export function sphere(n: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const shell = Math.floor(n * 0.8);
  return fill(n, (i, out, o) => {
    if (i < shell) {
      const y = 1 - (i / (shell - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const R = 1.15 + rnd(0.015);
      out.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R, 0.5 + y * 0.5], o);
    } else {
      const ring = i % 2;
      const a = Math.random() * TAU;
      const R = 1.6 + ring * 0.25 + rnd(0.02);
      const tilt = ring ? 0.5 : -0.35;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      out.set([x, z * Math.sin(tilt) + rnd(0.01), z * Math.cos(tilt), ring ? 1 : 0], o);
    }
  });
}

/** A `git log --graph`: a main line, feature branches forking and merging, commits as rings. */
export function gitGraph(n: number) {
  const lanes = [0, -0.55, 0.55, -1.05];
  type Seg = { x0: number; y0: number; x1: number; y1: number; lane: number };
  const segs: Seg[] = [
    { x0: 0, y0: -1.5, x1: 0, y1: 1.5, lane: 0 },
    { x0: 0, y0: -1.1, x1: -0.55, y1: -0.7, lane: 1 },
    { x0: -0.55, y0: -0.7, x1: -0.55, y1: 0.2, lane: 1 },
    { x0: -0.55, y0: 0.2, x1: 0, y1: 0.6, lane: 1 },
    { x0: 0, y0: -0.4, x1: 0.55, y1: 0, lane: 2 },
    { x0: 0.55, y0: 0, x1: 0.55, y1: 0.9, lane: 2 },
    { x0: 0.55, y0: 0.9, x1: 0, y1: 1.25, lane: 2 },
    { x0: -0.55, y0: -0.3, x1: -1.05, y1: 0.05, lane: 3 },
    { x0: -1.05, y0: 0.05, x1: -1.05, y1: 0.45, lane: 3 },
  ];
  const commits: [number, number, number][] = [
    [0, -1.4, 0], [0, -0.8, 0], [0, -0.05, 0], [0, 0.6, 0], [0, 1.25, 0],
    [-0.55, -0.45, 1], [-0.55, 0.0, 1], [0.55, 0.3, 2], [0.55, 0.65, 2], [-1.05, 0.3, 3],
  ];
  const lens = segs.map((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0));
  const total = lens.reduce((a, b) => a + b, 0);
  const lineN = Math.floor(n * 0.45);
  return fill(n, (i, out, o) => {
    if (i < lineN) {
      let r = Math.random() * total, k = 0;
      while (r > lens[k] && k < segs.length - 1) r -= lens[k++];
      const s = segs[k];
      const t = r / lens[k];
      // straight lanes, eased S-curves for forks and merges
      const e = s.x0 === s.x1 ? t : t * t * (3 - 2 * t);
      const x = s.x0 + (s.x1 - s.x0) * e + rnd(0.012);
      const y = s.y0 + (s.y1 - s.y0) * t + rnd(0.012);
      out.set([x, y, rnd(0.03), s.lane / (lanes.length - 1)], o);
    } else {
      const c = commits[i % commits.length];
      const a = Math.random() * TAU;
      const ringR = 0.085 + (Math.random() < 0.6 ? rnd(0.01) : -Math.random() * 0.06);
      out.set([c[0] + Math.cos(a) * ringR, c[1] + Math.sin(a) * ringR, rnd(0.03), c[2] / (lanes.length - 1)], o);
    }
  });
}

/** A nod to holographic-terrain: a tilted wave field. */
export function terrain(n: number) {
  const tilt = 0.9;
  return fill(n, (_i, out, o) => {
    const x = rnd(1.55);
    const z = rnd(1.1);
    const h = 0.22 * Math.sin(x * 2.1 + z) * Math.cos(z * 2.4) + 0.12 * Math.sin(x * 4.3 - z * 3.1) - 0.05 * Math.abs(x) * 0.3;
    const y = h * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = h * Math.sin(tilt) + z * Math.cos(tilt);
    out.set([x, y, zz, Math.min(1, Math.max(0, h * 2 + 0.5))], o);
  });
}

/** (p,q) torus knot tube. */
export function knot(n: number) {
  const p = 2, q = 3;
  return fill(n, (_i, out, o) => {
    const t = Math.random() * TAU;
    const at = (tt: number) => {
      const r = 0.75 + 0.3 * Math.cos(q * tt);
      return [r * Math.cos(p * tt), r * Math.sin(p * tt), 0.3 * Math.sin(q * tt)];
    };
    const c = at(t), c2 = at(t + 0.001);
    const tan = [c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]];
    const tl = Math.hypot(tan[0], tan[1], tan[2]);
    const T = tan.map((v) => v / tl);
    // any vector not parallel to T, then build a frame
    const up = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const N = [T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]];
    const nl = Math.hypot(N[0], N[1], N[2]);
    const Nn = N.map((v) => v / nl);
    const B = [T[1] * Nn[2] - T[2] * Nn[1], T[2] * Nn[0] - T[0] * Nn[2], T[0] * Nn[1] - T[1] * Nn[0]];
    const a = Math.random() * TAU, rr = 0.12;
    const s = 0.9;
    out.set([
      (c[0] + (Nn[0] * Math.cos(a) + B[0] * Math.sin(a)) * rr) * s,
      (c[1] + (Nn[1] * Math.cos(a) + B[1] * Math.sin(a)) * rr) * s,
      (c[2] + (Nn[2] * Math.cos(a) + B[2] * Math.sin(a)) * rr) * s,
      t / TAU,
    ], o);
  });
}

/** Wireframe cube: particles on the 12 edges. */
export function cube(n: number) {
  const s = 0.95;
  return fill(n, (_i, out, o) => {
    const axis = Math.floor(Math.random() * 3);
    const a = Math.random() < 0.5 ? -s : s, b = Math.random() < 0.5 ? -s : s;
    const t = rnd(s);
    const p = axis === 0 ? [t, a, b] : axis === 1 ? [a, t, b] : [a, b, t];
    out.set([p[0] + rnd(0.01), p[1] + rnd(0.01), p[2] + rnd(0.01), (p[1] / s) * 0.5 + 0.5], o);
  });
}

/** Rasterise text with the 2D canvas and sample its filled pixels. */
export function text(n: number, str: string, maxWidth = 2.5) {
  const lines = str.split('\n');
  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true })!;
  const fontPx = 120;
  const font = `700 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.font = font;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 20;
  const lh = fontPx * 1.15;
  const h = Math.ceil(lh * lines.length) + 20;
  cvs.width = w;
  cvs.height = h;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  lines.forEach((l, k) => ctx.fillText(l, w / 2, 10 + lh * (k + 0.5)));
  const data = ctx.getImageData(0, 0, w, h).data;
  const filled: number[] = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 128) filled.push(i);
  if (!filled.length) return sphere(n);
  const scale = Math.min(maxWidth / w, 2.2 / h);
  return fill(n, (_i, out, o) => {
    const p = filled[(Math.random() * filled.length) | 0];
    const x = (p % w) + Math.random();
    const y = ((p / w) | 0) + Math.random();
    out.set([(x - w / 2) * scale, -(y - h / 2) * scale, rnd(0.04), x / w], o);
  });
}

export function makeShape(name: ShapeName, n: number, arg = '') {
  switch (name) {
    case 'git': return gitGraph(n);
    case 'terrain': return terrain(n);
    case 'sphere': return sphere(n);
    case 'knot': return knot(n);
    case 'cube': return cube(n);
    case 'text': return text(n, arg || 'hello()');
  }
}
