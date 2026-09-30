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

## Two faces

Toggle with the **face** chip in the dock, the `f` key, or `style sphere|photo` in the terminal. The choice is remembered, and `?face=sphere` links straight to the sphere face.

- **photo**: ~100k particles importance-sampled from the portrait, as a dense and colourful point cloud.
- **sphere**: the portrait projected onto a 3D ellipsoidal head covered in evenly spaced dots (a Fibonacci lattice), with gaps between them. Dots are halftone-sized by brightness, so the gaps draw the eyes, brows and hair. The back of the globe keeps faint shell dots, and the head slowly turns on its own to show its depth. Spare particles hide on real dots and only sparkle into view when the face gets scattered.

Both styles share the same blendshapes, physics and scenes. Switching swaps the GPU buffers in place (`engine.setFace`), and the particles fly to their new positions.

## Baking the face

The face is baked offline from several of my photos, which stay local in `private/` (gitignored) and are never committed. Only sampled points ship, in `public/face.bin` (64k points, about 640 KB).

1. `tools/detect.html` runs MediaPipe FaceLandmarker (478 3D landmarks) and the multiclass selfie segmenter (hair / face skin / body skin / clothes) on every photo: `node tools/run-detect.mjs http://localhost:5173 private/detect private/*.jpg`
2. `tools/bake_face.py <texture> public/face.bin` aligns all landmark sets (Umeyama), takes the median as a consensus 3D shape, maps the texture photo onto it (Delaunay-interpolated mesh depth, with a hair/neck proxy continuous with it), undoes the photo's head tilt, normalises exposure, and importance-samples a shuffled point pool. The landmarks that drive the expressions are written into the same file.

## How the face works

1. **Sampling** (`src/face/sampler.ts`): particles take the baked pool in order (any prefix is an even subsample). The sphere style looks up colours in it through a spatial grid.
2. **Depth**: real, from the consensus of MediaPipe face meshes across several photos (see *Baking the face*).
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
