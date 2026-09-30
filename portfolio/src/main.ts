import './style.css';
import { createEngine } from './engine';
import { U, type Engine } from './engine/types';
import { EXPRESSION_NAMES, ExpressionAnimator, type ExpressionName } from './face/expressions';
import { Mirror } from './face/mirror';
import { loadPortrait, sampleFace, sampleSphereFace } from './face/sampler';
import { clamp, damp, lerp } from './math';
import { Camera } from './scene/camera';
import { makeShape, type ShapeName } from './scene/shapes';
import { renderSections, typewriter } from './ui/sections';
import { Terminal } from './ui/terminal';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 800;

renderSections();
typewriter($('typed'), ['front-end engineer', 'micro-frontend architect', 'creative coder', 'shader tinkerer'], reducedMotion);

// ---------------------------------------------------------------- themes
interface Theme { name: string; a: number[]; b: number[]; photo: number; additive: number; bright: number }
const THEMES: Theme[] = [
  { name: 'photo', a: [0.21, 0.88, 1], b: [0.71, 0.55, 1], photo: 1, additive: 0, bright: 1 },
  { name: 'hologram', a: [0.1, 0.8, 1], b: [0.62, 0.35, 1], photo: 0, additive: 0.75, bright: 1.05 },
  { name: 'matrix', a: [0.05, 1, 0.35], b: [0.75, 1, 0.45], photo: 0, additive: 0.75, bright: 0.95 },
  { name: 'ember', a: [1, 0.42, 0.08], b: [1, 0.15, 0.5], photo: 0, additive: 0.75, bright: 1 },
];

// ---------------------------------------------------------------- scenes
interface Scene { face: number; shape?: ShapeName; arg?: string; expr: ExpressionName; spin: number; scale: number }
const SCENES: Record<string, Scene> = {
  hero: { face: 1, expr: 'smile', spin: 0, scale: 1 },
  whoami: { face: 1, expr: 'neutral', spin: 0, scale: 0.92 },
  experience: { face: 0, shape: 'git', expr: 'neutral', spin: 0, scale: 1 },
  projects: { face: 0, shape: 'terrain', expr: 'neutral', spin: 0, scale: 1 },
  stack: { face: 0, shape: 'sphere', expr: 'neutral', spin: 0.25, scale: 0.95 },
  contact: { face: 1, expr: 'wink', spin: 0, scale: 0.95 },
};

// ---------------------------------------------------------------- state
const state = {
  time: 0,
  section: 'hero',
  override: null as Scene | null,
  faceMix: 1,
  shapeKey: '',
  spin: 0,
  turb: reducedMotion ? 0 : 0.9,
  theme: 0,
  col: { a: [...THEMES[0].a], b: [...THEMES[0].b], photo: 1, additive: 0, bright: 1 },
  offset: [0, 0, 0],
  scale: 1,
  pointer: { x: 0, y: 0, active: false, lastMove: -10, down: false, downAt: 0, inside: false },
  shock: { at: [0, 0, 0], t: -10 },
  annoyance: 0,
  dpr: Math.min(devicePixelRatio, coarse ? 1.5 : 2),
  fps: 60,
};

const expr = new ExpressionAnimator();
const camera = new Camera();
const mirror = new Mirror($<HTMLVideoElement>('cam'));

function toast(msg: string, ms = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((t as any)._h);
  (t as any)._h = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- boot
const hasGPU = 'gpu' in navigator && params.get('backend') !== 'webgl2';
const count = Number(params.get('n')) || (coarse ? 40000 : hasGPU ? 100000 : 70000);
// two face styles from one portrait: dense photo particles, or a dotted 3D sphere
type FaceStyle = 'photo' | 'sphere';
const FACE_STYLES: FaceStyle[] = ['photo', 'sphere'];
const storedStyle = (() => { try { return localStorage.getItem('face-style'); } catch { return null; } })();
let faceStyle: FaceStyle = (params.get('face') ?? storedStyle) === 'sphere' ? 'sphere' : 'photo';
const dots = Number(params.get('dots')) || (coarse ? 11000 : 17000);
const portrait = await loadPortrait(`${import.meta.env.BASE_URL}face.jpg`);
const faces: Partial<Record<FaceStyle, ReturnType<typeof sampleFace>>> = {};
const faceData = (style: FaceStyle) =>
  (faces[style] ??= style === 'sphere' ? sampleSphereFace(portrait, { count, dots }) : sampleFace(portrait, { count }));
const data = faceData(faceStyle);
if (reducedMotion) data.start.set(data.base);
const engine: Engine | null = await createEngine($<HTMLCanvasElement>('gl'), data);

const hudBackend = $('hud-backend');
if (!engine) {
  document.body.classList.add('no-gpu');
  hudBackend.textContent = 'no gpu · static mode';
  $('foot-backend').textContent = 'static fallback';
} else {
  hudBackend.textContent = engine.kind === 'webgpu' ? 'WebGPU · compute' : 'WebGL2 · gpgpu';
  hudBackend.classList.add(engine.kind);
  $('hud-count').textContent = `${(data.count / 1000).toFixed(0)}k particles`;
  $('foot-backend').textContent = `running on ${engine.kind}`;
}

// ---------------------------------------------------------------- scene control
function activeScene() {
  return state.override ?? SCENES[state.section];
}

function applyScene(burst = true) {
  const s = activeScene();
  const key = s.shape ? `${s.shape}:${s.arg ?? ''}` : state.shapeKey;
  if (s.shape && key !== state.shapeKey && engine) {
    engine.setMorph(makeShape(s.shape, data.count, s.arg));
    state.shapeKey = key;
  }
  if (!mirror.active) expr.setResting(s.expr, state.time);
  if (burst && !reducedMotion) state.turb = Math.max(state.turb, 0.35);
}

function setSection(id: string) {
  if (id === state.section || !SCENES[id]) return;
  state.section = id;
  state.override = null;
  document.querySelectorAll('.topbar nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  applyScene();
}

const sections = [...document.querySelectorAll<HTMLElement>('[data-section]')];
function pickSection() {
  const mid = innerHeight * 0.5;
  let best = sections[0];
  for (const s of sections) if (s.getBoundingClientRect().top <= mid) best = s;
  setSection(best.dataset.section!);
}
addEventListener('scroll', pickSection, { passive: true });

// ---------------------------------------------------------------- api (terminal + dock)
const api = {
  expression(name: ExpressionName) {
    expr.set(name, 0, state.time);
    syncExprButtons();
  },
  say(text: string) {
    toast(`🗨 ${text}`, 1200 + text.length * 60);
    expr.talk(0.4 + text.length * 0.07, state.time);
  },
  talk(seconds: number) {
    expr.talk(seconds, state.time);
  },
  morph(text: string) {
    state.override = { face: 0, shape: 'text', arg: text, expr: 'neutral', spin: 0, scale: 1 };
    applyScene();
  },
  shape(name: ShapeName) {
    state.override = { face: 0, shape: name, expr: 'neutral', spin: name === 'terrain' || name === 'git' ? 0 : 0.35, scale: 1 };
    applyScene();
  },
  faceStyles: FACE_STYLES as string[],
  faceStyle(style?: string) {
    const next = (style as FaceStyle) ?? FACE_STYLES[(FACE_STYLES.indexOf(faceStyle) + 1) % FACE_STYLES.length];
    if (!FACE_STYLES.includes(next)) return faceStyle;
    if (next !== faceStyle) {
      faceStyle = next;
      engine?.setFace(faceData(next));
      try { localStorage.setItem('face-style', next); } catch { /* private mode */ }
      if (!reducedMotion) state.turb = Math.max(state.turb, 0.5);
    }
    syncFaceButton();
    if (activeScene().face < 0.5) api.face();
    return faceStyle;
  },
  face() {
    state.override = { ...SCENES[state.section], face: 1, shape: undefined };
    applyScene();
  },
  themes: THEMES.map((t) => t.name),
  theme(name?: string) {
    state.theme = name ? THEMES.findIndex((t) => t.name === name) : (state.theme + 1) % THEMES.length;
    return THEMES[state.theme].name;
  },
  explode() {
    state.shock = { at: [state.offset[0], state.offset[1], 0], t: state.time };
    state.turb = 2.2;
    expr.set('surprised', 1.4, state.time);
  },
  async mirror(on: boolean) {
    const btn = $('btn-mirror');
    if (!on) {
      mirror.stop();
      expr.external = null;
      btn.setAttribute('aria-pressed', 'false');
      applyScene(false);
      return;
    }
    await mirror.start((s) => toast(s, 2500));
    expr.external = mirror;
    btn.setAttribute('aria-pressed', 'true');
    api.face();
    document.getElementById('hero')?.scrollIntoView();
  },
  goto(section: string) {
    const el = document.getElementById(section === 'exp' ? 'experience' : section);
    el?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  },
  stats() {
    return `${engine?.kind ?? 'no-gpu'} · ${faceStyle} face · ${data.count.toLocaleString()} particles · ${Math.round(state.fps)} fps`;
  },
};

const term = new Terminal($('term'), $('term-out'), $<HTMLInputElement>('term-input'), api);

// ---------------------------------------------------------------- dock
const exprWrap = $('expr-buttons');
const DOCK_EXPR: ExpressionName[] = ['neutral', 'smile', 'laugh', 'surprised', 'wink', 'skeptic', 'angry', 'sad', 'sleepy'];
exprWrap.innerHTML = DOCK_EXPR.map((e, i) => `<button class="chip" type="button" data-expr="${e}" aria-pressed="false"><span class="k">${i + 1}</span>${e}</button>`).join('');
function syncExprButtons() {
  exprWrap.querySelectorAll<HTMLButtonElement>('[data-expr]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.expr === expr.current)));
}
exprWrap.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-expr]');
  if (!b) return;
  if (activeScene().face < 0.5) api.face();
  api.expression(b.dataset.expr as ExpressionName);
});
$('btn-theme').addEventListener('click', () => toast(`theme: ${api.theme()}`));
function syncFaceButton() {
  const b = $('btn-face');
  b.textContent = `face: ${faceStyle}`;
  b.setAttribute('aria-pressed', String(faceStyle === 'sphere'));
}
$('btn-face').addEventListener('click', () => toast(`face: ${api.faceStyle()}`));
syncFaceButton();
$('btn-term').addEventListener('click', () => term.toggle());
$('term-close').addEventListener('click', () => term.toggle(false));
$('btn-mirror').addEventListener('click', () => {
  api.mirror(!mirror.active).catch((e) => toast(`mirror failed: ${e.message}`, 3000));
});

// ---------------------------------------------------------------- input
const setPointer = (e: PointerEvent) => {
  state.pointer.x = (e.clientX / innerWidth) * 2 - 1;
  state.pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  state.pointer.lastMove = state.time;
  state.pointer.inside = true;
};
addEventListener('pointermove', setPointer, { passive: true });
addEventListener('pointerdown', (e) => {
  setPointer(e);
  const t = e.target as HTMLElement;
  if (t.closest('a, button, input, .panel, .gitlog, .proj, .term, .dock')) return;
  state.pointer.down = true;
  state.pointer.downAt = state.time;
  state.shock = { at: [...camera.hit], t: state.time };
  const d = Math.hypot(camera.hit[0] - state.offset[0], camera.hit[1] - state.offset[1]);
  if (activeScene().face > 0.5 && d < 1.2 * state.scale && !mirror.active) expr.set('surprised', 0.9, state.time);
});
addEventListener('pointerup', () => { state.pointer.down = false; });
addEventListener('pointercancel', () => { state.pointer.down = false; state.pointer.inside = false; });
document.addEventListener('pointerleave', () => { state.pointer.inside = false; });

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === '`' || e.key === '~') { e.preventDefault(); term.toggle(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= DOCK_EXPR.length) {
    if (activeScene().face < 0.5) api.face();
    api.expression(DOCK_EXPR[n - 1]);
  } else if (e.key === 't') toast(`theme: ${api.theme()}`);
  else if (e.key === 'f') toast(`face: ${api.faceStyle()}`);
  else if (e.key === 'x') api.explode();
});

// ---------------------------------------------------------------- frame loop
const uni = new Float32Array(U.FLOATS);
// keep coverage constant: fewer particles -> bigger particles
const particleSize = 0.0088 * Math.sqrt(100000 / data.count);
// sphere dots: a fixed world-space dot radius, whatever the particle count
const dotScale = 0.0072 / particleSize;
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, slowFor = 0;
let shownExpr = '';

function layout() {
  // where the particles live: to the right of the content column on wide screens, above it on phones
  const aspect = innerWidth / innerHeight;
  const hh = camera.halfHeight;
  const hw = hh * aspect;
  const s = activeScene();
  if (aspect > 1.15) {
    const x = Math.min(hw * 0.4, hw - 1.1);
    return { x: Math.max(x, 0.6), y: s.face ? 0.08 : 0, scale: s.scale * 0.84 * Math.min(1, aspect / 1.3) };
  }
  const scale = s.scale * clamp(hw / 1.7, 0.5, 0.85);
  return { x: 0, y: hh * 0.45, scale };
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.033, rawDt);
  state.time += dt;
  const t = state.time;

  // fps + adaptive resolution
  fpsAcc += rawDt; fpsFrames++;
  if (fpsAcc > 0.5) {
    state.fps = fpsFrames / fpsAcc;
    $('hud-fps').textContent = `${Math.round(state.fps)} fps`;
    slowFor = state.fps < 40 ? slowFor + fpsAcc : 0;
    if (slowFor > 2 && state.dpr > 1) { state.dpr = Math.max(1, state.dpr - 0.25); slowFor = 0; }
    fpsAcc = 0; fpsFrames = 0;
  }
  if (!engine) return;

  const w = Math.floor(innerWidth * state.dpr), h = Math.floor(innerHeight * state.dpr);
  const canvas = $<HTMLCanvasElement>('gl');
  if (canvas.width !== w || canvas.height !== h) engine.resize(w, h);

  // pointer
  const p = state.pointer;
  const moving = p.inside && t - p.lastMove < 2.5;
  camera.update(w, h, p.x, p.y, dt, reducedMotion ? 0 : 1);

  // scene blending
  const scene = activeScene();
  const L = layout();
  const k = damp(3.2, dt);
  state.faceMix = lerp(state.faceMix, scene.face, damp(2.6, dt));
  state.offset[0] = lerp(state.offset[0], L.x, k);
  state.offset[1] = lerp(state.offset[1], L.y, k);
  state.scale = lerp(state.scale, L.scale, k);
  state.spin += scene.spin * dt;
  state.turb = lerp(state.turb, reducedMotion ? 0 : 0.03, damp(1.2, dt));

  // face reacts to being scattered
  const speed = Math.hypot(camera.hitVel[0], camera.hitVel[1]);
  const overFace = Math.hypot(camera.hit[0] - state.offset[0], camera.hit[1] - state.offset[1]) < 1.1 * state.scale;
  if (moving && overFace && speed > 5 && scene.face > 0.5) state.annoyance += dt * speed * 0.12;
  state.annoyance = Math.max(0, state.annoyance - dt * 0.6);
  if (state.annoyance > 2.5 && !mirror.active) {
    state.annoyance = 0;
    expr.set(Math.random() < 0.5 ? 'surprised' : 'laugh', 1.3, t);
    toast(['// hey, that tickles', '// careful, those are my pixels', '// 100k particles, zero chill'][(Math.random() * 3) | 0]);
  }

  // expression + gaze
  const gx = clamp((camera.hit[0] - state.offset[0]) / (1.6 * state.scale), -1, 1);
  const gy = clamp((camera.hit[1] - state.offset[1] - 0.25 * state.scale) / (1.3 * state.scale), -1, 1);
  const look = moving ? 1 : 0;
  expr.update(t, dt, gx * look, -gy * look);
  if (expr.current !== shownExpr) { shownExpr = expr.current; syncExprButtons(); }
  // the sphere slowly turns on its own so its depth reads even without a cursor
  const showcase = faceStyle === 'sphere' && !reducedMotion ? Math.sin(t * 0.35) * 0.45 * (1 - look) : 0;
  const yaw = mirror.active ? expr.head[0] : expr.head[0] + gx * 0.32 * look + showcase;
  const pitch = mirror.active ? expr.head[1] : expr.head[1] - gy * 0.18 * look;

  // colours
  const th = THEMES[state.theme];
  const kc = damp(4, dt);
  for (let i = 0; i < 3; i++) {
    state.col.a[i] = lerp(state.col.a[i], th.a[i], kc);
    state.col.b[i] = lerp(state.col.b[i], th.b[i], kc);
  }
  state.col.photo = lerp(state.col.photo, th.photo, kc);
  state.col.additive = lerp(state.col.additive, th.additive, kc);
  state.col.bright = lerp(state.col.bright, th.bright, kc);

  // pointer forces: repel while moving, a gravity well while held
  const held = p.down && t - p.downAt > 0.25;
  const strength = !moving ? 0 : held ? -26 : 22;
  const radius = held ? 0.8 : 0.34;

  uni.set(camera.viewProj, U.viewProj);
  uni.set([...camera.rayO, strength], U.rayO);
  uni.set([...camera.rayD, radius], U.rayD);
  uni.set([...camera.hitVel.map((v) => v * (moving ? 1 : 0)), held ? 9 : 4], U.ptrVel);
  uni.set([...state.shock.at, reducedMotion ? -10 : state.shock.t], U.shock);
  uni.set([yaw, pitch, expr.head[2], state.faceMix], U.head);
  uni.set([state.offset[0], state.offset[1], 0, state.scale], U.faceXf);
  uni.set([state.offset[0], state.offset[1], 0, state.scale * (innerWidth / innerHeight > 1.15 ? 1 : 0.85)], U.shapeXf);
  uni.set([t, dt, state.faceMix > 0.5 ? 55 : 32, 8.5], U.sim);
  uni.set([state.turb, state.spin, data.count, particleSize], U.sim2);
  uni.set([w, h, camera.proj11, state.col.additive], U.view);
  uni.set([...state.col.a, state.col.photo], U.colA);
  uni.set([...state.col.b, state.col.bright], U.colB);
  uni.set(expr.weights, U.weights);
  uni.set([faceStyle === 'sphere' ? 1 : 0, dotScale, 0, 0], U.style);
  engine.frame(uni);
}

applyScene(false);
expr.set('smile', 0, 0);
syncExprButtons();
pickSection();
requestAnimationFrame(frame);

// ---------------------------------------------------------------- test hooks
Object.assign(window, {
  __app: { state, expr, api, term, engine, data, EXPRESSION_NAMES },
  __snap: async () => {
    if (!engine?.capture) return $<HTMLCanvasElement>('gl').toDataURL('image/png');
    const img = await engine.capture(uni);
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    off.getContext('2d')!.putImageData(img, 0, 0);
    return off.toDataURL('image/png');
  },
});
