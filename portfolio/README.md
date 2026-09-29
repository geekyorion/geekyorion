# geekyorion · particle portfolio

My portfolio, rendered as a face made of ~100,000 GPU particles. Move the cursor and they scatter, click and a shockwave rolls through, press `1`–`9` and the face changes expression. Scroll and the particles re-form as a git graph, a terrain and a tech-stack globe. Open the terminal with `` ` `` and type `help`.

No three.js and no 3D models: a hand-written engine with two backends that share one data layout.

| | WebGPU (preferred) | WebGL2 (fallback) |
| --- | --- | --- |
| simulation | WGSL compute shader, one thread per particle | GLSL fragment pass over float textures (GPGPU ping-pong, MRT) |
| rendering | instanced quads reading storage buffers in the vertex stage | `gl.POINTS` fetching state with `texelFetch` |
| blendshapes | `array<vec2u>` + `unpack2x16float` | `RG32UI` texture + `unpackHalf2x16` |
| uniforms | one uniform buffer | one std140 UBO (identical layout) |

With no GPU at all, the page falls back to a static portrait, and all the content stays readable.

## How the face works

1. **Sampling** (`src/face/sampler.ts`): the portrait is flood-filled to remove the background, then importance-sampled so that edges (eyes, brows, lips, hair) get more particles than flat skin.
2. **Depth**: a synthetic depth model built from an ellipsoid head, a nose ridge, eye sockets, lips, chin, neck and shoulders, all placed from hand-measured landmarks (`src/face/landmarks.ts`).
3. **Expressions** are 12 blendshapes (blink L/R, smile L/R, jaw, brow up/down, frown, gaze X/Y, eyes wide, single brow). Each is a per-particle displacement field computed on the CPU once and stored as half floats. The GPU blends them each frame with 12 weights, then rotates the head toward the cursor.
4. **Physics**: every particle is a damped spring to its target, plus a force field from the pointer ray (repel, swirl, drag), a hold-to-attract gravity well, click shockwaves, and curl-ish turbulence.
5. **Mirror me** (optional): MediaPipe FaceLandmarker (float16, about 3.6 MB, on-device) turns the visitor's webcam into ARKit-style blendshapes, which map 1:1 onto the particle blendshapes. It is lazy-loaded only on opt-in, and no frame leaves the browser.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build to dist/
```

Useful query params: `?backend=webgl2` forces the fallback, and `?n=50000` sets the particle count.

Deployed to GitHub Pages by `.github/workflows/deploy-portfolio.yml` on every push to `main` that touches `portfolio/`.
