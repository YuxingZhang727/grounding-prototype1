/// <reference lib="webworker" />

import { DrawingUtils, FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision';

type WorkerStroke = {
  brushMode: number;
  point: Array<{ x: number; y: number }>;
  isCompleted: boolean;
};

type IncomingMessage =
  | { type: 'INIT'; wasmRoot: string; modelAssetPath: string }
  | { type: 'SET_IMAGE'; bitmap: ImageBitmap; reqId: number }
  | { type: 'SEGMENT'; strokes: WorkerStroke[]; reqId: number }
  | { type: 'CLEAR'; reqId: number };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let segmenter: InteractiveSegmenter | null = null;
let renderCanvas: OffscreenCanvas | null = null;
let drawingUtils: DrawingUtils | null = null;

function prepareRenderer(width: number, height: number) {
  if (!renderCanvas) renderCanvas = new OffscreenCanvas(width, height);
  if (renderCanvas.width !== width) renderCanvas.width = width;
  if (renderCanvas.height !== height) renderCanvas.height = height;
  const gl = renderCanvas.getContext('webgl2');
  if (!gl || gl.isContextLost()) throw new Error('WebGL2 is unavailable for the mask renderer.');
  gl.viewport(0, 0, width, height);
  drawingUtils?.close();
  drawingUtils = new DrawingUtils(gl);
  return renderCanvas;
}

async function initialize(wasmRoot: string, modelAssetPath: string) {
  // Module workers must use MediaPipe's ES-module WASM loader. Without the
  // second argument, FilesetResolver selects the classic loader and the worker
  // fails during task creation with "ModuleFactory not set".
  const vision = await FilesetResolver.forVisionTasks(wasmRoot, true);
  renderCanvas = new OffscreenCanvas(1, 1);
  try {
    segmenter = await InteractiveSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      canvas: renderCanvas
    });
  } catch {
    segmenter = await InteractiveSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      canvas: renderCanvas
    });
  }
  workerScope.postMessage({ type: 'READY' });
}

workerScope.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  try {
    if (message.type === 'INIT') {
      await initialize(message.wasmRoot, message.modelAssetPath);
      return;
    }
    if (!segmenter) throw new Error('MediaPipe is not ready yet.');

    if (message.type === 'SET_IMAGE') {
      prepareRenderer(message.bitmap.width, message.bitmap.height);
      segmenter.setImage(message.bitmap);
      message.bitmap.close();
      workerScope.postMessage({ type: 'IMAGE_SET', reqId: message.reqId });
      return;
    }

    if (message.type === 'CLEAR') {
      workerScope.postMessage({ type: 'CLEARED', reqId: message.reqId });
      return;
    }

    const startedAt = performance.now();
    const mask = segmenter.segment(message.strokes);
    const canvas = prepareRenderer(mask.width, mask.height);
    if (!drawingUtils) throw new Error('The mask renderer is unavailable.');
    // The official sample renders the confidence mask on the worker's WebGL
    // canvas, then transfers a bitmap instead of reading every pixel in JS.
    drawingUtils.drawConfidenceMask(mask, [0, 0, 0, 0], [255, 0, 255, 255]);
    mask.close();
    const maskBitmap = canvas.transferToImageBitmap();
    workerScope.postMessage(
      {
        type: 'SEGMENT_RESULT',
        reqId: message.reqId,
        maskBitmap,
        inferenceTime: performance.now() - startedAt
      },
      [maskBitmap]
    );
  } catch (error) {
    workerScope.postMessage({
      type: 'ERROR',
      reqId: 'reqId' in message ? message.reqId : undefined,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
