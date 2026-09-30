import { SHAPES } from '../engine/types';
import { BS } from './landmarks';

/**
 * "Mirror me": the visitor's webcam drives my particle face.
 *
 * Model choice: MediaPipe FaceLandmarker (float16, ~3.6 MB) with blendshape
 * output. It runs fully on-device through WASM + the GPU delegate at 30+ fps,
 * and its ARKit-style blendshapes (eyeBlinkLeft, jawOpen, mouthSmileLeft...)
 * map one-to-one onto the particle blendshapes, so no retargeting network is
 * needed. It is lazy-loaded only when the visitor opts in; no frame ever
 * leaves the browser.
 */
const VERSION = '1.0.1';
// `?mp=<base>` lets local tests serve the package themselves
const CDN = new URLSearchParams(location.search).get('mp') ?? `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

interface Category { categoryName: string; score: number }
interface Landmarker {
  detectForVideo(video: HTMLVideoElement, ts: number): {
    faceBlendshapes?: { categories: Category[] }[];
    facialTransformationMatrixes?: { data: number[] }[];
  };
  close(): void;
}

export class Mirror {
  readonly weights = new Float32Array(SHAPES);
  readonly head: [number, number, number] = [0, 0, 0];
  active = false;
  private landmarker: Landmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastTs = -1;

  constructor(private video: HTMLVideoElement) {}

  async start(onStatus: (s: string) => void) {
    onStatus('requesting camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    this.video.hidden = false;
    await this.video.play();

    if (!this.landmarker) {
      onStatus('loading face model (3.6 MB, on-device)…');
      const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    }
    this.active = true;
    onStatus('mirroring: make a face!');
    this.loop();
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.hidden = true;
  }

  private loop = () => {
    if (!this.active || !this.landmarker) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.video.readyState < 2 || this.video.currentTime === this.lastTs) return;
    this.lastTs = this.video.currentTime;
    const res = this.landmarker.detectForVideo(this.video, performance.now());
    const cats = res.faceBlendshapes?.[0]?.categories;
    if (!cats) return;
    const s: Record<string, number> = {};
    for (const c of cats) s[c.categoryName] = c.score;

    // The video is shown mirrored, so the visitor's left maps to screen left.
    const w = this.weights;
    w.fill(0);
    w[BS.BlinkL] = s.eyeBlinkLeft ?? 0;
    w[BS.BlinkR] = s.eyeBlinkRight ?? 0;
    w[BS.SmileL] = s.mouthSmileLeft ?? 0;
    w[BS.SmileR] = s.mouthSmileRight ?? 0;
    w[BS.JawOpen] = s.jawOpen ?? 0;
    w[BS.BrowUp] = s.browInnerUp ?? 0;
    w[BS.BrowDown] = ((s.browDownLeft ?? 0) + (s.browDownRight ?? 0)) / 2;
    w[BS.Frown] = ((s.mouthFrownLeft ?? 0) + (s.mouthFrownRight ?? 0)) / 2;
    w[BS.EyeWide] = ((s.eyeWideLeft ?? 0) + (s.eyeWideRight ?? 0)) / 2;
    w[BS.BrowRaiseL] = Math.max(0, (s.browOuterUpLeft ?? 0) - (s.browOuterUpRight ?? 0));
    w[BS.LookX] = ((s.eyeLookOutLeft ?? 0) - (s.eyeLookInLeft ?? 0) + (s.eyeLookInRight ?? 0) - (s.eyeLookOutRight ?? 0)) / 2;
    w[BS.LookY] = ((s.eyeLookDownLeft ?? 0) + (s.eyeLookDownRight ?? 0) - (s.eyeLookUpLeft ?? 0) - (s.eyeLookUpRight ?? 0)) / 2;

    const m = res.facialTransformationMatrixes?.[0]?.data;
    if (m) {
      // column-major rotation part -> yaw / pitch / roll, mirrored for the selfie view
      const yaw = Math.atan2(m[8], m[10]);
      const pitch = Math.asin(Math.max(-1, Math.min(1, -m[9])));
      const roll = Math.atan2(m[1], m[5]);
      this.head[0] = -yaw;
      this.head[1] = -pitch;
      this.head[2] = -roll;
    }
  };
}
