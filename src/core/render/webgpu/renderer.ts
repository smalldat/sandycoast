import type { Easing } from '../../particles/anim.js';
import type { GrainBuffer } from '../../particles/grains.js';
import type { BackendKind, FrameUniforms, Renderer } from '../types.js';
import { SAND_WGSL } from './shader.wgsl.js';

// Quad corners (two triangles) in [-1,1].
const QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

const EASE_KIND: Record<Easing, number> = {
  linear: 0,
  easeOutCubic: 1,
  easeOutQuint: 2,
};

export class WebGPURenderer implements Renderer {
  readonly kind: BackendKind = 'webgpu';

  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private pipeline!: GPURenderPipeline;
  private quadBuf!: GPUBuffer;
  private instBuf: GPUBuffer | null = null;
  private uniformBuf!: GPUBuffer;
  private paletteBuf: GPUBuffer | null = null;
  private hoverBuf: GPUBuffer | null = null;
  private hoverCap = 0;
  private bindGroup: GPUBindGroup | null = null;
  private bindLayout!: GPUBindGroupLayout;
  private grainCount = 0;
  private uniformData = new Float32Array(28); // 7 vec4

  static async isSupported(): Promise<boolean> {
    if (!('gpu' in navigator)) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return adapter != null;
    } catch {
      return false;
    }
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU adapter unavailable');
    this.device = await adapter.requestDevice();
    this.device.addEventListener('uncapturederror', (e) => {
      console.error('[webgpu] uncaptured error:', (e as GPUUncapturedErrorEvent).error.message);
    });
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('WebGPU context unavailable');
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

    const module = this.device.createShaderModule({ code: SAND_WGSL });

    this.bindLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindLayout] }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          // quad corners
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          // per-instance grain: sx,sy,tx,ty,delay,seed,colorIdx,barId (8 floats)
          {
            arrayStride: 32,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x2' },
              { shaderLocation: 2, offset: 8, format: 'float32x2' },
              { shaderLocation: 3, offset: 16, format: 'float32x2' },
              { shaderLocation: 4, offset: 24, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.quadBuf = this.device.createBuffer({
      size: QUAD.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.quadBuf, 0, QUAD);

    this.uniformBuf = this.device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  upload(grains: GrainBuffer): void {
    this.grainCount = grains.count;
    const inst = new Float32Array(grains.count * 8);
    for (let i = 0; i < grains.count; i++) {
      const o = i * 8;
      inst[o] = grains.startX[i]!;
      inst[o + 1] = grains.startY[i]!;
      inst[o + 2] = grains.targetX[i]!;
      inst[o + 3] = grains.targetY[i]!;
      inst[o + 4] = grains.delay[i]!;
      inst[o + 5] = grains.seed[i]!;
      inst[o + 6] = grains.colorIdx[i]!;
      inst[o + 7] = grains.barId[i]!;
    }
    this.instBuf?.destroy();
    this.instBuf = this.device.createBuffer({
      size: Math.max(32, inst.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.instBuf, 0, inst);
  }

  private ensureBuffers(u: FrameUniforms): void {
    const palNeeded = Math.max(1, u.palette.length) * 16;
    if (!this.paletteBuf || this.paletteBuf.size < palNeeded) {
      this.paletteBuf?.destroy();
      this.paletteBuf = this.device.createBuffer({
        size: palNeeded,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = null;
    }
    const pal = new Float32Array(Math.max(1, u.palette.length) * 4);
    u.palette.forEach((c, i) => pal.set(c, i * 4));
    this.device.queue.writeBuffer(this.paletteBuf, 0, pal);

    // Per-bar hover weights (rounded up to a multiple of 4 floats for alignment).
    const barCount = Math.max(1, u.hoverWeights.length);
    if (!this.hoverBuf || this.hoverCap < barCount) {
      this.hoverBuf?.destroy();
      this.hoverCap = Math.max(4, barCount);
      this.hoverBuf = this.device.createBuffer({
        size: this.hoverCap * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = null;
    }
    this.device.queue.writeBuffer(
      this.hoverBuf,
      0,
      u.hoverWeights as unknown as GPUAllowSharedBufferSource,
    );

    if (!this.bindGroup) {
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.paletteBuf } },
          { binding: 2, resource: { buffer: this.hoverBuf } },
        ],
      });
    }
  }

  frame(u: FrameUniforms): void {
    if (!this.instBuf || this.grainCount === 0) return;
    this.ensureBuffers(u);

    const d = this.uniformData;
    d[0] = u.now;
    d[1] = u.duration;
    d[2] = u.grainSizePx;
    d[3] = EASE_KIND[u.easing];
    d[4] = u.viewport[0];
    d[5] = u.viewport[1];
    d[6] = u.grainShape === 'disc' ? 1 : 0;
    d[7] = u.grainFade;
    d[8] = u.highlightGain;
    d[9] = u.hoverJitterAmp;
    d[10] = u.settleJitterAmp;
    d[11] = u.palette.length;
    d[12] = u.background[0];
    d[13] = u.background[1];
    d[14] = u.background[2];
    d[15] = u.background[3];
    d[16] = u.plotRect[0];
    d[17] = u.plotRect[1];
    d[18] = u.plotRect[2];
    d[19] = u.plotRect[3];
    d[20] = u.hoverOpacity;
    d[21] = 0;
    d[22] = 0;
    d[23] = 0;
    d[24] = u.viewScale?.[0] ?? 1;
    d[25] = u.viewScale?.[1] ?? 1;
    d[26] = u.viewOffset?.[0] ?? 0;
    d[27] = u.viewOffset?.[1] ?? 0;
    this.device.queue.writeBuffer(this.uniformBuf, 0, d);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: {
            r: u.background[0],
            g: u.background[1],
            b: u.background[2],
            a: u.background[3],
          },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    // Scissor grains to the plot rect so panned/zoomed content never spills into
    // the axis/legend gutters (framebuffer px, y-down from the top).
    if (u.clipToPlot) {
      const [w, h] = u.viewport;
      const [x0, y0, x1, y1] = u.plotRect;
      const sx = Math.max(0, Math.round(x0 * w));
      const sy = Math.max(0, Math.round((1 - y1) * h));
      const sw = Math.max(0, Math.min(w, Math.round(x1 * w)) - sx);
      const sh = Math.max(0, Math.min(h, Math.round((1 - y0) * h)) - sy);
      pass.setScissorRect(sx, sy, sw, sh);
    }
    pass.setBindGroup(0, this.bindGroup!);
    pass.setVertexBuffer(0, this.quadBuf);
    pass.setVertexBuffer(1, this.instBuf);
    pass.draw(6, this.grainCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  resize(): void {
    // Canvas backing size is managed by the Chart; context reconfig not needed
    // for size changes with 'premultiplied' alpha on most implementations.
  }

  dispose(): void {
    this.instBuf?.destroy();
    this.paletteBuf?.destroy();
    this.hoverBuf?.destroy();
    this.uniformBuf?.destroy();
    this.quadBuf?.destroy();
    this.instBuf = null;
    this.paletteBuf = null;
    this.hoverBuf = null;
  }
}
