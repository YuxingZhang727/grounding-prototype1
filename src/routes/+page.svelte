<script lang="ts">
  import { Capacitor } from '@capacitor/core';
  import { pushState } from '$app/navigation';
  import { onDestroy, onMount, tick } from 'svelte';
  import SoundTape from '$lib/SoundTape.svelte';
  import GroundingSteps from '$lib/GroundingSteps.svelte';
  import { deleteSticker, loadStickers, saveJournal, saveSticker, type SavedSticker } from '$lib/artifact-store';
  import { deleteRoll, loadRolls, tapeImage, type SoundRoll } from '$lib/sound-tape';

  type Step = 'welcome' | 'camera' | 'crop' | 'segment' | 'fragment' | 'arrange' | 'finish' | 'sound';
  type Fragment = {
    image:string; aspectRatio:number;
    x:number; y:number; size:number; rotation:number;
    artifactId?:string; kind?:'sticker'|'tape';
  };
  type Gesture = {
    mode:'drag'|'resize'|'rotate'; index:number; startX:number; startY:number;
    original:Fragment; stage:DOMRect; centerX:number; centerY:number;
  };
  type SelectionPoint = { x:number; y:number };
  type BrushMode = 'positive' | 'negative' | 'lasso';
  type SelectionStroke = { mode:BrushMode; points:SelectionPoint[] };

  let step: Step = 'welcome';
  let video: HTMLVideoElement;
  let cropStage: HTMLDivElement;
  let collageStage: HTMLDivElement;
  let stream: MediaStream | null = null;
  let capturedImage = '';
  let segmentedImage = '';
  let segmentedOverlay = '';
  let transformedImage = '';
  let segmentedAspectRatio = 1;
  let segmentScore = 0;
  let segmentStatus = '';
  let transformStatus = '';
  let segmentError = '';
  let cameraMessage = '';
  let fragments: Fragment[] = [];
  let activeFragment = -1;
  let gesture: Gesture | null = null;
  let isTransforming = false;
  let cameraReady = false;
  let liveMaskCanvas: HTMLCanvasElement;
  let brushMode: BrushMode = 'positive';
  let selectionStrokes: SelectionStroke[] = [];
  let currentStrokePoints: SelectionPoint[] = [];
  let isPointerDown = false;
  let brushCursor: SelectionPoint | null = null;
  let strokeProgress = 0;
  let isSegmenting = false;
  let segmentationRequest = 0;
  let segmentationQueued = false;
  let directAiMode = false;
  let textureBackground = '';
  let savedStickers: SavedSticker[] = [];
  let soundRolls: SoundRoll[] = [];
  let isSavingJournal = false;
  let journalSaveError = '';
  const MIN_STROKE_LENGTH = 5;

  const placements = [
    { x: 12, y: 18, size: 31, rotation: -10 },
    { x: 49, y: 11, size: 28, rotation: 13 },
    { x: 29, y: 43, size: 34, rotation: -4 },
    { x: 60, y: 49, size: 27, rotation: 19 },
    { x: 10, y: 65, size: 29, rotation: 7 }
  ];

  function placementFor(index: number) {
    if (placements[index]) return placements[index];
    const column = index % 3;
    const row = Math.floor(index / 3) % 3;
    return {
      x: 8 + column * 29 + ((index * 7) % 9),
      y: 8 + row * 28 + ((index * 11) % 8),
      size: 22 + (index % 4) * 2,
      rotation: ((index * 17) % 35) - 17
    };
  }

  async function begin() {
    step = 'camera';
    cameraMessage = '';
    await tick();
    cameraReady = false;
    if (Capacitor.isNativePlatform()) {
      cameraReady = true;
      cameraMessage = 'Tap the shutter to open your camera.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      cameraReady = true;
    } catch (error) {
      cameraMessage = 'Camera unavailable here. You can choose a photo instead.';
    }
  }

  function beginGrounding() {
    window.location.href = '/touch?flow=grounding';
  }

  function selectGroundingStage(next: 'touch' | 'see' | 'hear') {
    if (next === 'touch') { stopCamera(); window.location.href = '/touch?flow=grounding'; return; }
    const url = new URL(window.location.href); url.searchParams.set('start', next);
    pushState(url.pathname + url.search, { groundingStep:next });
    if (next === 'hear') { stopCamera(); step = 'sound'; return; }
    void begin();
  }

  function stopCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  async function prepareCapturedPhoto(sourceUrl: string) {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight, 1));
    if (scale === 1) return sourceUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return sourceUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  async function takePhoto() {
    if (Capacitor.isNativePlatform()) {
      try {
        cameraMessage = 'Opening camera…';
        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          correctOrientation: true,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera
        });
        if (!photo.dataUrl) throw new Error('The camera did not return a photo.');
        capturedImage = await prepareCapturedPhoto(photo.dataUrl);
        clearSegmentation();
        resetSelection();
        stopCamera();
        step = 'crop';
      } catch (error) {
        cameraMessage = error instanceof Error && !error.message.toLowerCase().includes('cancel')
          ? error.message
          : 'Tap the shutter when you are ready.';
      }
      return;
    }
    if (!video?.videoWidth || !cameraReady) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);
    capturedImage = await prepareCapturedPhoto(canvas.toDataURL('image/jpeg', 0.9));
    clearSegmentation();
    resetSelection();
    stopCamera();
    step = 'crop';
  }

  function choosePhoto(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      capturedImage = await prepareCapturedPhoto(String(reader.result));
      clearSegmentation();
      resetSelection();
      stopCamera();
      step = 'crop';
    };
    reader.readAsDataURL(file);
  }

  function clearSegmentation() {
    segmentedImage = '';
    segmentedOverlay = '';
    transformedImage = '';
    segmentedAspectRatio = 1;
    segmentScore = 0;
    segmentStatus = '';
    transformStatus = '';
    segmentError = '';
    isTransforming = false;
    directAiMode = false;
  }

  function resetSelection() {
    selectionStrokes = [];
    currentStrokePoints = [];
    isPointerDown = false;
    brushCursor = null;
    strokeProgress = 0;
    isSegmenting = false;
    segmentationQueued = false;
    segmentationRequest += 1;
    const context = liveMaskCanvas?.getContext('2d');
    context?.clearRect(0, 0, liveMaskCanvas.width, liveMaskCanvas.height);
  }

  function selectionPosition(event: PointerEvent): SelectionPoint {
    const box = cropStage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100))
    };
  }

  function selectionPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const point = selectionPosition(event);
    isPointerDown = true;
    currentStrokePoints = [point];
    brushCursor = point;
    strokeProgress = 0;
    cropStage.setPointerCapture(event.pointerId);
  }

  function selectionPointerMove(event: PointerEvent) {
    if (!isPointerDown) return;
    const current = selectionPosition(event);
    brushCursor = current;
    const last = currentStrokePoints[currentStrokePoints.length - 1];
    if (!last || Math.hypot(current.x - last.x, current.y - last.y) > 0.3) {
      currentStrokePoints = [...currentStrokePoints, current];
      strokeProgress = Math.min(100, (strokeLength(currentStrokePoints) / MIN_STROKE_LENGTH) * 100);
    }
  }

  function selectionPointerUp(event: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    const current = selectionPosition(event);
    const last = currentStrokePoints[currentStrokePoints.length - 1];
    if (!last || Math.hypot(current.x - last.x, current.y - last.y) > 0.3) {
      currentStrokePoints = [...currentStrokePoints, current];
    }
    const length = strokeLength(currentStrokePoints);
    brushCursor = null;
    strokeProgress = 0;
    if (length < MIN_STROKE_LENGTH) {
      currentStrokePoints = [];
      segmentError = 'Keep brushing until the ring is complete.';
      return;
    }
    const completedStroke = { mode: brushMode, points: [...currentStrokePoints] };
    selectionStrokes = [...selectionStrokes, completedStroke];
    currentStrokePoints = [];
    directAiMode = false;
    segmentError = '';
    runSegmentation();
  }

  function selectionPointerCancel() {
    isPointerDown = false;
    currentStrokePoints = [];
    brushCursor = null;
    strokeProgress = 0;
  }

  function strokeLength(points: SelectionPoint[]) {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    return length;
  }

  function strokePath(points: SelectionPoint[], close = false) {
    if (!points.length) return '';
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    return close ? `${path} Z` : path;
  }

  async function runSegmentation() {
    if (!selectionStrokes.length || !liveMaskCanvas) return;
    if (isSegmenting) {
      segmentationQueued = true;
      segmentStatus = 'Updating the cutout…';
      return;
    }
    const request = ++segmentationRequest;
    const strokes = selectionStrokes.map((stroke) => ({ ...stroke, points: [...stroke.points] }));
    isSegmenting = true;
    directAiMode = false;
    segmentError = '';
    transformedImage = '';
    transformStatus = '';
    segmentStatus = 'Preparing the photo…';
    try {
      const { segmentWithBrushStrokes } = await import('$lib/segmenter');
      const result = await segmentWithBrushStrokes(
        capturedImage,
        strokes,
        liveMaskCanvas,
        (message) => segmentStatus = message,
        () => request === segmentationRequest
      );
      if (request !== segmentationRequest) return;
      segmentedImage = result.cutoutUrl;
      segmentedOverlay = result.overlayUrl;
      segmentedAspectRatio = result.aspectRatio;
      segmentScore = result.score;
      segmentStatus = 'Cutout ready';
    } catch (error) {
      if (request !== segmentationRequest) return;
      console.error(error);
      segmentError = error instanceof Error ? error.message : 'The object could not be separated.';
      segmentStatus = '';
    } finally {
      isSegmenting = false;
      if (segmentationQueued && step === 'crop') {
        segmentationQueued = false;
        runSegmentation();
      }
    }
  }

  function clearSelectionPrompts() {
    clearSegmentation();
    resetSelection();
  }

  function keepCutout() {
    const index = fragments.length;
    const sourceImage = transformedImage || segmentedImage;
    if (!sourceImage) return;
    const sticker: SavedSticker = {
      id:crypto.randomUUID(), image:sourceImage, aspectRatio:segmentedAspectRatio,
      name:`Sticker ${savedStickers.length+1}`, created:Date.now()
    };
    fragments = [...fragments, {
      image: sourceImage,
      aspectRatio: segmentedAspectRatio,
      artifactId:sticker.id,
      kind:'sticker',
      ...placementFor(index)
    }];
    savedStickers = [sticker, ...savedStickers];
    void saveSticker(sticker).catch(() => { savedStickers = savedStickers.filter(item => item.id !== sticker.id); });
    step = 'fragment';
  }

  function addSavedSticker(sticker: SavedSticker) {
    const index = fragments.length;
    fragments = [...fragments, { image:sticker.image, aspectRatio:sticker.aspectRatio, artifactId:sticker.id, kind:'sticker', ...placementFor(index) }];
    activeFragment = index;
  }

  function addSavedTape(roll: SoundRoll) {
    const index = fragments.length;
    const width = 360;
    fragments = [...fragments, { image:tapeImage(roll.frames,width), aspectRatio:width/88, artifactId:roll.id, kind:'tape', x:14+(index%3)*8, y:58+(index%3)*7, size:62, rotation:-5+(index%3)*5 }];
    activeFragment = index;
  }

  async function removeSavedSticker(sticker: SavedSticker) {
    await deleteSticker(sticker.id);
    savedStickers = savedStickers.filter(item => item.id !== sticker.id);
  }

  async function removeSavedTape(roll: SoundRoll) {
    await deleteRoll(roll.id);
    soundRolls = soundRolls.filter(item => item.id !== roll.id);
  }

  function chooseAgain() {
    clearSegmentation();
    resetSelection();
    step = 'crop';
  }

  /** Returns to the camera with the current photo discarded. */
  function retakePhoto() {
    capturedImage = '';
    clearSegmentation();
    resetSelection();
    step = 'camera';
    begin();
  }

  function continueLooking() {
    capturedImage = '';
    clearSegmentation();
    resetSelection();
    begin();
  }

  function finishCollecting() {
    if (!fragments.length) return;
    stopCamera();
    capturedImage = '';
    clearSegmentation();
    activeFragment = -1;
    step = 'sound';
  }

  async function stylizeLocally(sourceUrl: string) {
    const source = new Image();
    source.src = sourceUrl;
    await source.decode();

    const maxDimension = 900;
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height, 1));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas available in this browser.');

    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'saturate(.62) contrast(1.18) sepia(.12) drop-shadow(0 0 10px #fff) drop-shadow(0 0 10px #fff)';
    ctx.drawImage(source, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    return canvas.toDataURL('image/png');
  }

  async function stylizeWithAI(sourceUrl: string, detectObject = false) {
    const endpoint = import.meta.env.VITE_STYLIZE_API_URL
      || (Capacitor.isNativePlatform()
        ? 'https://grounding-prototype1.yuxing050727.workers.dev/api/stylize'
        : '/api/stylize');
    // Resolve fetch at call time so SvelteKit never treats this browser-only
    // interaction as an eager server-side request during SSR.
    let response: Response;
    try {
      response = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: sourceUrl, detectObject })
      });
    } catch {
      const host = endpoint.startsWith('http') ? new URL(endpoint).host : window.location.host;
      throw new Error(`Could not reach the AI service at ${host}. Check this device's internet connection and try again.`);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error || `Server ${response.status}`;
      throw new Error(`AI service error: ${message}`);
    }

    const payload = await response.json();
    if (!payload?.success || !payload?.image) {
      throw new Error(payload?.error || 'AI returned an empty image.');
    }

      return payload.image as string;
  }

  async function transformCutout() {
    if (!segmentedImage || isTransforming) return;
    isTransforming = true;
    transformStatus = 'Running artistic transform…';
    try {
      transformedImage = await stylizeWithAI(segmentedImage, directAiMode);
      segmentedAspectRatio = 1;
      transformStatus = 'Rubber-stamp collage piece ready.';
    } catch (error) {
      const fallbackMessage = error instanceof Error ? error.message : 'Could not use AI conversion.';
      console.error('AI transform failed:', fallbackMessage);
      if (directAiMode) {
        transformedImage = '';
        transformStatus = fallbackMessage;
      } else {
        transformedImage = await stylizeLocally(segmentedImage);
        transformStatus = `${fallbackMessage} Using local style rendering.`;
      }
    } finally {
      isTransforming = false;
    }
  }

  function fragmentPointerDown(event: PointerEvent, index: number, mode: Gesture['mode']) {
    event.stopPropagation();
    activeFragment = index;
    const item = fragments[index];
    const stage = collageStage.getBoundingClientRect();
    gesture = {
      mode, index, startX: event.clientX, startY: event.clientY,
      original: { ...item }, stage,
      centerX: stage.left + ((item.x + item.size / 2) / 100) * stage.width,
      centerY: stage.top + ((item.y + item.size / 2) / 100) * stage.height
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function hitsVisiblePixel(event: PointerEvent, index: number) {
    const fragment = fragments[index];
    const image = collageStage.querySelector<HTMLImageElement>(`img[data-fragment="${index}"]`);
    if (!fragment || !image?.complete || !image.naturalWidth) return false;

    const stage = collageStage.getBoundingClientRect();
    const itemWidth = (fragment.size / 100) * stage.width;
    const itemHeight = itemWidth / fragment.aspectRatio;
    const centerX = stage.left + (fragment.x / 100) * stage.width + itemWidth / 2;
    const centerY = stage.top + (fragment.y / 100) * stage.height + itemHeight / 2;
    const angle = (-fragment.rotation * Math.PI) / 180;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const localX = Math.cos(angle) * dx - Math.sin(angle) * dy + itemWidth / 2;
    const localY = Math.sin(angle) * dx + Math.cos(angle) * dy + itemHeight / 2;
    if (localX < 0 || localY < 0 || localX >= itemWidth || localY >= itemHeight) return false;

    const scale = Math.min(itemWidth / image.naturalWidth, itemHeight / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const imageX = localX - (itemWidth - renderedWidth) / 2;
    const imageY = localY - (itemHeight - renderedHeight) / 2;
    if (imageX < 0 || imageY < 0 || imageX >= renderedWidth || imageY >= renderedHeight) return false;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return true;
      context.drawImage(image, imageX / scale, imageY / scale, 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] > 24;
    } catch {
      return true;
    }
  }

  function collagePointerDown(event: PointerEvent) {
    if (step !== 'arrange' || (event.target as HTMLElement).closest('button')) return;
    for (let index = fragments.length - 1; index >= 0; index -= 1) {
      if (hitsVisiblePixel(event, index)) {
        fragmentPointerDown(event, index, 'drag');
        return;
      }
    }
    activeFragment = -1;
  }

  function moveLayer(direction: -1 | 1) {
    if (activeFragment < 0) return;
    const target = activeFragment + direction;
    if (target < 0 || target >= fragments.length) return;
    const reordered = [...fragments];
    [reordered[activeFragment], reordered[target]] = [reordered[target], reordered[activeFragment]];
    fragments = reordered;
    activeFragment = target;
  }

  function removeFragmentFromPage(index: number) {
    if (index < 0 || index >= fragments.length) return;
    fragments = fragments.filter((_, fragmentIndex) => fragmentIndex !== index);
    gesture = null;
    activeFragment = -1;
  }

  function fragmentKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activeFragment = index;
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && fragments[index]?.kind === 'sticker') {
      event.preventDefault();
      event.stopPropagation();
      removeFragmentFromPage(index);
    }
  }

  function fragmentPointerMove(event: PointerEvent) {
    if (!gesture) return;
    const { index, mode, original, stage } = gesture;
    const next = { ...fragments[index] };
    if (mode === 'drag') {
      next.x = Math.max(-8, Math.min(92, original.x + ((event.clientX - gesture.startX) / stage.width) * 100));
      next.y = Math.max(-8, Math.min(92, original.y + ((event.clientY - gesture.startY) / stage.height) * 100));
    } else if (mode === 'resize') {
      const delta = ((event.clientX - gesture.startX) + (event.clientY - gesture.startY)) / 2;
      next.size = Math.max(14, Math.min(58, original.size + (delta / stage.width) * 100));
    } else {
      const angle = Math.atan2(event.clientY - gesture.centerY, event.clientX - gesture.centerX) * 180 / Math.PI;
      next.rotation = angle + 90;
    }
    fragments = fragments.map((fragment, i) => i === index ? next : fragment);
  }

  function fragmentPointerUp() { gesture = null; }

  function loadPageImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('A page element could not be rendered.'));
      image.src = source;
    });
  }

  async function renderJournalPage() {
    const size = 1200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device could not create the journal image.');

    context.fillStyle = '#faf9f5';
    context.fillRect(0, 0, size, size);
    if (textureBackground) {
      const background = await loadPageImage(textureBackground);
      const scale = Math.max(size / background.naturalWidth, size / background.naturalHeight);
      const width = background.naturalWidth * scale;
      const height = background.naturalHeight * scale;
      context.drawImage(background, (size - width) / 2, (size - height) / 2, width, height);
    }

    for (const fragment of fragments) {
      const image = await loadPageImage(fragment.image);
      const width = fragment.size / 100 * size;
      const height = width / fragment.aspectRatio;
      const x = fragment.x / 100 * size;
      const y = fragment.y / 100 * size;
      context.save();
      context.translate(x + width / 2, y + height / 2);
      context.rotate(fragment.rotation * Math.PI / 180);
      context.drawImage(image, -width / 2, -height / 2, width, height);
      context.restore();
    }

    return canvas.toDataURL('image/jpeg', .9);
  }

  async function finishGrounding() {
    if (isSavingJournal) return;
    isSavingJournal = true;
    journalSaveError = '';
    try {
      await saveJournal({
        id: crypto.randomUUID(),
        image: await renderJournalPage(),
        created: Date.now(),
        stickerCount: fragments.filter(fragment => fragment.kind === 'sticker').length,
        tapeCount: fragments.filter(fragment => fragment.kind === 'tape').length
      });
      window.location.href = '/app?tab=archive';
    } catch (error) {
      journalSaveError = error instanceof Error ? error.message : 'The journal page could not be saved on this device.';
      isSavingJournal = false;
    }
  }

  function restart() {
    stopCamera();
    fragments = [];
    capturedImage = '';
    clearSegmentation();
    activeFragment = -1;
    step = 'welcome';
  }

  onMount(() => {
    textureBackground = sessionStorage.getItem('grounding-touch-background') || '';
    loadStickers().then(value => savedStickers=value).catch(() => {});
    loadRolls().then(value => soundRolls=value).catch(() => {});
    const start = new URLSearchParams(window.location.search).get('start');
    if (start === 'see') begin();
    if (start === 'sound') step = 'sound';
    const restoreStage = () => {
      const current = new URLSearchParams(window.location.search).get('start');
      if (current === 'sound') { stopCamera(); step = 'sound'; }
      if (current === 'see') {
        void begin();
      }
    };
    window.addEventListener('popstate', restoreStage);
    return () => window.removeEventListener('popstate', restoreStage);
  });

  onDestroy(stopCamera);
</script>

<svelte:head>
  <title>GROUNDING — Feel the present</title>
  <meta name="description" content="Translate touch and sight into a personal grounding collage." />
</svelte:head>

{#if step !== 'welcome'}
  {#key step}<GroundingSteps active={step === 'sound' || step === 'arrange' || step === 'finish' ? 'hear' : 'see'} onselect={selectGroundingStage} />{/key}
{/if}
<main class:dark={step === 'camera'} class:canvas-mode={step === 'arrange' || step === 'finish'} class:in-flow={step !== 'welcome'}>
  <header>
    <button class="wordmark" onclick={restart} aria-label="Return to start">{step === 'welcome' || step === 'arrange' || step === 'finish' ? 'GROUNDING' : step === 'sound' ? 'HEAR' : 'SEE'}<span>·</span></button>
    {#if step !== 'welcome' && step !== 'finish'}
      <div class="progress" aria-label={`${fragments.length} things gathered`}>
        <span class="gathered-count">{fragments.length} gathered</span>
        {#each fragments as _}
          <i></i>
        {/each}
      </div>
    {/if}
  </header>

  {#if step === 'welcome'}
    <section class="welcome">
      <p class="eyebrow">A personalized grounding practice</p>
      <h1>GROUNDING</h1>
      <div class="intro">
        <p>Take a moment to feel the present.</p>
      </div>
      <button class="primary" onclick={beginGrounding}>Start grounding <span>↗</span></button>
    </section>

  {:else if step === 'camera'}
    <section class="camera-screen">
      <div class="camera-copy">
        <span class="count-label">A new thing</span>
        <h2>Find something that<br />catches your attention.</h2>
      </div>
      <div class="viewfinder">
        <video
          bind:this={video}
          playsinline
          muted
          oncanplay={() => {
            if (video?.videoWidth && video.videoHeight) cameraReady = true;
          }}
        ></video>
        {#if cameraMessage}
          <div class="camera-fallback"><p>{cameraMessage}</p></div>
        {/if}
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
      </div>
      <div class="camera-actions">
        <div class="camera-side">
          <label class="text-button">Choose photo<input type="file" accept="image/*" capture="environment" onchange={choosePhoto} /></label>
          {#if fragments.length}
            <span class="camera-side-note">{fragments.length} gathered</span>
          {/if}
        </div>
        <button class="shutter" class:disabled={!cameraReady} onclick={takePhoto} disabled={!cameraReady} aria-label="Take photo" type="button">
          <span></span>
        </button>
        <div class="camera-side end">
          {#if fragments.length}
            <button class="text-button" onclick={finishCollecting} type="button">Done gathering</button>
          {/if}
        </div>
      </div>
    </section>

  {:else if step === 'crop'}
    <section class="focus-screen">
      <div class="section-heading">
        <span class="count-label">Thing {fragments.length + 1}</span>
        <h2>What caught your attention?</h2>
        <p>Brush across the object. Release to update the live mask.</p>
      </div>
      <label class="brush-mode-control">
        <span>Brush mode</span>
        <select bind:value={brushMode} aria-label="Brush mode">
          <option value="positive">Add object</option>
          <option value="negative">Remove area</option>
          <option value="lasso">Lasso</option>
        </select>
      </label>
      <div class="crop-wrap">
        <div class="selection-card">
          <span class="selection-card-label">Live mask</span>
          <div
            class="crop-stage"
            bind:this={cropStage}
            onpointerdown={selectionPointerDown}
            onpointermove={selectionPointerMove}
            onpointerup={selectionPointerUp}
            onpointercancel={selectionPointerCancel}
            role="application"
            aria-label="Brush across the object to update its MediaPipe mask"
          >
            <img src={capturedImage} alt="Your captured view" draggable="false" />
            <canvas class="live-mask-canvas" bind:this={liveMaskCanvas} aria-hidden="true"></canvas>
            <svg class="brush-strokes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {#each selectionStrokes as stroke}
                <path
                  class="brush-stroke"
                  class:negative={stroke.mode === 'negative'}
                  class:lasso={stroke.mode === 'lasso'}
                  d={strokePath(stroke.points, stroke.mode === 'lasso')}
                />
              {/each}
              {#if currentStrokePoints.length}
                <path
                  class="brush-stroke active"
                  class:negative={brushMode === 'negative'}
                  class:lasso={brushMode === 'lasso'}
                  d={strokePath(currentStrokePoints, false)}
                />
              {/if}
            </svg>
            {#if isPointerDown && brushCursor}
              <span
                class="stroke-progress"
                class:complete={strokeProgress >= 100}
                style={`left:${brushCursor.x}%;top:${brushCursor.y}%`}
                aria-hidden="true"
              >
                <svg viewBox="0 0 48 48">
                  <circle class="progress-track" cx="24" cy="24" r="19"></circle>
                  <circle
                    class="progress-value"
                    cx="24"
                    cy="24"
                    r="19"
                    pathLength="100"
                    stroke-dasharray={`${strokeProgress} 100`}
                  ></circle>
                </svg>
                <span>{strokeProgress >= 100 ? '✓' : ''}</span>
              </span>
            {/if}
          </div>
        </div>
        <div class="selection-card preview-card">
          <span class="selection-card-label">MediaPipe preview</span>
          <div class="selection-preview checkerboard" class:loading={isSegmenting}>
            {#if segmentedImage}
              <img src={segmentedImage} alt="Preview of the currently selected object" />
            {:else}
              <p aria-live="polite">
                {segmentError || (isSegmenting ? segmentStatus : 'Your selected object will appear here.')}
              </p>
            {/if}
            {#if isSegmenting && segmentedImage}
              <span class="preview-updating">Updating…</span>
            {/if}
          </div>
        </div>
      </div>
      <div class="selection-actions">
        <button
          class="secondary"
          onclick={clearSelectionPrompts}
          disabled={!selectionStrokes.length}
        >Reset selection</button>
        <button class="secondary" onclick={retakePhoto} type="button">Retake photo</button>
        <button
          class="primary compact"
          onclick={() => step = 'segment'}
          disabled={!segmentedImage || isSegmenting}
        >
          Use this cutout <span>→</span>
        </button>
      </div>
      <p class="selection-help" aria-live="polite">
        {segmentError || (isSegmenting ? segmentStatus : `${selectionStrokes.length} ${selectionStrokes.length === 1 ? 'stroke' : 'strokes'} added`)}
      </p>
    </section>

  {:else if step === 'segment'}
    <section class="segment-screen">
      <div class="section-heading">
        <span class="count-label">Thing {fragments.length + 1}</span>
        <h2>Separating what you saw.</h2>
        <p>{segmentError || segmentStatus}</p>
      </div>

      <div class="segment-preview" class:loading={!segmentedImage && !segmentError}>
        {#if segmentedImage}
          <div class="comparison-card original">
            <span>{directAiMode ? 'Selected frame' : 'In the scene'}</span>
            <img src={segmentedOverlay} alt="The selected object highlighted in the original scene" />
          </div>
          <div class="comparison-card stylized">
            <span>{transformedImage ? 'Collage piece' : (directAiMode ? 'AI input' : 'Cutout')}</span>
            {#if isTransforming}
              <div class="segment-loading" aria-live="polite">
                <div class="scan-object"></div>
                <span class="scan-line"></span>
                <p>Making your rubber-stamp collage piece…</p>
              </div>
            {:else if transformedImage}
              <div class="checkerboard">
                <img src={transformedImage} alt="The transformed object for collage" />
              </div>
            {:else}
              <div class="checkerboard">
                <img src={segmentedImage} alt="The separated object before artistic transformation" />
              </div>
            {/if}
          </div>
        {:else if segmentError}
          <div class="segment-failure">
            <div class="failure-mark">×</div>
            <h3>We lost the edge.</h3>
            <p>Try drawing a tighter frame around one object.</p>
          </div>
        {:else}
          <div class="segment-loading" aria-live="polite">
            <div class="scan-object"></div>
            <span class="scan-line"></span>
            <p>The first cutout may take a moment while the model loads.</p>
          </div>
        {/if}
      </div>

      <div class="segment-actions">
        <button class="secondary" onclick={chooseAgain}>Choose again</button>
        {#if !transformedImage && segmentedImage}
          <button class="primary compact" onclick={transformCutout} disabled={isTransforming}>{directAiMode ? 'Detect & make sticker' : 'Make collage piece'} <span>→</span></button>
        {:else if transformedImage}
          <button class="secondary compact" onclick={keepCutout}>Use transformed piece <span>→</span></button>
          <button class="primary compact" onclick={transformCutout} disabled={isTransforming}>Try again <span>↻</span></button>
        {/if}
      </div>
      {#if segmentedImage}
        <p class="local-note">
          {#if !directAiMode && segmentScore}
            Mask score {Math.round(Math.max(0, Math.min(1, segmentScore)) * 100)}% ·
          {/if}
          {transformStatus || (directAiMode ? 'Ready for AI to detect the object in this frame.' : 'Ready to make one rubber-stamp collage piece.')}
        </p>
      {/if}
    </section>

  {:else if step === 'fragment'}
    {@const latest = fragments[fragments.length - 1]}
    <section class="fragment-screen">
      <p class="eyebrow">A fragment from what you saw</p>
      <div class="fragment-stage">
        <img class="object-fragment" src={latest.image} alt="Your separated object" />
        <span class="orbit-line"></span>
      </div>
      <h2>{fragments.length} {fragments.length === 1 ? 'thing' : 'things'} noticed</h2>
      <p class="fragment-note">A transformed fragment from what was around you.</p>
      <div class="fragment-actions">
        <button class="secondary" onclick={continueLooking}>Notice another</button>
        <button class="primary compact" onclick={finishCollecting}>Done <span>→</span></button>
      </div>
    </section>

  {:else if step === 'sound'}
    <SoundTape
      onadd={(image, aspectRatio) => {
        fragments = [...fragments, { image, aspectRatio, kind:'tape', x:18, y:64, size:65, rotation:-6 }];
        activeFragment = -1;
        step = 'arrange';
      }}
      onsaved={(roll) => soundRolls = [roll, ...soundRolls.filter(item => item.id !== roll.id)]}
      ondeleted={(id) => soundRolls = soundRolls.filter(item => item.id !== id)}
    />
  {:else if step === 'arrange' || step === 'finish'}
    <section class="arrange-screen">
      <div class="arrange-heading">
        {#if step === 'arrange'}
          <span class="count-label">Touch, sight, and sound, gathered</span>
          <h2>Adjust this page.</h2>
          <p>Arrange the stickers and tape from your grounding moment. Drag a piece, then resize, rotate, reorder, or remove it.</p>
        {:else}
          <span class="count-label">Today’s grounding journal</span>
          <h2>Touch, sight, and sound,<br />gathered here.</h2>
          <p>Your texture became the page, your stickers hold what you saw, and your tape keeps what you heard.</p>
        {/if}
      </div>
      <div class="collage-shell">
        <div
          class="collage"
          class:editing={step === 'arrange'}
          style={`background-image:${textureBackground ? `url(${textureBackground})` : 'none'}`}
          bind:this={collageStage}
          onpointerdown={collagePointerDown}
          onpointermove={fragmentPointerMove}
          onpointerup={fragmentPointerUp}
          role="application"
          aria-label="Arrange collage pieces"
        >
          {#each fragments as fragment, index}
            <div
              class="collage-item"
              class:active={activeFragment === index && step === 'arrange'}
              style={`left:${fragment.x}%;top:${fragment.y}%;width:${fragment.size}%;aspect-ratio:${fragment.aspectRatio};transform:rotate(${fragment.rotation}deg);z-index:${index + 1}`}
              role="button"
              tabindex={step === 'arrange' ? 0 : -1}
              aria-label={`Fragment ${index + 1}`}
              onkeydown={(event) => fragmentKeyDown(event, index)}
            >
              <img src={fragment.image} alt="" draggable="false" data-fragment={index} />
              {#if step === 'arrange' && activeFragment === index}
                <button class="rotate-handle" aria-label="Rotate fragment" onpointerdown={(event) => fragmentPointerDown(event, index, 'rotate')}>↻</button>
                <button class="resize-handle" aria-label="Resize fragment" onpointerdown={(event) => fragmentPointerDown(event, index, 'resize')}></button>
              {/if}
            </div>
          {/each}
          <span class="canvas-mark">TODAY / {String(fragments.length).padStart(2, '0')}</span>
        </div>
      </div>
      {#if step === 'arrange'}
        <div class="arrange-actions">
          {#if activeFragment >= 0}
            <div class="layer-controls" aria-label="Selected piece controls">
              <button class="secondary layer-button" onclick={() => moveLayer(-1)} disabled={activeFragment === 0}>Send backward</button>
              <button class="secondary layer-button" onclick={() => moveLayer(1)} disabled={activeFragment === fragments.length - 1}>Bring forward</button>
              {#if fragments[activeFragment]?.kind === 'sticker'}
                <button class="secondary layer-button remove-page-button" onclick={() => removeFragmentFromPage(activeFragment)} aria-label="Remove selected sticker from this page">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                  Remove sticker
                </button>
              {/if}
            </div>
          {/if}
          <button class="primary compact" onclick={() => { activeFragment = -1; step = 'finish'; }}>Review today’s page <span>✓</span></button>
          {#if savedStickers.length || soundRolls.length}
            <div class="materials">
              <div class="materials-heading"><strong>Your saved pieces</strong><span>Tap a piece to use it again.</span></div>
              <div class="material-strip">
                {#each savedStickers as sticker}
                  <div class="material-item"><button class="material-add" onclick={() => addSavedSticker(sticker)} aria-label={`Add ${sticker.name} to this collage`}><img src={sticker.image} alt="" /><span>{sticker.name}</span></button><button class="material-delete" onclick={() => removeSavedSticker(sticker)} aria-label={`Delete ${sticker.name}`}>×</button></div>
                {/each}
                {#each soundRolls as roll}
                  <div class="material-item tape"><button class="material-add" onclick={() => addSavedTape(roll)} aria-label={`Add ${roll.name} to this collage`}><img src={tapeImage(roll.frames,180)} alt="" /><span>{roll.name}</span></button><button class="material-delete" onclick={() => removeSavedTape(roll)} aria-label={`Delete ${roll.name}`}>×</button></div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <button class="secondary" onclick={() => step = 'arrange'}>Adjust this page</button>
        <button class="primary compact" onclick={finishGrounding} disabled={isSavingJournal}>{isSavingJournal ? 'Saving page…' : 'Finish grounding'} <span>✓</span></button>
        {#if journalSaveError}<p class="journal-save-error" role="alert">{journalSaveError}</p>{/if}
      {/if}
    </section>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { background: #f3f0e9; }
  :global(body) { margin: 0; color: #1b211c; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(button), :global(label) { font: inherit; }
  :global(button) { color: inherit; }

  main { --ink:#1b211c; --paper:#f3f0e9; min-height: 100svh; background: var(--paper); overflow-x:hidden; position: relative; transition: background .3s ease; }
  main.in-flow > header { display:none; }
  main::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.22; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E"); mix-blend-mode:multiply; }
  main.dark { --ink:#f3f0e9; --paper:#17201b; }
  header { height:calc(84px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) clamp(24px,5vw,72px) 0; display:flex; align-items:center; justify-content:space-between; position:absolute; top:0; left:0; right:0; z-index:30; }
  .wordmark { border:0; background:none; padding:0; font-family:Georgia,serif; font-size:22px; letter-spacing:.16em; cursor:pointer; }
  .wordmark span { color:#c54b34; }
  .progress { display:flex; align-items:center; gap:6px; }
  .progress .gathered-count { margin-right:4px; text-transform:uppercase; font-size:9px; font-weight:650; letter-spacing:.15em; opacity:.7; }
  .progress i { display:block; width:7px; height:7px; border-radius:50%; background:#c54b34; }
  section { position:relative; z-index:1; min-height:100svh; }
  .welcome { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:110px 24px 60px; }
  .eyebrow,.count-label { text-transform:uppercase; font-size:11px; font-weight:650; letter-spacing:.2em; }
  .eyebrow { color:#7d8075; margin:0 0 24px; }
  h1 { font-family:Georgia,serif; font-weight:400; letter-spacing:.12em; font-size:clamp(46px,9vw,118px); line-height:.86; margin:0 0 54px; transform:translateX(.06em); }
  .intro { font-family:Georgia,serif; font-size:clamp(19px,2.4vw,27px); line-height:1.45; margin-bottom:42px; }
  .intro p { margin:0; }
  .primary { border:0; border-radius:100px; background:#1b211c; color:#fff; height:58px; padding:0 26px; min-width:190px; cursor:pointer; display:inline-flex; align-items:center; justify-content:space-between; gap:28px; transition:transform .2s, background .2s; }
  .primary:hover { transform:translateY(-2px); background:#c54b34; }
  .primary span { font-size:18px; }
  .primary.compact { height:52px; min-width:174px; }
  .secondary { background:transparent; border:1px solid #9b9c93; border-radius:100px; padding:15px 28px; cursor:pointer; }

  .camera-screen { color:#f3f0e9; display:grid; grid-template-rows:minmax(430px,1fr) auto; gap:22px; padding:100px clamp(20px,5vw,70px) 30px; }
  .camera-copy { position:absolute; z-index:3; top:110px; left:clamp(36px,8vw,120px); text-shadow:0 1px 20px #000; }
  .camera-copy .count-label { opacity:.75; }
  h2 { font-family:Georgia,serif; font-size:clamp(34px,4vw,58px); font-weight:400; line-height:1.06; letter-spacing:-.025em; margin:16px 0; }
  .viewfinder { position:relative; width:min(100%,1040px); height:100%; min-height:430px; margin:auto; background:#28322c; overflow:hidden; border-radius:2px; }
  .viewfinder video { width:100%; height:100%; object-fit:cover; }
  .camera-fallback { position:absolute; inset:0; display:grid; place-items:center; color:#c8ccc8; text-align:center; }
  .corner { position:absolute; width:32px; height:32px; border-color:#fff; opacity:.7; }
  .corner.tl { left:20px; top:20px; border-left:1px solid; border-top:1px solid; }.corner.tr { right:20px; top:20px; border-right:1px solid; border-top:1px solid; }.corner.bl { left:20px; bottom:20px; border-left:1px solid; border-bottom:1px solid; }.corner.br { right:20px; bottom:20px; border-right:1px solid; border-bottom:1px solid; }
  .camera-actions { display:grid; grid-template-columns:1fr 1fr 1fr; align-items:center; width:min(100%,1040px); margin:auto; }
  .camera-side { display:flex; flex-direction:column; align-items:flex-start; gap:6px; min-width:0; }
  .camera-side.end { align-items:flex-end; }
  .camera-side-note { color:rgba(255,255,255,.62); font-size:10px; letter-spacing:.1em; text-transform:uppercase; }
  .text-button { justify-self:start; cursor:pointer; font-size:13px; text-decoration:underline; text-underline-offset:5px; }
  .text-button input { display:none; }
  .shutter { justify-self:center; width:60px; height:60px; padding:5px; border-radius:50%; border:1px solid #fff; background:none; cursor:pointer; }
  .shutter span { display:block; width:100%; height:100%; border-radius:50%; background:#f3f0e9; }

  .focus-screen { padding:104px 24px 36px; display:flex; flex-direction:column; align-items:center; }
  .section-heading { text-align:center; margin-bottom:26px; }
  .section-heading h2 { font-size:clamp(32px,4vw,48px); margin:11px 0 6px; }
  .section-heading p,.arrange-heading p { color:#6d736d; margin:0; }
  .brush-mode-control { width:min(1000px,100%); min-height:44px; margin:-10px auto 12px; display:flex; align-items:center; justify-content:flex-end; gap:10px; color:#6d736d; font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
  .brush-mode-control select { min-height:44px; padding:0 38px 0 16px; border:1px solid #a9aaa2; border-radius:100px; background:#f5f2eb; color:#1b211c; font:inherit; letter-spacing:.04em; cursor:pointer; }
  .crop-wrap { width:min(1000px,100%); height:clamp(300px,52svh,520px); max-height:520px; flex:0 1 auto; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:stretch; margin-bottom:18px; overflow:hidden; }
  .selection-card { min-width:0; min-height:0; height:100%; position:relative; display:grid; place-items:center; background:#e8e5dc; overflow:hidden; }
  .selection-card-label { position:absolute; z-index:5; left:14px; top:13px; padding:7px 10px; background:rgba(20,25,21,.72); color:#fff; border-radius:100px; font-size:10px; letter-spacing:.12em; text-transform:uppercase; backdrop-filter:blur(8px); }
  .crop-stage { position:relative; display:inline-block; max-width:100%; max-height:clamp(300px,52svh,520px); cursor:crosshair; touch-action:none; user-select:none; overflow:hidden; box-shadow:0 18px 55px rgba(36,40,34,.12); }
  .crop-stage img { display:block; max-width:100%; max-height:clamp(300px,52svh,520px); pointer-events:none; }
  .live-mask-canvas,.brush-strokes { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  .live-mask-canvas { z-index:1; opacity:.62; }
  .brush-strokes { z-index:2; overflow:visible; }
  .brush-stroke { fill:none; stroke:#4caf50; stroke-width:.8; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
  .brush-stroke.negative { stroke:#e53935; }
  .brush-stroke.lasso { stroke:#2196f3; fill:rgba(33,150,243,.15); }
  .brush-stroke.active { stroke-width:1; }
  .stroke-progress { --ring:#ff5722; position:absolute; z-index:3; width:52px; height:52px; transform:translate(-50%,-50%); display:grid; place-items:center; color:#fff; filter:drop-shadow(0 2px 5px rgba(20,25,21,.32)); pointer-events:none; }
  .stroke-progress.complete { --ring:#4caf50; }
  .stroke-progress svg { position:absolute; inset:0; width:100%; height:100%; transform:rotate(-90deg); }
  .stroke-progress circle { fill:none; stroke-width:4; }
  .progress-track { stroke:rgba(255,255,255,.78); }
  .progress-value { stroke:var(--ring); stroke-linecap:round; transition:stroke .12s; }
  .stroke-progress > span { position:relative; width:18px; height:18px; border-radius:50%; display:grid; place-items:center; background:var(--ring); font-size:12px; font-weight:700; transition:background .12s; }
  .selection-preview { position:relative; width:100%; height:100%; min-height:0; overflow:hidden; }
  .selection-preview.checkerboard { padding:0; }
  .selection-preview.checkerboard > img { position:absolute; inset:7%; width:86%; height:86%; max-width:86%; max-height:86%; object-fit:contain; }
  .selection-preview > p { margin:0; max-width:240px; padding:24px; text-align:center; color:#777a72; line-height:1.45; }
  .selection-preview.loading > img { opacity:.55; }
  .preview-updating { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:7px 11px; border-radius:100px; background:rgba(20,25,21,.76); color:#fff; font-size:10px; letter-spacing:.1em; text-transform:uppercase; }
  .selection-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:12px; }
  .selection-actions button:disabled { cursor:not-allowed; opacity:.42; }
  .selection-help { min-height:1.3em; margin:10px 0 0; color:#81847c; font-size:10px; letter-spacing:.08em; }

  .segment-screen { height:100svh; min-height:620px; padding:92px 24px 24px; display:flex; flex-direction:column; align-items:center; overflow-y:auto; }
  .segment-screen .section-heading { margin-bottom:22px; }
  .segment-screen .section-heading p { min-height:1.4em; }
  .segment-preview { width:min(900px,100%); height:min(500px,48svh); min-height:240px; flex:1 1 auto; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; margin-bottom:18px; overflow:hidden; }
  .comparison-card { min-width:0; min-height:0; position:relative; background:#e8e5dc; overflow:hidden; display:grid; place-items:center; }
  .comparison-card > span { position:absolute; z-index:2; left:14px; top:13px; padding:7px 10px; background:rgba(20,25,21,.72); color:#fff; border-radius:100px; font-size:10px; letter-spacing:.12em; text-transform:uppercase; backdrop-filter:blur(8px); }
  .comparison-card > img,.checkerboard > img { width:100%; height:100%; object-fit:contain; }
  .comparison-card.original > img { object-fit:cover; }
  .checkerboard { width:100%; height:100%; display:grid; place-items:center; padding:7%; background-color:#eeece6; background-image:linear-gradient(45deg,#dedbd2 25%,transparent 25%),linear-gradient(-45deg,#dedbd2 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#dedbd2 75%),linear-gradient(-45deg,transparent 75%,#dedbd2 75%); background-size:24px 24px; background-position:0 0,0 12px,12px -12px,-12px 0; }
  .checkerboard > img { filter:drop-shadow(0 14px 18px rgba(25,30,25,.18)); }
  .segment-preview.loading { grid-template-columns:1fr; background:#e8e5dc; }
  .segment-loading,.segment-failure { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:#6d736d; position:relative; overflow:hidden; }
  .segment-loading p,.segment-failure p { max-width:310px; line-height:1.5; margin:24px 0 0; }
  .scan-object { width:132px; height:112px; border-radius:61% 39% 44% 56% / 38% 55% 45% 62%; background:#b9b7ae; opacity:.68; transform:rotate(-8deg); }
  .scan-line { position:absolute; width:190px; height:1px; background:#c54b34; box-shadow:0 0 14px #c54b34; animation:scan 2s ease-in-out infinite alternate; }
  @keyframes scan { from { transform:translateY(-72px); } to { transform:translateY(72px); } }
  .failure-mark { width:64px; height:64px; border:1px solid #b5b3aa; border-radius:50%; display:grid; place-items:center; font-family:Georgia,serif; font-size:34px; }
  .segment-failure h3 { font-family:Georgia,serif; color:var(--ink); font-size:27px; font-weight:400; margin:22px 0 -12px; }
  .segment-actions { flex:0 0 auto; display:flex; align-items:center; justify-content:center; gap:12px; position:relative; z-index:3; }
  .local-note { margin:11px 0 0; color:#81847c; font-size:10px; letter-spacing:.08em; }

  .fragment-screen { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:100px 24px 50px; }
  .fragment-screen .eyebrow { margin-bottom:10px; }
  .fragment-stage { width:min(340px,72vw); aspect-ratio:1; position:relative; display:grid; place-items:center; margin:6px 0 16px; }
  .object-fragment { width:72%; height:72%; object-fit:contain; position:relative; z-index:2; filter:drop-shadow(0 18px 18px rgba(25,30,25,.18)); }
  .orbit-line { position:absolute; width:88%; height:88%; border:1px solid #c5c3ba; border-radius:50%; }
  .fragment-screen h2 { font-size:32px; margin:0; }
  .fragment-note { color:#6d736d; margin:6px 0 26px; }
  .fragment-actions { display:flex; align-items:center; justify-content:center; gap:12px; }

  .arrange-screen { padding:96px clamp(22px,5vw,70px) 34px; display:grid; grid-template-columns:minmax(270px, .7fr) minmax(400px,1.3fr); grid-template-rows:1fr auto; gap:28px 5vw; align-items:center; max-width:1400px; margin:auto; }
  .arrange-heading h2 { font-size:clamp(40px,5vw,68px); }
  .arrange-heading p { max-width:330px; line-height:1.55; }
  .collage-shell { grid-row:1 / 3; grid-column:2; width:100%; display:grid; place-items:center; }
  .collage { width:min(100%,680px); aspect-ratio:1; background-color:#faf9f5; background-size:cover; background-position:center; box-shadow:0 22px 70px rgba(34,39,34,.13); position:relative; overflow:hidden; touch-action:none; }
  .collage-item { position:absolute; cursor:grab; touch-action:none; transition:filter .15s; display:grid; place-items:center; }
  .collage-item > img { width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; filter:drop-shadow(0 8px 7px rgba(25,30,25,.14)); }
  .collage-item.active { outline:1px dashed #202720; outline-offset:3px; filter:saturate(1.08); }
  .rotate-handle,.resize-handle { position:absolute; z-index:20; width:19px; height:19px; padding:0; background:#1b211c; color:#fff; border:2px solid #faf9f5; border-radius:50%; display:grid; place-items:center; cursor:crosshair; }
  .rotate-handle { left:50%; top:-15px; transform:translateX(-50%) rotate(calc(var(--rotation, 0deg) * -1)); font-size:10px; }
  .resize-handle { right:-10px; bottom:-10px; cursor:nwse-resize; }
  .canvas-mark { position:absolute; right:15px; bottom:12px; font-size:8px; letter-spacing:.18em; color:#8d8e86; }
  .arrange-screen > .secondary { justify-self:start; align-self:start; }
  .arrange-actions { align-self:start; display:flex; flex-direction:column; align-items:flex-start; gap:14px; }
  .materials { width:min(360px,100%); margin-top:8px; padding-top:18px; border-top:1px solid #c8c6bd; }.materials-heading { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }.materials-heading strong { font-size:13px; }.materials-heading span { color:#767a73; font-size:11px; }.material-strip { display:flex; gap:9px; overflow-x:auto; padding:2px 2px 10px; scrollbar-width:none; }.material-strip::-webkit-scrollbar { display:none; }.material-item { width:92px; flex:0 0 92px; position:relative; border:1px solid #d0cec5; background:#faf9f5; border-radius:10px; overflow:hidden; }.material-add { width:100%; min-height:105px; padding:8px; border:0; background:none; display:flex; flex-direction:column; gap:6px; text-align:left; cursor:pointer; }.material-add img { width:100%; height:62px; object-fit:contain; }.material-item.tape .material-add img { object-fit:cover; }.material-add span { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }.material-delete { position:absolute; right:4px; top:4px; width:28px; height:28px; padding:0; border:0; border-radius:50%; background:#fffdf1e8; color:#943f34; box-shadow:0 2px 7px #1b211c1c; cursor:pointer; }
  .layer-controls { display:flex; flex-wrap:wrap; gap:8px; }
  .layer-button { min-height:44px; padding:10px 14px; font-size:11px; }
  .layer-button:disabled { opacity:.35; cursor:not-allowed; }
  .remove-page-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; color:#943f34; border-color:#c6a49d; }
  .remove-page-button svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .remove-page-button:active { transform:scale(.97); }
  .canvas-mode header { mix-blend-mode:multiply; }
  .journal-save-error { grid-column:1; max-width:330px; margin:0; color:#943f34; font-size:12px; line-height:1.5; }

  @media (max-width: 760px) {
    header { height:calc(68px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) 22px 0; }
    .camera-screen { padding:calc(80px + env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom)); grid-template-rows:minmax(0,1fr) 60px; gap:14px; }
    .viewfinder { height:100%; min-height:0; }
    .camera-copy { top:95px; left:34px; }
    .camera-copy h2 { font-size:34px; }
    .arrange-screen { padding:82px 20px 28px; display:flex; flex-direction:column; align-items:stretch; gap:24px; }
    .arrange-heading { text-align:center; }
    .arrange-heading h2 { font-size:40px; margin:10px 0; }
    .arrange-heading p { margin:auto; }
    .collage-shell { width:100%; }
    .arrange-screen > .secondary { align-self:center; }
    .arrange-actions { align-self:center; align-items:center; }
    .collage { width:min(100%,540px); }
    .focus-screen { padding:calc(78px + env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom)); }
    .focus-screen .section-heading { margin-bottom:14px; }
    .focus-screen .section-heading h2 { font-size:31px; }
    .crop-wrap { height:clamp(240px,40svh,360px); min-height:0; gap:7px; }
    .selection-card,.selection-preview { min-height:0; }
    .crop-stage,.crop-stage img { max-height:clamp(240px,40svh,360px); }
    .selection-card-label { left:8px; top:8px; font-size:8px; }
    .selection-actions .secondary,.selection-actions .primary { min-width:0; padding-left:16px; padding-right:16px; }
    .segment-screen { min-height:540px; padding:calc(76px + env(safe-area-inset-top)) 14px max(16px, env(safe-area-inset-bottom)); }
    .segment-screen .section-heading { margin-bottom:12px; }
    .segment-screen .section-heading h2 { font-size:32px; }
    .segment-preview { grid-template-columns:minmax(0,1fr) minmax(0,1fr); height:min(370px,42svh); min-height:190px; gap:7px; margin-bottom:14px; }
    .comparison-card { min-height:0; }
    .comparison-card > span { left:8px; top:8px; font-size:8px; }
    .checkerboard { padding:5%; background-size:18px 18px; background-position:0 0,0 9px,9px -9px,-9px 0; }
    .selection-preview.checkerboard { padding:0; }
    .selection-preview.checkerboard > img { inset:5%; width:90%; height:90%; max-width:90%; max-height:90%; }
    .segment-actions .secondary,.segment-actions .primary { min-width:0; padding-left:18px; padding-right:18px; }
    .fragment-actions { flex-direction:column-reverse; width:min(300px,100%); }
    .fragment-actions button { width:100%; }
  }

  @media (prefers-reduced-motion: reduce) { * { transition:none!important; } }
</style>
