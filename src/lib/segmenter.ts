export type SelectionPoint = { x: number; y: number };
export type SelectionStroke = {
  mode: 'positive' | 'negative' | 'lasso';
  points: SelectionPoint[];
};

export type SegmentResult = {
  cutoutUrl: string;
  overlayUrl: string;
  color: string;
  aspectRatio: number;
  score: number;
};

type MediaPipeWorkerRuntime = {
  worker: Worker;
  ready: Promise<void>;
  imageUrl?: string;
  imageSetup?: Promise<void>;
  requestId: number;
  pending: Map<number, {
    resolve: (value: ImageBitmap | null) => void;
    reject: (reason?: unknown) => void;
  }>;
};

let mediaPipeWorkerRuntime: MediaPipeWorkerRuntime | null = null;

function getMediaPipeWorker(): MediaPipeWorkerRuntime {
  if (mediaPipeWorkerRuntime) return mediaPipeWorkerRuntime;

  const worker = new Worker(new URL('./interactive-segmenter.worker.ts', import.meta.url), { type: 'module' });
  let resolveReady!: () => void;
  let rejectReady!: (reason?: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const runtime: MediaPipeWorkerRuntime = {
    worker,
    ready,
    requestId: 0,
    pending: new Map()
  };

  worker.onmessage = (event: MessageEvent) => {
    const { type, reqId, maskBitmap, error } = event.data;
    if (type === 'READY') {
      resolveReady();
      return;
    }
    if (type === 'IMAGE_SET' || type === 'CLEARED') {
      runtime.pending.get(reqId)?.resolve(null);
      runtime.pending.delete(reqId);
      return;
    }
    if (type === 'SEGMENT_RESULT') {
      runtime.pending.get(reqId)?.resolve(maskBitmap ?? null);
      runtime.pending.delete(reqId);
      return;
    }
    if (type === 'ERROR') {
      const failure = new Error(error || 'MediaPipe could not segment this image.');
      if (typeof reqId === 'number' && runtime.pending.has(reqId)) {
        runtime.pending.get(reqId)?.reject(failure);
        runtime.pending.delete(reqId);
      } else {
        rejectReady(failure);
      }
    }
  };
  worker.onerror = (event) => {
    const failure = new Error(event.message || 'MediaPipe worker failed to start.');
    rejectReady(failure);
    runtime.pending.forEach(({ reject }) => reject(failure));
    runtime.pending.clear();
  };
  worker.postMessage({
    type: 'INIT',
    wasmRoot: '/mediapipe/wasm',
    modelAssetPath: '/models/interactive_segmenter/interactive_segmentation.task'
  });
  mediaPipeWorkerRuntime = runtime;
  return runtime;
}

function requestWorker<T extends ImageBitmap | null>(
  runtime: MediaPipeWorkerRuntime,
  message: Record<string, unknown>,
  transfer: Transferable[] = []
): Promise<T> {
  const reqId = ++runtime.requestId;
  return new Promise<T>((resolve, reject) => {
    runtime.pending.set(reqId, {
      resolve: (value) => resolve(value as T),
      reject
    });
    runtime.worker.postMessage({ ...message, reqId }, transfer);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected photo could not be read.'));
    image.src = src;
  });
}

function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

const PREVIEW_MAX = 640;

function maskBounds(maskCanvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const scanScale = Math.min(1, 512 / Math.max(maskCanvas.width, maskCanvas.height));
  const scanWidth = Math.max(1, Math.round(maskCanvas.width * scanScale));
  const scanHeight = Math.max(1, Math.round(maskCanvas.height * scanScale));
  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = scanWidth;
  scanCanvas.height = scanHeight;
  const context = scanCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(maskCanvas, 0, 0, scanWidth, scanHeight);
  const pixels = context.getImageData(0, 0, scanWidth, scanHeight).data;

  let minX = scanWidth;
  let minY = scanHeight;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < scanWidth * scanHeight; index += 1) {
    if (pixels[index * 4 + 3] < 128) continue;
    const x = index % scanWidth;
    const y = Math.floor(index / scanWidth);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < 0 || maxY < 0) return null;
  return {
    x: minX / scanWidth,
    y: minY / scanHeight,
    w: (maxX + 1 - minX) / scanWidth,
    h: (maxY + 1 - minY) / scanHeight
  };
}

function cropRect(
  bounds: { x: number; y: number; w: number; h: number },
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } {
  const x = bounds.x * width;
  const y = bounds.y * height;
  const w = Math.max(1, bounds.w * width);
  const h = Math.max(1, bounds.h * height);
  const padding = Math.max(6, Math.round(Math.max(w, h) * 0.035));
  const left = Math.max(0, Math.floor(x - padding));
  const top = Math.max(0, Math.floor(y - padding));
  const right = Math.min(width, Math.ceil(x + w + padding));
  const bottom = Math.min(height, Math.ceil(y + h + padding));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

function buildPreview(sourceImage: HTMLImageElement, maskCanvas: HTMLCanvasElement) {
  const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
  const bounds = maskBounds(maskCanvas);
  if (!bounds) throw new Error('No object was found under that brush stroke.');

  const crop = cropRect(bounds, sourceWidth, sourceHeight);
  const scale = Math.min(1, PREVIEW_MAX / Math.max(crop.w, crop.h));
  const width = Math.max(1, Math.round(crop.w * scale));
  const height = Math.max(1, Math.round(crop.h * scale));
  const cutout = document.createElement('canvas');
  cutout.width = width;
  cutout.height = height;
  const cutoutContext = cutout.getContext('2d');
  if (!cutoutContext) throw new Error('Canvas is unavailable in this browser.');
  cutoutContext.drawImage(sourceImage, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  cutoutContext.globalCompositeOperation = 'destination-in';
  cutoutContext.drawImage(
    maskCanvas,
    (crop.x / sourceWidth) * maskCanvas.width,
    (crop.y / sourceHeight) * maskCanvas.height,
    (crop.w / sourceWidth) * maskCanvas.width,
    (crop.h / sourceHeight) * maskCanvas.height,
    0,
    0,
    width,
    height
  );

  const overlayScale = Math.min(1, PREVIEW_MAX / Math.max(sourceWidth, sourceHeight));
  const overlayWidth = Math.max(1, Math.round(sourceWidth * overlayScale));
  const overlayHeight = Math.max(1, Math.round(sourceHeight * overlayScale));
  const overlay = document.createElement('canvas');
  overlay.width = overlayWidth;
  overlay.height = overlayHeight;
  const overlayContext = overlay.getContext('2d');
  if (!overlayContext) throw new Error('Canvas is unavailable in this browser.');
  overlayContext.drawImage(sourceImage, 0, 0, overlayWidth, overlayHeight);
  overlayContext.fillStyle = 'rgba(12, 16, 13, .28)';
  overlayContext.fillRect(0, 0, overlayWidth, overlayHeight);
  overlayContext.drawImage(maskCanvas, 0, 0, overlayWidth, overlayHeight);

  return {
    cutoutUrl: cutout.toDataURL('image/png'),
    overlayUrl: overlay.toDataURL('image/jpeg', 0.9),
    aspectRatio: width / Math.max(1, height)
  };
}

export async function segmentWithBrushStrokes(
  imageUrl: string,
  strokeHints: SelectionStroke[],
  liveMaskCanvas: HTMLCanvasElement,
  onProgress: (message: string) => void,
  shouldApply: () => boolean = () => true
): Promise<SegmentResult> {
  if (!strokeHints.length) throw new Error('Brush over an object first.');
  const runtime = getMediaPipeWorker();
  const sourceImage = await loadHtmlImage(imageUrl);
  onProgress('Loading MediaPipe…');
  await runtime.ready;

  if (runtime.imageUrl !== imageUrl) {
    onProgress('Preparing the photo…');
    const bitmap = await createImageBitmap(sourceImage);
    runtime.imageSetup = requestWorker(runtime, { type: 'SET_IMAGE', bitmap }, [bitmap]).then(() => undefined);
    await runtime.imageSetup;
    runtime.imageUrl = imageUrl;
  } else if (runtime.imageSetup) {
    await runtime.imageSetup;
  }

  const brushModes = { positive: 1, negative: 2, lasso: 3 };
  const strokes = strokeHints.map((stroke) => ({
    brushMode: brushModes[stroke.mode],
    point: stroke.points.map((point) => ({
      x: Math.max(0, Math.min(1, point.x / 100)),
      y: Math.max(0, Math.min(1, point.y / 100))
    })),
    isCompleted: true
  }));

  onProgress('Updating the live mask…');
  const maskBitmap = await requestWorker<ImageBitmap>(runtime, { type: 'SEGMENT', strokes });
  if (!maskBitmap) throw new Error('MediaPipe did not return a mask.');
  if (!shouldApply()) {
    maskBitmap.close();
    throw new DOMException('This mask result is no longer needed.', 'AbortError');
  }

  if (liveMaskCanvas.width !== maskBitmap.width) liveMaskCanvas.width = maskBitmap.width;
  if (liveMaskCanvas.height !== maskBitmap.height) liveMaskCanvas.height = maskBitmap.height;
  const context = liveMaskCanvas.getContext('2d');
  if (!context) {
    maskBitmap.close();
    throw new Error('Canvas is unavailable in this browser.');
  }
  context.clearRect(0, 0, liveMaskCanvas.width, liveMaskCanvas.height);
  context.drawImage(maskBitmap, 0, 0);
  maskBitmap.close();

  if (!shouldApply()) throw new DOMException('This mask result is no longer needed.', 'AbortError');
  onProgress('Mask ready');
  await waitForOverlayPaint();
  return {
    ...buildPreview(sourceImage, liveMaskCanvas),
    color: 'rgb(255, 0, 255)',
    score: 0.75
  };
}
