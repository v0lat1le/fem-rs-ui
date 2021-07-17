import { mat4, vec3 } from 'gl-matrix';

// 🟦 Shader
import shaderCode from './shader.wgsl';

import {load} from './io';
const dataset = load();

// Renderer
// 📈 Position Vertex Buffer Data
const positions = new Float32Array(dataset.points.flatMap((p) => p as number[]));

// 🎨 Color Vertex Buffer Data
const colors = new Float32Array(dataset.point_data.flatMap((p) => p as number[]));

// 🗄️ Index Buffer Data
const points = dataset.cells.flatMap((c) => {
    return [
        c.points[0], c.points[1], c.points[2],
        c.points[0], c.points[2], c.points[3],
        c.points[4], c.points[6], c.points[5],
        c.points[4], c.points[7], c.points[6],

        c.points[0], c.points[7], c.points[4],
        c.points[0], c.points[3], c.points[7],
        c.points[1], c.points[5], c.points[6],
        c.points[1], c.points[6], c.points[2],

        c.points[0], c.points[4], c.points[5],
        c.points[0], c.points[5], c.points[1],
        c.points[3], c.points[2], c.points[6],
        c.points[3], c.points[6], c.points[7],
    ]
})
const indices = new Uint16Array(points);

class Renderer {
    canvas: HTMLCanvasElement;

    // ⚙️ API Data Structures
    adapter: GPUAdapter;
    device: GPUDevice;
    queue: GPUQueue;

    // 🎞️ Frame Backings
    context: GPUPresentationContext;
    colorTexture: GPUTexture;
    colorTextureView: GPUTextureView;
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    // 🔺 Resources
    positionBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    shaderModule: GPUShaderModule;
    fragModule: GPUShaderModule;
    pipeline: GPURenderPipeline;
    viewMatrix: GPUBuffer;
    bindGroup: GPUBindGroup;

    commandEncoder: GPUCommandEncoder;
    passEncoder: GPURenderPassEncoder;

    // junk
    modelMat: mat4;
    viewMat: mat4;
    projMat: mat4;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.modelMat = mat4.create();
        mat4.fromTranslation(this.modelMat, [-0.5, -0.5, -0.5]);
        this.viewMat = mat4.create();
        mat4.lookAt(this.viewMat, [1, -2, 1], [0, 0, 0], [0, 0, 1]);
        this.projMat = mat4.create();
    }

    // 🏎️ Start the rendering engine
    async start() {
        if (await this.initializeAPI()) {
            this.resizeBackings();
            await this.initializeResources();
            this.render();
        }
    }

    // 🌟 Initialize WebGPU
    async initializeAPI(): Promise<boolean> {
        try {
            // 🏭 Entry to WebGPU
            const entry: GPU = navigator.gpu;
            if (!entry) {
                return false;
            }

            // 🔌 Physical Device Adapter
            this.adapter = await entry.requestAdapter();

            // 💻 Logical Device
            this.device = await this.adapter.requestDevice();

            // 📦 Queue
            this.queue = this.device.queue;
        } catch (e) {
            console.error(e);
            return false;
        }

        return true;
    }

    // 🍱 Initialize resources to render triangle (buffers, shaders, pipeline)
    async initializeResources() {
        // 🔺 Buffers
        let createBuffer = (arr: Float32Array | Uint16Array, usage: number) => {
            // 📏 Align to 4 bytes (thanks @chrimsonite)
            let desc = { size: (arr.byteLength + 3) & ~3, usage, mappedAtCreation: true };
            let buffer = this.device.createBuffer(desc);
            const writeArray =
                arr instanceof Uint16Array
                    ? new Uint16Array(buffer.getMappedRange())
                    : new Float32Array(buffer.getMappedRange());
            writeArray.set(arr);
            buffer.unmap();
            return buffer;
        };

        this.positionBuffer = createBuffer(positions, GPUBufferUsage.VERTEX);
        this.colorBuffer = createBuffer(colors, GPUBufferUsage.VERTEX);
        this.indexBuffer = createBuffer(indices, GPUBufferUsage.INDEX);
        this.viewMatrix = this.device.createBuffer({size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});

        // 🖍️ Shaders
        const shaderDesc: GPUShaderModuleDescriptor = { code: shaderCode };
        this.shaderModule = this.device.createShaderModule(shaderDesc);

        // ⚗️ Graphics Pipeline

        // 🔣 Input Assembly
        const positionAttribDesc: GPUVertexAttribute = {
            shaderLocation: 0, // [[attribute(0)]]
            offset: 0,
            format: 'float32x3'
        };
        const colorAttribDesc: GPUVertexAttribute = {
            shaderLocation: 1, // [[attribute(1)]]
            offset: 0,
            format: 'float32x3'
        };
        const positionBufferDesc: GPUVertexBufferLayout = {
            attributes: [positionAttribDesc],
            arrayStride: 4 * 3, // sizeof(float) * 3
            stepMode: 'vertex'
        };
        const colorBufferDesc: GPUVertexBufferLayout = {
            attributes: [colorAttribDesc],
            arrayStride: 4 * 3, // sizeof(float) * 3
            stepMode: 'vertex'
        };

        // 🌑 Depth
        const depthStencil: GPUDepthStencilState = {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        };

        // 🦄 Uniform Data
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform" } as GPUBufferBindingLayout
            }]
        })
        const pipelineLayoutDesc: GPUPipelineLayoutDescriptor = { bindGroupLayouts: [bindGroupLayout] };
        const layout = this.device.createPipelineLayout(pipelineLayoutDesc);

        this.bindGroup = this.device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: this.viewMatrix
                }
            }]
        })

        // 🎭 Shader Stages
        const vertex: GPUVertexState = {
            module: this.shaderModule,
            entryPoint: 'vs_main',
            buffers: [positionBufferDesc, colorBufferDesc]
        };

        // 🌀 Color/Blend State
        const colorState: GPUColorTargetState = {
            format: 'bgra8unorm',
            blend: {
                alpha: {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                },
                color: {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add'
                },
            },
            writeMask: GPUColorWrite.ALL
        };

        const fragment: GPUFragmentState = {
            module: this.shaderModule,
            entryPoint: 'fs_main',
            targets: [colorState],
        };

        // 🟨 Rasterization
        const primitive: GPUPrimitiveState = {
            frontFace: 'cw',
            cullMode: 'back',
            topology: 'triangle-list'
        };

        const pipelineDesc: GPURenderPipelineDescriptor = {
            layout,

            vertex,
            fragment,

            primitive,
            depthStencil,
        };
        this.pipeline = this.device.createRenderPipeline(pipelineDesc);
    }

    // ↙️ Resize swapchain, frame buffer attachments
    resizeBackings() {
        // ⛓️ Swapchain
        if (!this.context) {
            this.context = this.canvas.getContext('gpupresent');
            const configuration: GPUPresentationConfiguration = {
                device: this.device,
                format: 'bgra8unorm',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
            };
            this.context.configure(configuration);
        }

        const depthTextureDesc: GPUTextureDescriptor = {
            size: [this.canvas.width, this.canvas.height, 1],
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            format: 'depth24plus-stencil8',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        };

        this.depthTexture = this.device.createTexture(depthTextureDesc);
        this.depthTextureView = this.depthTexture.createView();

        mat4.perspective(this.projMat, Math.PI/3, canvas.width/canvas.height, 0.1, 100);
    }

    // ✍️ Write commands to send to the GPU
    encodeCommands() {
        let colorAttachment: GPURenderPassColorAttachment = {
            view: this.colorTextureView,
            loadValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: 'store'
        };

        const depthAttachment: GPURenderPassDepthStencilAttachment = {
            view: this.depthTextureView,
            depthLoadValue: 1,
            depthStoreOp: 'store',
            stencilLoadValue: 'load',
            stencilStoreOp: 'store'
        };

        const renderPassDesc: GPURenderPassDescriptor = {
            colorAttachments: [colorAttachment],
            depthStencilAttachment: depthAttachment
        };

        const mat = mat4.create();
        mat4.multiply(mat, this.modelMat, mat);
        mat4.multiply(mat, this.viewMat, mat);
        mat4.multiply(mat, this.projMat, mat);

        this.commandEncoder = this.device.createCommandEncoder();

        this.queue.writeBuffer(this.viewMatrix, 0, mat as BufferSource);
        this.queue.writeBuffer(this.viewMatrix, 16*4, Float32Array.of(+(document.getElementById("scale") as HTMLInputElement).value));

        // 🖌️ Encode drawing commands
        this.passEncoder = this.commandEncoder.beginRenderPass(renderPassDesc);
        this.passEncoder.setPipeline(this.pipeline);
        this.passEncoder.setViewport(0, 0, this.canvas.width, this.canvas.height, 0, 1);
        this.passEncoder.setScissorRect(0, 0, this.canvas.width, this.canvas.height);
        this.passEncoder.setVertexBuffer(0, this.positionBuffer);
        this.passEncoder.setVertexBuffer(1, this.colorBuffer);
        this.passEncoder.setIndexBuffer(this.indexBuffer, 'uint16');
        this.passEncoder.setBindGroup(0, this.bindGroup);
        this.passEncoder.drawIndexed(indices.length, 1, 0, 0, 0);
        this.passEncoder.endPass();

        this.queue.submit([this.commandEncoder.finish()]);
    }

    move(movementX: number, movementY: number) {
        var mat = mat4.create();
        mat4.fromTranslation(mat, [movementX/this.canvas.width, -movementY/this.canvas.height, 0]);
        mat4.multiply(this.viewMat, mat, this.viewMat);
    }

    rotate(movementX: number, movementY: number) {
        const axis = vec3.fromValues(movementY, movementX, 0);
        var mat = mat4.create();
        mat4.fromRotation(mat, 0.05, axis);
        mat4.multiply(this.viewMat, mat, this.viewMat);
    }

    render = () => {
        // ⏭ Acquire next image from swapchain
        this.colorTexture = this.context.getCurrentTexture();
        this.colorTextureView = this.colorTexture.createView();

        // 📦 Write and submit commands to queue
        this.encodeCommands();

        // ➿ Refresh canvas
        requestAnimationFrame(this.render);
    };
}

// Main
const canvas = document.getElementById('gfx') as HTMLCanvasElement;
canvas.width = canvas.height = 640;
const renderer = new Renderer(canvas);
renderer.start();

var dragging = false;
canvas.onmousedown = (ev) => {
    dragging = true;
}
canvas.onmouseup = (ev) => {
    dragging = false;
}
canvas.onmousemove = (ev: MouseEvent) => {
    if (!dragging) {
        return;
    }
    if (ev.shiftKey) {
        renderer.move(ev.movementX, ev.movementY);
    } else {
        renderer.rotate(ev.movementX, ev.movementY);
    }
}
