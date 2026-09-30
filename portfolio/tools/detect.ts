// Dev-only: runs MediaPipe on local portraits (private/, gitignored) and exposes
// landmarks + segmentation masks for tools/bake-face.py. Never shipped.
const MP = '/_mp';
const vision = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
const fileset = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/private/models/face_landmarker.task', delegate: 'CPU' },
  runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
});
const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/private/models/seg.tflite', delegate: 'CPU' },
  runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
});

(window as any).detect = async (url: string) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const lm = landmarker.detect(img);
  let mask: { w: number; h: number; b64: string } | null = null;
  segmenter.segment(img, (res: any) => {
    const m = res.categoryMask;
    const data: Uint8Array = m.getAsUint8Array();
    let s = '';
    for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
    mask = { w: m.width, h: m.height, b64: btoa(s) };
  });
  return {
    w: img.naturalWidth, h: img.naturalHeight,
    landmarks: lm.faceLandmarks[0]?.map((p: any) => [p.x, p.y, p.z]) ?? null,
    blendshapes: Object.fromEntries((lm.faceBlendshapes[0]?.categories ?? []).map((c: any) => [c.categoryName, +c.score.toFixed(3)])),
    matrix: lm.facialTransformationMatrixes[0]?.data ?? null,
    tess: vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION.map((c: any) => [c.start, c.end]),
    mask,
  };
};
(window as any).ready = true;
