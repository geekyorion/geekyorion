import { SHAPES } from './types';

const UNIFORMS = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4f,
  rayO: vec4f,
  rayD: vec4f,
  ptrVel: vec4f,
  shock: vec4f,
  head: vec4f,
  faceXf: vec4f,
  shapeXf: vec4f,
  sim: vec4f,
  sim2: vec4f,
  view: vec4f,
  colA: vec4f,
  colB: vec4f,
  weights: array<vec4f, 3>,
  style: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash(i: u32) -> f32 {
  var x = i * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}
`;

/** One thread per particle: blendshapes -> head pose -> springs + forces -> integrate. */
export const COMPUTE_WGSL = /* wgsl */ `
${UNIFORMS}
@group(0) @binding(1) var<storage, read> base: array<vec4f>;
@group(0) @binding(2) var<storage, read> deltas: array<vec2u>;
@group(0) @binding(3) var<storage, read> morph: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> vel: array<vec4f>;

const K: u32 = ${SHAPES}u;
const PIVOT = vec3f(0.0, -0.35, -0.25);

fn flow(p: vec3f, t: f32) -> vec3f {
  return vec3f(
    sin(p.y * 1.7 + t) + sin(p.z * 2.3 - t * 0.7),
    sin(p.z * 1.9 + t * 1.1) + sin(p.x * 2.1 + t * 0.5),
    sin(p.x * 1.5 - t * 0.9) + sin(p.y * 2.7 + t * 0.6));
}

fn rotateHead(p: vec3f, yaw: f32, pitch: f32, roll: f32) -> vec3f {
  var q = p - PIVOT;
  let cy = cos(yaw); let sy = sin(yaw);
  q = vec3f(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  let cp = cos(pitch); let sp = sin(pitch);
  q = vec3f(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
  let cr = cos(roll); let sr = sin(roll);
  q = vec3f(q.x * cr - q.y * sr, q.x * sr + q.y * cr, q.z);
  return q + PIVOT;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let count = u32(u.sim2.z);
  if (i >= count) { return; }

  // --- 1. face target: rest pose + weighted blendshape deltas -------------
  let b = base[i];
  let hw = mix(b.w, 1.0, u.style.x);
  var p = b.xyz;
  for (var k = 0u; k < K; k++) {
    let w = u.weights[k / 4u][k % 4u];
    if (abs(w) > 0.001) {
      let d = deltas[i * K + k];
      p += vec3f(unpack2x16float(d.x), unpack2x16float(d.y).x) * w;
    }
  }
  p = rotateHead(p, u.head.x * hw, u.head.y * hw, u.head.z * hw);
  let faceT = p * u.faceXf.w + u.faceXf.xyz;

  // --- 2. morph target (spinning around Y) ---------------------------------
  let m = morph[i].xyz;
  let cs = cos(u.sim2.y); let sn = sin(u.sim2.y);
  let ms = vec3f(m.x * cs + m.z * sn, m.y, -m.x * sn + m.z * cs) * u.shapeXf.w + u.shapeXf.xyz;
  let tgt = mix(ms, faceT, u.head.w);

  // --- 3. forces -----------------------------------------------------------
  var P = pos[i].xyz;
  var V = vel[i].xyz;
  let seed = hash(i);
  let t = u.sim.x;
  let dt = u.sim.y;
  var acc = (tgt - P) * u.sim.z * (0.55 + 0.9 * seed);

  // pointer: distance from the camera ray through the cursor
  let rel = P - u.rayO.xyz;
  let closest = u.rayO.xyz + u.rayD.xyz * dot(rel, u.rayD.xyz);
  let off = P - closest;
  let dist = length(off);
  let R = u.rayD.w;
  if (dist < R) {
    var fall = 1.0 - dist / R;
    fall = fall * fall;
    let dir = off / max(dist, 1e-4);
    acc += dir * u.rayO.w * fall;
    acc += cross(u.rayD.xyz, dir) * u.ptrVel.w * fall;
    acc += u.ptrVel.xyz * fall * 6.0;
  }

  // click shockwave: an expanding spherical ring
  let age = t - u.shock.w;
  if (age >= 0.0 && age < 2.5) {
    let sd = P - u.shock.xyz;
    let d = length(sd);
    let ring = exp(-pow((d - age * 3.5) / 0.3, 2.0)) * exp(-age * 1.5);
    acc += (sd / max(d, 1e-4)) * vec3f(1.0, 1.0, 0.25) * ring * 45.0;
  }

  acc += flow(P * 1.3 + seed * 2.0, t * 0.6) * u.sim2.x;

  // --- 4. integrate (semi-implicit Euler, exponential damping) ------------
  V = (V + acc * dt) * exp(-u.sim.w * dt);
  P += V * dt;
  pos[i] = vec4f(P, 1.0);
  vel[i] = vec4f(V, 0.0);
}
`;

/** Instanced camera-facing quads; storage buffers are read in the vertex stage. */
export const RENDER_WGSL = /* wgsl */ `
${UNIFORMS}
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> color: array<vec4f>;
@group(0) @binding(4) var<storage, read> morph: array<vec4f>;
@group(0) @binding(5) var<storage, read> base: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) i: u32) -> VOut {
  let P = pos[i].xyz;
  let V = vel[i].xyz;
  let c = color[i];
  let seed = hash(i);
  let faceMix = u.head.w;

  let lum = dot(c.rgb, vec3f(0.299, 0.587, 0.114));
  let g = clamp(base[i].y * 0.45 + 0.5 + (seed - 0.5) * 0.15, 0.0, 1.0);
  let holo = mix(u.colA.rgb, u.colB.rgb, g) * (0.18 + lum * 1.35);
  let faceCol = mix(holo, c.rgb, u.colA.w);
  let shapeCol = mix(u.colA.rgb, u.colB.rgb, morph[i].w) * (0.75 + seed * 0.5);
  var col = mix(shapeCol, faceCol, faceMix);
  col += u.colB.rgb * min(length(V) * 0.12, 0.9);
  col *= u.colB.w;
  let bw = base[i].w;
  // dot mode: hidden spare particles sparkle while they move
  let dotA = max(c.a, min(length(V) * 0.3, 0.85));
  let alpha = mix(1.0, mix(c.a, dotA, u.style.x), faceMix);
  if (alpha < 0.004) {
    var o: VOut;
    o.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    o.uv = vec2f(0.0);
    o.col = vec4f(0.0);
    return o;
  }

  var clip = u.viewProj * vec4f(P, 1.0);
  let sizeK = mix(0.7 + seed * 0.6, mix(1.0, bw * u.style.y, faceMix), u.style.x);
  var px = max(u.sim2.w * sizeK * u.view.z * u.view.y * 0.5 / clip.w, 0.9);
  px = min(px, 7.0 * u.view.y / 900.0);
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let corner = corners[vi];
  clip = vec4f(clip.xy + corner * px * 2.0 / u.view.xy * clip.w, clip.zw);

  var o: VOut;
  o.clip = clip;
  o.uv = corner;
  o.col = vec4f(col, alpha);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv);
  if (r > 1.0) { discard; }
  let a = smoothstep(1.0, 0.35, r) * in.col.a;
  return vec4f(in.col.rgb * a, a * (1.0 - u.view.w));
}
`;
