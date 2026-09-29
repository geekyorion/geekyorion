import { SHAPES, U, type Engine, type ParticleData } from './types';

/** Texture width for per-particle state. Particle i lives at (i % W, i / W). */
const W = 512;
/** Texture width for blendshape deltas. Entry j = i * SHAPES + k. */
const DW = 2048;

const UNIFORM_BLOCK = /* glsl */ `
layout(std140) uniform Uniforms {
  mat4 viewProj;
  vec4 rayO;
  vec4 rayD;
  vec4 ptrVel;
  vec4 shock;
  vec4 head;
  vec4 faceXf;
  vec4 shapeXf;
  vec4 sim;
  vec4 sim2;
  vec4 view;
  vec4 colA;
  vec4 colB;
  vec4 weights[3];
} u;

float hash(uint i) {
  uint x = i * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return float(x) / 4294967295.0;
}
ivec2 cell(int i) { return ivec2(i % ${W}, i / ${W}); }
`;

const QUAD_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Same algorithm as COMPUTE_WGSL, expressed as a full-screen fragment pass (GPGPU). */
const SIM_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
${UNIFORM_BLOCK}
uniform highp sampler2D uBase;
uniform highp sampler2D uMorph;
uniform highp sampler2D uPos;
uniform highp sampler2D uVel;
uniform usampler2D uDeltas;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

const vec3 PIVOT = vec3(0.0, -0.35, -0.25);

vec3 flow(vec3 p, float t) {
  return vec3(
    sin(p.y * 1.7 + t) + sin(p.z * 2.3 - t * 0.7),
    sin(p.z * 1.9 + t * 1.1) + sin(p.x * 2.1 + t * 0.5),
    sin(p.x * 1.5 - t * 0.9) + sin(p.y * 2.7 + t * 0.6));
}

vec3 rotateHead(vec3 p, float yaw, float pitch, float roll) {
  vec3 q = p - PIVOT;
  float cy = cos(yaw), sy = sin(yaw);
  q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  float cp = cos(pitch), sp = sin(pitch);
  q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
  float cr = cos(roll), sr = sin(roll);
  q = vec3(q.x * cr - q.y * sr, q.x * sr + q.y * cr, q.z);
  return q + PIVOT;
}

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  int i = tc.y * ${W} + tc.x;
  if (i >= int(u.sim2.z)) { oPos = vec4(0.0); oVel = vec4(0.0); return; }

  vec4 b = texelFetch(uBase, tc, 0);
  vec3 p = b.xyz;
  for (int k = 0; k < ${SHAPES}; k++) {
    float w = u.weights[k / 4][k % 4];
    if (abs(w) > 0.001) {
      int j = i * ${SHAPES} + k;
      uvec2 d = texelFetch(uDeltas, ivec2(j % ${DW}, j / ${DW}), 0).xy;
      p += vec3(unpackHalf2x16(d.x), unpackHalf2x16(d.y).x) * w;
    }
  }
  p = rotateHead(p, u.head.x * b.w, u.head.y * b.w, u.head.z * b.w);
  vec3 faceT = p * u.faceXf.w + u.faceXf.xyz;

  vec3 m = texelFetch(uMorph, tc, 0).xyz;
  float cs = cos(u.sim2.y), sn = sin(u.sim2.y);
  vec3 ms = vec3(m.x * cs + m.z * sn, m.y, -m.x * sn + m.z * cs) * u.shapeXf.w + u.shapeXf.xyz;
  vec3 tgt = mix(ms, faceT, u.head.w);

  vec3 P = texelFetch(uPos, tc, 0).xyz;
  vec3 V = texelFetch(uVel, tc, 0).xyz;
  float seed = hash(uint(i));
  float t = u.sim.x;
  float dt = u.sim.y;
  vec3 acc = (tgt - P) * u.sim.z * (0.55 + 0.9 * seed);

  vec3 rel = P - u.rayO.xyz;
  vec3 closest = u.rayO.xyz + u.rayD.xyz * dot(rel, u.rayD.xyz);
  vec3 off = P - closest;
  float dist = length(off);
  float R = u.rayD.w;
  if (dist < R) {
    float fall = 1.0 - dist / R;
    fall *= fall;
    vec3 dir = off / max(dist, 1e-4);
    acc += dir * u.rayO.w * fall;
    acc += cross(u.rayD.xyz, dir) * u.ptrVel.w * fall;
    acc += u.ptrVel.xyz * fall * 6.0;
  }

  float age = t - u.shock.w;
  if (age >= 0.0 && age < 2.5) {
    vec3 sd = P - u.shock.xyz;
    float d = length(sd);
    float ring = exp(-pow((d - age * 3.5) / 0.3, 2.0)) * exp(-age * 1.5);
    acc += (sd / max(d, 1e-4)) * vec3(1.0, 1.0, 0.25) * ring * 45.0;
  }

  acc += flow(P * 1.3 + seed * 2.0, t * 0.6) * u.sim2.x;

  V = (V + acc * dt) * exp(-u.sim.w * dt);
  P += V * dt;
  oPos = vec4(P, 1.0);
  oVel = vec4(V, 0.0);
}`;

const DRAW_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
${UNIFORM_BLOCK}
uniform highp sampler2D uPos;
uniform highp sampler2D uVel;
uniform highp sampler2D uColor;
uniform highp sampler2D uMorph;
uniform highp sampler2D uBase;
out vec4 vCol;

void main() {
  int i = gl_VertexID;
  ivec2 tc = cell(i);
  vec3 P = texelFetch(uPos, tc, 0).xyz;
  vec3 V = texelFetch(uVel, tc, 0).xyz;
  vec4 c = texelFetch(uColor, tc, 0);
  float seed = hash(uint(i));
  float faceMix = u.head.w;

  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float g = clamp(texelFetch(uBase, tc, 0).y * 0.45 + 0.5 + (seed - 0.5) * 0.15, 0.0, 1.0);
  vec3 holo = mix(u.colA.rgb, u.colB.rgb, g) * (0.18 + lum * 1.35);
  vec3 faceCol = mix(holo, c.rgb, u.colA.w);
  vec3 shapeCol = mix(u.colA.rgb, u.colB.rgb, texelFetch(uMorph, tc, 0).w) * (0.75 + seed * 0.5);
  vec3 col = mix(shapeCol, faceCol, faceMix);
  col += u.colB.rgb * min(length(V) * 0.12, 0.9);
  col *= u.colB.w;
  vCol = vec4(col, mix(1.0, c.a, faceMix));

  vec4 clip = u.viewProj * vec4(P, 1.0);
  float px = max(u.sim2.w * (0.7 + seed * 0.6) * u.view.z * u.view.y * 0.5 / clip.w, 0.9);
  px = min(px, 7.0 * u.view.y / 900.0);
  gl_Position = clip;
  gl_PointSize = px * 2.0;
}`;

const DRAW_FS = /* glsl */ `#version 300 es
precision highp float;
${UNIFORM_BLOCK}
in vec4 vCol;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.35, r) * vCol.a;
  outColor = vec4(vCol.rgb * a, a * (1.0 - u.view.w));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, 'Uniforms'), 0);
  return prog;
}

export function createWebGL2Engine(canvas: HTMLCanvasElement, data: ParticleData): Engine | null {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;

  const n = data.count;
  const H = Math.ceil(n / W);

  const floatTex = (src: Float32Array | null) => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    let pixels: Float32Array | null = null;
    if (src) {
      pixels = new Float32Array(W * H * 4);
      pixels.set(src.subarray(0, Math.min(src.length, pixels.length)));
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  };

  const baseTex = floatTex(data.base);
  const colorTex = floatTex(data.color);
  const morphTex = floatTex(new Float32Array(n * 4));
  const pos = [floatTex(data.start), floatTex(data.start)];
  const vel = [floatTex(null), floatTex(null)];
  // floatTex(null) leaves the texture undefined; zero velocity explicitly
  for (const v of vel) {
    gl.bindTexture(gl.TEXTURE_2D, v);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, new Float32Array(W * H * 4));
  }

  const DH = Math.ceil((n * SHAPES) / DW);
  const deltaTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, deltaTex);
  const deltaPixels = new Uint32Array(DW * DH * 2);
  deltaPixels.set(data.deltas);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, DW, DH, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, deltaPixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const fbos = [0, 1].map((k) => {
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos[k], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel[k], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete framebuffer');
    return fb;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let simProg: WebGLProgram, drawProg: WebGLProgram;
  try {
    simProg = compile(gl, QUAD_VS, SIM_FS);
    drawProg = compile(gl, DRAW_VS, DRAW_FS);
  } catch (e) {
    console.warn('[webgl2] shader compile failed', e);
    return null;
  }

  const ubo = gl.createBuffer()!;
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, U.FLOATS * 4, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);

  const vao = gl.createVertexArray();
  const bindTex = (prog: WebGLProgram, name: string, unit: number, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  };

  let cur = 0;
  return {
    kind: 'webgl2',
    setMorph(target) {
      const pixels = new Float32Array(W * H * 4);
      pixels.set(target.subarray(0, pixels.length));
      gl.bindTexture(gl.TEXTURE_2D, morphTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, pixels);
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },
    frame(uniforms) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
      gl.bindVertexArray(vao);

      // simulation pass: read [cur], write [next]
      const next = 1 - cur;
      gl.useProgram(simProg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[next]);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      bindTex(simProg, 'uBase', 0, baseTex);
      bindTex(simProg, 'uMorph', 1, morphTex);
      bindTex(simProg, 'uPos', 2, pos[cur]);
      bindTex(simProg, 'uVel', 3, vel[cur]);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, deltaTex);
      gl.uniform1i(gl.getUniformLocation(simProg, 'uDeltas'), 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = next;

      // draw pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(drawProg);
      bindTex(drawProg, 'uPos', 0, pos[cur]);
      bindTex(drawProg, 'uVel', 1, vel[cur]);
      bindTex(drawProg, 'uColor', 2, colorTex);
      bindTex(drawProg, 'uMorph', 3, morphTex);
      bindTex(drawProg, 'uBase', 4, baseTex);
      gl.drawArrays(gl.POINTS, 0, n);
    },
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
