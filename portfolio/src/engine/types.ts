/**
 * Shared contract between the WebGPU and WebGL2 particle backends.
 *
 * Both backends consume the exact same CPU-side buffers and the exact same
 * uniform block layout (std140 == WGSL uniform layout for vec4/mat4 only),
 * so the simulation is bit-for-bit the same algorithm on either API.
 */

/** Number of blendshape slots per particle (face expressions). */
export const SHAPES = 12;

/** Float offsets into the uniform block. Every entry is a vec4 (or mat4). */
export const U = {
  viewProj: 0, //  mat4
  rayO: 16, //     xyz = pointer ray origin, w = repel strength
  rayD: 20, //     xyz = pointer ray dir,    w = radius
  ptrVel: 24, //   xyz = pointer world velocity, w = swirl
  shock: 28, //    xyz = shockwave centre, w = start time
  head: 32, //     x yaw, y pitch, z roll, w = faceMix (0 shape .. 1 face)
  faceXf: 36, //   xyz offset, w scale
  shapeXf: 40, //  xyz offset, w scale
  sim: 44, //      x time, y dt, z stiffness, w damping
  sim2: 48, //     x turbulence, y shape spin, z count, w particle size (world)
  view: 52, //     x viewport w, y viewport h, z proj[1][1], w additive (0..1)
  colA: 56, //     rgb theme A, w = photo amount (0 holo .. 1 photo)
  colB: 60, //     rgb theme B, w = brightness
  weights: 64, //  3 x vec4 = 12 blendshape weights
  style: 76, //    x = dot mode (sphere face: base.w is dot size), y = dot size scale
  FLOATS: 80,
} as const;

export interface ParticleData {
  count: number;
  /** xyz = rest position of the face, w = head weight (1 head .. 0 shirt) */
  base: Float32Array;
  /** rgb = photo colour (linear-ish), a = alpha */
  color: Float32Array;
  /** per particle, per shape: 2 x u32 = pack2x16float(dx,dy), pack2x16float(dz,0) */
  deltas: Uint32Array;
  /** initial particle positions (the intro "big bang") */
  start: Float32Array;
}

export interface Engine {
  readonly kind: 'webgpu' | 'webgl2';
  /** Upload a morph target: xyz = position, w = palette coordinate 0..1. */
  setMorph(target: Float32Array): void;
  /** Swap the face (rest pose, colours, blendshapes) without touching particle state. */
  setFace(data: Pick<ParticleData, 'base' | 'color' | 'deltas'>): void;
  resize(width: number, height: number): void;
  frame(uniforms: Float32Array): void;
  /** Test hook: render one frame offscreen and return its pixels. */
  capture?(uniforms: Float32Array): Promise<ImageData>;
  destroy(): void;
}
