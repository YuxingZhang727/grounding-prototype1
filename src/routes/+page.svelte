<script lang="ts">
  import { onDestroy, tick } from 'svelte';

  type Step = 'welcome' | 'camera' | 'crop' | 'segment' | 'fragment' | 'arrange' | 'finish';
  type Fragment = {
    image:string; aspectRatio:number;
    x:number; y:number; size:number; rotation:number;
  };
  type Gesture = {
    mode:'drag'|'resize'|'rotate'; index:number; startX:number; startY:number;
    original:Fragment; stage:DOMRect; centerX:number; centerY:number;
  };
  type SelectionPoint = { x:number; y:number };
  type SelectionBox = { x:number; y:number; w:number; h:number };

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
  let selectionPoints: SelectionPoint[] = [];
  let selectionBox: SelectionBox | null = null;
  let draftBox: SelectionBox | null = null;
  let selectionStart: SelectionPoint | null = null;
  let isSegmenting = false;
  let segmentationRequest = 0;
  let segmentationQueued = false;

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

  function stopCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function takePhoto() {
    if (!video?.videoWidth || !cameraReady) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);
    capturedImage = canvas.toDataURL('image/jpeg', 0.9);
    clearSegmentation();
    resetSelection();
    stopCamera();
    step = 'crop';
  }

  function choosePhoto(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      capturedImage = String(reader.result);
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
  }

  function resetSelection() {
    selectionPoints = [];
    selectionBox = null;
    draftBox = null;
    selectionStart = null;
    isSegmenting = false;
    segmentationQueued = false;
    segmentationRequest += 1;
  }

  function selectionPosition(event: PointerEvent): SelectionPoint {
    const box = cropStage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100))
    };
  }

  function selectionPointerDown(event: PointerEvent) {
    selectionStart = selectionPosition(event);
    draftBox = null;
    cropStage.setPointerCapture(event.pointerId);
  }

  function selectionPointerMove(event: PointerEvent) {
    if (!selectionStart) return;
    const current = selectionPosition(event);
    if (Math.hypot(current.x - selectionStart.x, current.y - selectionStart.y) < 1.5) return;
    draftBox = {
      x: Math.min(selectionStart.x, current.x),
      y: Math.min(selectionStart.y, current.y),
      w: Math.abs(current.x - selectionStart.x),
      h: Math.abs(current.y - selectionStart.y)
    };
  }

  function selectionPointerUp(event: PointerEvent) {
    if (!selectionStart) return;
    const current = selectionPosition(event);
    const distance = Math.hypot(current.x - selectionStart.x, current.y - selectionStart.y);
    if (distance < 1.5) {
      selectionBox = null;
      selectionPoints = [...selectionPoints, current];
    } else if (draftBox && draftBox.w > 1 && draftBox.h > 1) {
      selectionPoints = [];
      selectionBox = draftBox;
    }
    selectionStart = null;
    draftBox = null;
    runSegmentation();
  }

  async function runSegmentation() {
    if (!selectionPoints.length && !selectionBox) return;
    if (isSegmenting) {
      segmentationQueued = true;
      segmentationRequest += 1;
      segmentedImage = '';
      segmentedOverlay = '';
      segmentStatus = 'Updating the cutout…';
      return;
    }
    const request = ++segmentationRequest;
    isSegmenting = true;
    segmentError = '';
    segmentedImage = '';
    segmentedOverlay = '';
    transformedImage = '';
    transformStatus = '';
    segmentStatus = 'Preparing the photo…';
    try {
      const { segmentWithPrompts } = await import('$lib/segmenter');
      const result = await segmentWithPrompts(capturedImage, selectionPoints, selectionBox, (message) => segmentStatus = message);
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
    fragments = [...fragments, {
      image: sourceImage,
      aspectRatio: segmentedAspectRatio,
      ...placementFor(index)
    }];
    step = 'fragment';
  }

  function chooseAgain() {
    clearSegmentation();
    resetSelection();
    step = 'crop';
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
    activeFragment = 0;
    step = 'arrange';
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

  async function stylizeWithAI(sourceUrl: string) {
    const response = await fetch('/api/stylize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: sourceUrl })
    });

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
      transformedImage = await stylizeWithAI(segmentedImage);
      transformStatus = 'Rubber-stamp collage piece ready.';
    } catch (error) {
      console.error(error);
      transformedImage = await stylizeLocally(segmentedImage);
      const fallbackMessage = error instanceof Error ? error.message : 'Could not use AI conversion.';
      transformStatus = `${fallbackMessage} Using local style rendering.`;
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

  function restart() {
    stopCamera();
    fragments = [];
    capturedImage = '';
    clearSegmentation();
    activeFragment = -1;
    step = 'welcome';
  }

  onDestroy(stopCamera);
</script>

<svelte:head>
  <title>SEE — A noticing practice</title>
  <meta name="description" content="Notice things around you and arrange them into a small abstract collage." />
</svelte:head>

<main class:dark={step === 'camera'} class:canvas-mode={step === 'arrange' || step === 'finish'}>
  <header>
    <button class="wordmark" onclick={restart} aria-label="Return to start">SEE<span>·</span></button>
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
      <p class="eyebrow">A quiet looking practice</p>
      <h1>SEE</h1>
      <div class="intro">
        <p>Take a moment to look around you.</p>
        <p>Notice the things that draw your attention.</p>
      </div>
      <button class="primary" onclick={begin}>Start looking <span>↗</span></button>
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
        <label class="text-button">Choose photo<input type="file" accept="image/*" capture="environment" onchange={choosePhoto} /></label>
        <button class="shutter" class:disabled={!cameraReady} onclick={takePhoto} disabled={!cameraReady} aria-label="Take photo" type="button">
          <span></span>
        </button>
        <span class="action-spacer"></span>
      </div>
    </section>

  {:else if step === 'crop'}
    <section class="focus-screen">
      <div class="section-heading">
        <span class="count-label">Thing {fragments.length + 1}</span>
        <h2>What caught your attention?</h2>
        <p>Tap to add details. Drag a frame for a larger object.</p>
      </div>
      <div class="crop-wrap">
        <div class="selection-card">
          <span class="selection-card-label">Your photo</span>
          <div
            class="crop-stage"
            bind:this={cropStage}
            onpointerdown={selectionPointerDown}
            onpointermove={selectionPointerMove}
            onpointerup={selectionPointerUp}
            role="application"
            aria-label="Tap one or more parts of an object, or drag a frame around it"
          >
            <img src={capturedImage} alt="Your captured view" draggable="false" />
            {#each selectionPoints as point}
              <span class="selection-point" style={`left:${point.x}%;top:${point.y}%`}></span>
            {/each}
            {#if draftBox || selectionBox}
              {@const box = draftBox || selectionBox}
              <span class="selection-frame" style={`left:${box?.x}%;top:${box?.y}%;width:${box?.w}%;height:${box?.h}%`}></span>
            {/if}
          </div>
        </div>
        <div class="selection-card preview-card">
          <span class="selection-card-label">Cutout preview</span>
          <div class="selection-preview checkerboard" class:loading={isSegmenting}>
            {#if segmentedImage}
              <img src={segmentedImage} alt="Preview of the currently selected object" />
            {:else}
              <p>{segmentError || (isSegmenting ? segmentStatus : 'Your selected object will appear here.')}</p>
            {/if}
            {#if isSegmenting && segmentedImage}
              <span class="preview-updating">Updating…</span>
            {/if}
          </div>
        </div>
      </div>
      <div class="selection-actions">
        <button class="secondary" onclick={clearSelectionPrompts} disabled={!selectionPoints.length && !selectionBox}>Reset selection</button>
        <button class="primary compact" onclick={() => step = 'segment'} disabled={!segmentedImage || isSegmenting}>Use this cutout <span>→</span></button>
      </div>
      <p class="selection-help">{selectionPoints.length} {selectionPoints.length === 1 ? 'point' : 'points'} added{selectionBox ? ' · frame added' : ''}</p>
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
            <span>In the scene</span>
            <img src={segmentedOverlay} alt="The selected object highlighted in the original scene" />
          </div>
          <div class="comparison-card stylized">
            <span>{transformedImage ? 'Collage piece' : 'Cutout'}</span>
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
          <button class="primary compact" onclick={transformCutout} disabled={isTransforming}>Make collage piece <span>→</span></button>
        {:else if transformedImage}
          <button class="secondary compact" onclick={keepCutout}>Use transformed piece <span>→</span></button>
          <button class="primary compact" onclick={transformCutout} disabled={isTransforming}>Try again <span>↻</span></button>
        {/if}
      </div>
      {#if segmentedImage}
        <p class="local-note">
          {segmentScore
            ? `Mask score ${Math.round(Math.max(0, Math.min(1, segmentScore)) * 100)}%.`
            : 'Mask score unavailable.'}
          {transformStatus || 'Ready to make one rubber-stamp collage piece.'}
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

  {:else if step === 'arrange' || step === 'finish'}
    <section class="arrange-screen">
      <div class="arrange-heading">
        {#if step === 'arrange'}
          <span class="count-label">{fragments.length} {fragments.length === 1 ? 'thing' : 'things'}, gathered</span>
          <h2>Arrange what you noticed.</h2>
          <p>Drag the pieces. Use the handles to resize and rotate.</p>
        {:else}
          <span class="count-label">Your collage</span>
          <h2>This is what you noticed,<br />here and now.</h2>
          <p>Made from the things you noticed around you.</p>
        {/if}
      </div>
      <div class="collage-shell">
        <div class="collage" class:editing={step === 'arrange'} bind:this={collageStage}>
          {#each fragments as fragment, index}
            <div
              class="collage-item"
              class:active={activeFragment === index && step === 'arrange'}
              style={`left:${fragment.x}%;top:${fragment.y}%;width:${fragment.size}%;aspect-ratio:${fragment.aspectRatio};transform:rotate(${fragment.rotation}deg);z-index:${activeFragment === index ? 10 : index + 1}`}
              onpointerdown={(event) => step === 'arrange' && fragmentPointerDown(event, index, 'drag')}
              onpointermove={fragmentPointerMove}
              onpointerup={fragmentPointerUp}
              role="button"
              tabindex={step === 'arrange' ? 0 : -1}
              aria-label={`Fragment ${index + 1}`}
              onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') activeFragment = index; }}
            >
              <img src={fragment.image} alt="" draggable="false" />
              {#if step === 'arrange' && activeFragment === index}
                <button class="rotate-handle" aria-label="Rotate fragment" onpointerdown={(event) => fragmentPointerDown(event, index, 'rotate')}>↻</button>
                <button class="resize-handle" aria-label="Resize fragment" onpointerdown={(event) => fragmentPointerDown(event, index, 'resize')}></button>
              {/if}
            </div>
          {/each}
          <span class="canvas-mark">SEE / {String(fragments.length).padStart(2, '0')}</span>
        </div>
      </div>
      {#if step === 'arrange'}
        <button class="primary compact" onclick={() => { activeFragment = -1; step = 'finish'; }}>Done <span>✓</span></button>
      {:else}
        <button class="secondary" onclick={restart}>Start again</button>
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
  main::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.22; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E"); mix-blend-mode:multiply; }
  main.dark { --ink:#f3f0e9; --paper:#17201b; }
  header { height:84px; padding:0 clamp(24px,5vw,72px); display:flex; align-items:center; justify-content:space-between; position:absolute; top:0; left:0; right:0; z-index:30; }
  .wordmark { border:0; background:none; padding:0; font-family:Georgia,serif; font-size:22px; letter-spacing:.16em; cursor:pointer; }
  .wordmark span { color:#c54b34; }
  .progress { display:flex; align-items:center; gap:6px; }
  .progress .gathered-count { margin-right:4px; text-transform:uppercase; font-size:9px; font-weight:650; letter-spacing:.15em; opacity:.7; }
  .progress i { display:block; width:7px; height:7px; border-radius:50%; background:#c54b34; }
  section { position:relative; z-index:1; min-height:100svh; }
  .welcome { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:110px 24px 60px; }
  .eyebrow,.count-label { text-transform:uppercase; font-size:11px; font-weight:650; letter-spacing:.2em; }
  .eyebrow { color:#7d8075; margin:0 0 24px; }
  h1 { font-family:Georgia,serif; font-weight:400; letter-spacing:.2em; font-size:clamp(82px,15vw,160px); line-height:.8; margin:0 0 54px; transform:translateX(.1em); }
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
  .text-button { justify-self:start; cursor:pointer; font-size:13px; text-decoration:underline; text-underline-offset:5px; }
  .text-button input { display:none; }
  .shutter { justify-self:center; width:60px; height:60px; padding:5px; border-radius:50%; border:1px solid #fff; background:none; cursor:pointer; }
  .shutter span { display:block; width:100%; height:100%; border-radius:50%; background:#f3f0e9; }

  .focus-screen { padding:104px 24px 36px; display:flex; flex-direction:column; align-items:center; }
  .section-heading { text-align:center; margin-bottom:26px; }
  .section-heading h2 { font-size:clamp(32px,4vw,48px); margin:11px 0 6px; }
  .section-heading p,.arrange-heading p { color:#6d736d; margin:0; }
  .crop-wrap { width:min(1000px,100%); flex:1; min-height:300px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:stretch; margin-bottom:18px; overflow:hidden; }
  .selection-card { min-width:0; min-height:280px; position:relative; display:grid; place-items:center; background:#e8e5dc; overflow:hidden; }
  .selection-card-label { position:absolute; z-index:5; left:14px; top:13px; padding:7px 10px; background:rgba(20,25,21,.72); color:#fff; border-radius:100px; font-size:10px; letter-spacing:.12em; text-transform:uppercase; backdrop-filter:blur(8px); }
  .crop-stage { position:relative; display:inline-block; max-width:100%; max-height:56svh; cursor:crosshair; touch-action:none; user-select:none; overflow:hidden; box-shadow:0 18px 55px rgba(36,40,34,.12); }
  .crop-stage img { display:block; max-width:100%; max-height:56svh; pointer-events:none; }
  .selection-point { position:absolute; width:18px; height:18px; border:3px solid #fff; border-radius:50%; background:#c54b34; box-shadow:0 2px 10px rgba(20,25,21,.35); transform:translate(-50%,-50%); pointer-events:none; }
  .selection-frame { position:absolute; border:2px solid #fff; background:rgba(197,75,52,.14); box-shadow:0 0 0 1px rgba(197,75,52,.8); pointer-events:none; }
  .selection-preview { position:relative; width:100%; height:100%; min-height:280px; }
  .selection-preview > img { width:100%; height:100%; object-fit:contain; }
  .selection-preview > p { margin:0; max-width:240px; padding:24px; text-align:center; color:#777a72; line-height:1.45; }
  .selection-preview.loading > img { opacity:.55; }
  .preview-updating { position:absolute; left:50%; bottom:18px; transform:translateX(-50%); padding:7px 11px; border-radius:100px; background:rgba(20,25,21,.76); color:#fff; font-size:10px; letter-spacing:.1em; text-transform:uppercase; }
  .selection-actions { display:flex; align-items:center; justify-content:center; gap:12px; }
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
  .collage { width:min(100%,680px); aspect-ratio:1; background:#faf9f5; box-shadow:0 22px 70px rgba(34,39,34,.13); position:relative; overflow:hidden; touch-action:none; }
  .collage-item { position:absolute; cursor:grab; touch-action:none; transition:filter .15s; display:grid; place-items:center; }
  .collage-item > img { width:100%; height:100%; object-fit:contain; pointer-events:none; user-select:none; filter:drop-shadow(0 8px 7px rgba(25,30,25,.14)); }
  .collage-item.active { outline:1px dashed #202720; outline-offset:7px; filter:saturate(1.08); }
  .rotate-handle,.resize-handle { position:absolute; z-index:20; width:24px; height:24px; background:#1b211c; color:#fff; border:2px solid #faf9f5; border-radius:50%; display:grid; place-items:center; cursor:crosshair; }
  .rotate-handle { left:50%; top:-22px; transform:translateX(-50%) rotate(calc(var(--rotation, 0deg) * -1)); font-size:12px; }
  .resize-handle { right:-14px; bottom:-14px; cursor:nwse-resize; }
  .canvas-mark { position:absolute; right:15px; bottom:12px; font-size:8px; letter-spacing:.18em; color:#8d8e86; }
  .arrange-screen > .primary,.arrange-screen > .secondary { justify-self:start; align-self:start; }
  .canvas-mode header { mix-blend-mode:multiply; }

  @media (max-width: 760px) {
    header { height:68px; padding:0 22px; }
    .camera-screen { padding:80px 14px 18px; grid-template-rows:minmax(0,1fr) 60px; gap:14px; }
    .viewfinder { height:100%; min-height:0; }
    .camera-copy { top:95px; left:34px; }
    .camera-copy h2 { font-size:34px; }
    .arrange-screen { padding:82px 20px 28px; display:flex; flex-direction:column; align-items:stretch; gap:24px; }
    .arrange-heading { text-align:center; }
    .arrange-heading h2 { font-size:40px; margin:10px 0; }
    .arrange-heading p { margin:auto; }
    .collage-shell { width:100%; }
    .arrange-screen > .primary,.arrange-screen > .secondary { align-self:center; }
    .collage { width:min(100%,540px); }
    .focus-screen { padding:78px 14px 18px; }
    .focus-screen .section-heading { margin-bottom:14px; }
    .focus-screen .section-heading h2 { font-size:31px; }
    .crop-wrap { gap:7px; min-height:240px; }
    .selection-card,.selection-preview { min-height:240px; }
    .selection-card-label { left:8px; top:8px; font-size:8px; }
    .selection-actions .secondary,.selection-actions .primary { min-width:0; padding-left:16px; padding-right:16px; }
    .segment-screen { min-height:540px; padding:76px 14px 16px; }
    .segment-screen .section-heading { margin-bottom:12px; }
    .segment-screen .section-heading h2 { font-size:32px; }
    .segment-preview { grid-template-columns:minmax(0,1fr) minmax(0,1fr); height:min(370px,42svh); min-height:190px; gap:7px; margin-bottom:14px; }
    .comparison-card { min-height:0; }
    .comparison-card > span { left:8px; top:8px; font-size:8px; }
    .checkerboard { padding:5%; background-size:18px 18px; background-position:0 0,0 9px,9px -9px,-9px 0; }
    .segment-actions .secondary,.segment-actions .primary { min-width:0; padding-left:18px; padding-right:18px; }
    .fragment-actions { flex-direction:column-reverse; width:min(300px,100%); }
    .fragment-actions button { width:100%; }
  }

  @media (prefers-reduced-motion: reduce) { * { transition:none!important; } }
</style>
