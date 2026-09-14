import { Capacitor, registerPlugin } from '@capacitor/core';

export type SelectionPoint = { x: number; y: number };
export type SelectionBox = { x: number; y: number; w: number; h: number };

export type SegmentResult = {
  cutoutUrl: string;
  overlayUrl: string;
  color: string;
  aspectRatio: number;
  score: number;
};

type ProgressEvent = {
  status?: string;
  progress?: number;
  file?: string;
};

type Segmenter = {
  model: any;
  processor: any;
  RawImage: any;
  backend: 'webgpu' | 'wasm';
};

type NativeVisionSegmenter = {
  segment(options: { image: string; points: SelectionPoint[] }): Promise<SegmentResult>;
};

const nativeVisionSegmenter = registerPlugin<NativeVisionSegmenter>('NativeVisionSegment');

let segmenterPromise: Promise<Segmenter> | null = null;

function loadSegmenter(onProgress: (message: string) => void): Promise<Segmenter> {
  if (segmenterPromise) return segmenterPromise;

  segmenterPromise = (async () => {
    const { AutoProcessor, env, RawImage, SamModel } = await import('@huggingface/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = '/models/';
    const wasmBackend = env.backends.onnx.wasm;
    if (Capacitor.isNativePlatform() && wasmBackend) wasmBackend.numThreads = 1;
    // ONNX WebGPU can exceed the iOS WebView memory budget while compiling
    // SlimSAM. Native shells use the smaller q8 WASM path for stability.
    const hasWebGpu = !Capacitor.isNativePlatform() && 'gpu' in navigator;
    const backend: Segmenter['backend'] = hasWebGpu ? 'webgpu' : 'wasm';
    const options = {
      device: backend,
      dtype: hasWebGpu ? 'fp16' : 'q8',
      progress_callback: (event: ProgressEvent) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          onProgress(`Loading the cutout model · ${Math.round(event.progress)}%`);
        }
      }
    } as const;

    onProgress(`Loading the bundled cutout model · ${backend === 'webgpu' ? 'GPU' : 'CPU'}`);
    const model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', options);
    const processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform', options);
    return { model, processor, RawImage, backend };
  })().catch((error) => {
    segmenterPromise = null;
    throw error;
  });

  return segmenterPromise;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected photo could not be read.'));
    image.src = src;
  });
}

function canvasToUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

export async function segmentWithPrompts(
  imageUrl: string,
  points: SelectionPoint[],
  selectionBox: SelectionBox | null,
  onProgress: (message: string) => void
): Promise<SegmentResult> {
  if (Capacitor.getPlatform() === 'ios') {
    if (!points.length) throw new Error('Tap an object first.');
    onProgress('Separating the object with Apple Vision…');
    return nativeVisionSegmenter.segment({ image: imageUrl, points });
  }

  const { model, processor, RawImage } = await loadSegmenter(onProgress);
  const [rawImage, sourceImage] = await Promise.all([
    RawImage.fromURL(imageUrl),
    loadHtmlImage(imageUrl)
  ]);

  const width = rawImage.width;
  const height = rawImage.height;
  if (!points.length && !selectionBox) throw new Error('Tap an object or draw a frame first.');

  const inputPoints = points.map((point) => [
    Math.max(0, Math.min(width - 1, Math.round((point.x / 100) * width))),
    Math.max(0, Math.min(height - 1, Math.round((point.y / 100) * height)))
  ]);
  const processorOptions: Record<string, unknown> = {};
  if (selectionBox) {
    const x1 = Math.max(0, Math.round((selectionBox.x / 100) * width));
    const y1 = Math.max(0, Math.round((selectionBox.y / 100) * height));
    const x2 = Math.min(width, Math.round(((selectionBox.x + selectionBox.w) / 100) * width));
    const y2 = Math.min(height, Math.round(((selectionBox.y + selectionBox.h) / 100) * height));
    processorOptions.input_boxes = [[[x1, y1, x2, y2]]];
    if (!inputPoints.length) inputPoints.push([(x1 + x2) / 2, (y1 + y2) / 2]);
  }
  if (inputPoints.length) {
    processorOptions.input_points = [inputPoints];
    processorOptions.input_labels = [inputPoints.map(() => 1)];
  }

  onProgress('Looking closely at the object…');
  const processed = await processor(rawImage, processorOptions);
  const embeddings = await model.get_image_embeddings(processed);

  onProgress('Tracing its outline…');
  const modelInputs: Record<string, unknown> = { ...embeddings };
  if (processed.input_points) modelInputs.input_points = processed.input_points;
  if (processed.input_labels) modelInputs.input_labels = processed.input_labels;
  if (processed.input_boxes) modelInputs.input_boxes = processed.input_boxes;
  const output = await model(modelInputs);
  const masks = await processor.post_process_masks(
    output.pred_masks,
    processed.original_sizes,
    processed.reshaped_input_sizes
  );

  const scores = Array.from(output.iou_scores.data as Float32Array);
  let bestMask = 0;
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] > scores[bestMask]) bestMask = index;
  }

  const maskImage = RawImage.fromTensor(masks[0][0]);
  const maskChannels = scores.length;
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = width;
  fullCanvas.height = height;
  const fullContext = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fullContext) throw new Error('Canvas is unavailable in this browser.');
  fullContext.drawImage(sourceImage, 0, 0, width, height);
  const pixels = fullContext.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let colorCount = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const rgba = pixel * 4;
    const inside = maskImage.data[pixel * maskChannels + bestMask] === 1;
    pixels.data[rgba + 3] = inside ? 255 : 0;
    if (!inside) continue;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (pixel % 13 === 0) {
      red += pixels.data[rgba];
      green += pixels.data[rgba + 1];
      blue += pixels.data[rgba + 2];
      colorCount += 1;
    }
  }

  if (minX > maxX || minY > maxY) throw new Error('No object was found at that point.');
  fullContext.putImageData(pixels, 0, 0);

  const padding = Math.max(6, Math.round(Math.max(maxX - minX, maxY - minY) * 0.035));
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);
  const cutoutCanvas = document.createElement('canvas');
  cutoutCanvas.width = cropWidth;
  cutoutCanvas.height = cropHeight;
  const cutoutContext = cutoutCanvas.getContext('2d');
  if (!cutoutContext) throw new Error('Canvas is unavailable in this browser.');
  cutoutContext.drawImage(fullCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayContext = overlayCanvas.getContext('2d');
  if (!overlayContext) throw new Error('Canvas is unavailable in this browser.');
  overlayContext.drawImage(sourceImage, 0, 0, width, height);
  overlayContext.fillStyle = 'rgba(12, 16, 13, .28)';
  overlayContext.fillRect(0, 0, width, height);
  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = width;
  tintCanvas.height = height;
  const tintContext = tintCanvas.getContext('2d');
  if (!tintContext) throw new Error('Canvas is unavailable in this browser.');
  tintContext.drawImage(fullCanvas, 0, 0);
  tintContext.globalCompositeOperation = 'source-in';
  tintContext.fillStyle = 'rgba(197, 75, 52, .58)';
  tintContext.fillRect(0, 0, width, height);
  overlayContext.drawImage(tintCanvas, 0, 0);

  const soften = (value: number) => Math.round((value / Math.max(1, colorCount)) * 0.86 + 245 * 0.14);
  return {
    cutoutUrl: canvasToUrl(cutoutCanvas),
    overlayUrl: canvasToUrl(overlayCanvas),
    color: `rgb(${soften(red)}, ${soften(green)}, ${soften(blue)})`,
    aspectRatio: cropWidth / cropHeight,
    score: scores[bestMask] ?? 0
  };
}
