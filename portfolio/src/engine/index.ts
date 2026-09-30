import type { Engine, ParticleData } from './types';
import { createWebGPUEngine } from './webgpu';
import { createWebGL2Engine } from './webgl2';

/** WebGPU first (compute shaders), WebGL2 GPGPU as a fallback. `?backend=webgl2` forces the fallback. */
export async function createEngine(canvas: HTMLCanvasElement, data: ParticleData): Promise<Engine | null> {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced !== 'webgl2') {
    try {
      const gpu = await createWebGPUEngine(canvas, data);
      if (gpu) return gpu;
    } catch (e) {
      console.warn('[engine] WebGPU unavailable', e);
    }
    // a canvas that handed out a webgpu context can't give a webgl2 one
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  try {
    return createWebGL2Engine(canvas, data);
  } catch (e) {
    console.warn('[engine] WebGL2 unavailable', e);
    return null;
  }
}
