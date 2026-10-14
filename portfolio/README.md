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

- **photo**: a complete 3D head of up to 140k particles. The face is my photo on a real 3D face mesh, the sides and back are a hair-and-skull shell built from my silhouette, and there is a mouth (cavity and teeth) that shows when the jaw opens. Drag the face (or type `spin`) to look all the way round.
- **sphere**: the portrait projected onto a 3D ellipsoidal head covered in evenly spaced dots (a Fibonacci lattice), with gaps between them. Dots are halftone-sized by brightness, so the gaps draw the eyes, brows and hair. The back of the globe keeps faint shell dots, and the head slowly turns on its own to show its depth. Spare particles hide on real dots and only sparkle into view when the face gets scattered.

Both styles share the same blendshapes, physics and scenes. Switching swaps the GPU buffers in place (`engine.setFace`), and the particles fly to their new positions.

## Baking the face

The face is baked offline from several of my photos, which stay local in `private/` (gitignored) and are never committed. Only sampled points ship, in `public/face.bin` (64k points, about 640 KB).

1. `tools/detect.html` runs MediaPipe FaceLandmarker (478 3D landmarks) and the multiclass selfie segmenter (hair / face skin / body skin / clothes) on every photo: `node tools/run-detect.mjs http://localhost:5173 private/detect private/*.jpg`
2. `tools/bake_face.py <texture> public/face.bin` aligns all landmark sets (Umeyama) and takes the median as a consensus 3D shape. It maps the texture photo onto that shape (Delaunay-interpolated mesh depth) and undoes the photo's head tilt. It closes the head with a **silhouette lathe**: each row is an ellipse whose width comes from my real outline, whose front matches the mesh, and whose back is a rounder skull; the sides and back are coloured from the hair at the matching height. It also adds a mouth interior, normalises exposure, and blue-noise samples the photo, weighting steep surfaces more. Per-point normals, the 478 landmarks and their triangulation are written to the same file.

## How the face works

1. **Sampling** (`src/face/sampler.ts`): particles take the baked pool in order (any prefix is an even subsample). The sphere style looks up colours in it through a spatial grid.
2. **Depth**: real, from the consensus of MediaPipe face meshes across several photos (see *Baking the face*). There is no depth buffer. Each particle's normal rides in spare half floats of its blendshape data, and the compute shader fades out points facing away from the camera. Draw order (mouth, then face, then shell) takes care of the rest.
3. **Expressions** come from a **landmark rig** (`src/face/rig.ts`). The 12 blendshapes (blink L/R, smile L/R, jaw, brow up/down, frown, gaze X/Y, eyes wide, single brow) are authored as displacements of the 478 face-mesh landmarks:
   - blinks move each upper-lid landmark onto its lower-lid partner;
   - smiles pull the real lip corners up and back and lift the cheeks;
   - the jaw rotates about its hinge.
   Each particle is bound to a landmark triangle with barycentric weights, and the GPU blends the 12 shapes every frame.
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
