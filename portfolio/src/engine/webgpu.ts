import { COMPUTE_WGSL, RENDER_WGSL } from './shaders.wgsl';
import { U, type Engine, type ParticleData } from './types';

/**
 * WebGPU backend: one compute dispatch integrates every particle, then an
 * instanced draw reads the same storage buffers straight from the vertex
 * stage. No readbacks, no CPU work per particle.
 */
export async function createWebGPUEngine(canvas: HTMLCanvasElement, data: ParticleData): Promise<Engine | null> {
  if (!('gpu' in navigator)) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  let failed = false;
  device.pushErrorScope('validation');

  const n = data.count;
  const storage = (src: ArrayBufferView, usage = 0) => {
    const buf = device.createBuffer({
      size: Math.max(16, src.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | usage,
    });
    device.queue.writeBuffer(buf, 0, src.buffer, src.byteOffset, src.byteLength);
    return buf;
  };

  const uniformBuf = device.createBuffer({
    size: U.FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const baseBuf = storage(data.base);
  const colorBuf = storage(data.color);
  const deltaBuf = storage(data.deltas);
  const morphBuf = storage(new Float32Array(n * 4));
  const posBuf = storage(data.start);
  const velBuf = storage(new Float32Array(n * 4));

  const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
  const renderModule = device.createShaderModule({ code: RENDER_WGSL });

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: computeModule, entryPoint: 'main' },
  });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: {
      module: renderModule,
      entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const computeBind = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [uniformBuf, baseBuf, deltaBuf, morphBuf, posBuf, velBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const renderBind = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [uniformBuf, posBuf, velBuf, colorBuf, morphBuf, baseBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });

  const err = await device.popErrorScope();
  if (err) {
    console.warn('[webgpu] pipeline validation failed, falling back:', err.message);
    device.destroy();
    return null;
  }
  device.lost.then((info) => { failed = true; console.warn('[webgpu] device lost:', info.reason, info.message); });
  device.addEventListener('uncapturederror', (e) => console.warn('[webgpu]', (e as GPUUncapturedErrorEvent).error.message));

  return {
    kind: 'webgpu',
    setMorph(target) {
      device.queue.writeBuffer(morphBuf, 0, target.buffer, target.byteOffset, target.byteLength);
    },
    setFace(face) {
      for (const [buf, src] of [[baseBuf, face.base], [colorBuf, face.color], [deltaBuf, face.deltas]] as const)
        device.queue.writeBuffer(buf, 0, src.buffer, src.byteOffset, src.byteLength);
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },
    frame(uniforms) {
      if (failed) return;
      encode(uniforms, context.getCurrentTexture());
    },
    async capture(uniforms) {
      // debug/test path: render offscreen and read the pixels back
      const w = canvas.width, h = canvas.height;
      const tex = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      encode(uniforms, tex);
      const bpr = Math.ceil((w * 4) / 256) * 256;
      const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(buf.getMappedRange());
      const out = new Uint8ClampedArray(w * h * 4);
      const bgra = format === 'bgra8unorm';
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * bpr + x * 4, o = (y * w + x) * 4;
          out[o] = src[i + (bgra ? 2 : 0)];
          out[o + 1] = src[i + 1];
          out[o + 2] = src[i + (bgra ? 0 : 2)];
          out[o + 3] = src[i + 3];
        }
      buf.destroy();
      tex.destroy();
      return new ImageData(out, w, h);
    },
    destroy() {
      device.destroy();
    },
  };

  function encode(uniforms: Float32Array, texture: GPUTexture) {
      device.queue.writeBuffer(uniformBuf, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);
      const enc = device.createCommandEncoder();
      const cp = enc.beginComputePass();
      cp.setPipeline(computePipeline);
      cp.setBindGroup(0, computeBind);
      cp.dispatchWorkgroups(Math.ceil(n / 256));
      cp.end();
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      rp.setPipeline(renderPipeline);
      rp.setBindGroup(0, renderBind);
      rp.draw(6, n);
      rp.end();
      device.queue.submit([enc.finish()]);
  }
}
