<script lang="ts">
  import { onMount } from 'svelte';

  type TouchStep = 'texture' | 'temperature' | 'intensity' | 'result';

  const textureOptions = ['Soft', 'Rough', 'Smooth', 'Bumpy', 'Fuzzy', 'Sticky', 'Firm', 'Slippery'];
  let step: TouchStep = $state('texture');
  let selectedTextures: string[] = $state(['Soft']);
  let customTexture = $state('');
  let temperature = $state(35);
  let intensity = $state(3);
  let textureUrl = $state('');

  onMount(() => {
    if (new URLSearchParams(window.location.search).get('flow') !== 'grounding') {
      window.location.replace('/');
    }
  });

  function toggleTexture(texture: string) {
    if (selectedTextures.includes(texture)) {
      selectedTextures = selectedTextures.filter((item) => item !== texture);
      return;
    }
    selectedTextures = [...selectedTextures.slice(-1), texture];
  }

  function addCustomTexture() {
    const texture = customTexture.trim();
    if (!texture) return;
    selectedTextures = [...selectedTextures.filter((item) => item !== texture).slice(-1), texture];
    customTexture = '';
  }

  function temperatureWord() {
    if (temperature < -35) return 'cold';
    if (temperature > 35) return 'warm';
    return 'neutral';
  }

  function intensityWord() {
    return ['almost invisible', 'very light', 'subtle', 'present', 'clearly tactile'][intensity - 1];
  }

  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeTexture() {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    if (!context) return '';

    const warmth = (temperature + 100) / 200;
    const strength = intensity / 5;
    const random = mulberry32(selectedTextures.join('').length * 97 + Math.round(temperature) * 13 + intensity);
    context.fillStyle = '#f2eee5';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const noiseAmount = 4 + strength * 18;
    for (let pixel = 0; pixel < image.data.length; pixel += 4) {
      const noise = (random() - 0.5) * noiseAmount;
      image.data[pixel] = Math.max(0, Math.min(255, image.data[pixel] + noise));
      image.data[pixel + 1] = Math.max(0, Math.min(255, image.data[pixel + 1] + noise));
      image.data[pixel + 2] = Math.max(0, Math.min(255, image.data[pixel + 2] + noise * 0.75));
    }
    context.putImageData(image, 0, 0);

    const active = selectedTextures.map((item) => item.toLowerCase());
    const count = Math.round((90 + intensity * 130) * (1.2 - warmth * 0.25));
    context.save();
    context.globalAlpha = 0.08 + strength * 0.2;

    if (active.some((item) => item.includes('soft') || item.includes('fuzzy'))) {
      context.filter = `blur(${2 + warmth * 7}px)`;
      context.strokeStyle = '#8e8779';
      context.lineWidth = 0.7 + warmth * 1.8;
      for (let index = 0; index < count; index += 1) {
        const x = random() * canvas.width;
        const y = random() * canvas.height;
        const length = 12 + random() * (24 + warmth * 48);
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo(x + length * 0.45, y + (random() - 0.5) * 18, x + length, y + (random() - 0.5) * 10);
        context.stroke();
      }
    }

    context.filter = 'none';
    if (active.some((item) => item.includes('rough') || item.includes('grain'))) {
      context.fillStyle = '#69675f';
      for (let index = 0; index < count * 3; index += 1) {
        const size = 0.5 + random() * (2.5 + (1 - warmth) * 2);
        context.fillRect(random() * canvas.width, random() * canvas.height, size, size * (0.4 + random()));
      }
    }

    if (active.some((item) => item.includes('bumpy') || item.includes('sticky'))) {
      context.fillStyle = '#aaa294';
      for (let index = 0; index < count * 0.55; index += 1) {
        const radius = 3 + random() * (8 + warmth * 11);
        context.beginPath();
        context.ellipse(random() * canvas.width, random() * canvas.height, radius, radius * (0.45 + random() * 0.8), random() * Math.PI, 0, Math.PI * 2);
        context.fill();
      }
    }

    if (active.some((item) => item.includes('firm') || item.includes('smooth') || item.includes('slippery'))) {
      context.strokeStyle = '#77776f';
      context.lineWidth = 0.5 + strength;
      const spacing = 18 + (1 - strength) * 34;
      for (let offset = -canvas.height; offset < canvas.width; offset += spacing) {
        context.beginPath();
        context.moveTo(offset, canvas.height);
        context.lineTo(offset + canvas.height, 0);
        context.stroke();
      }
    }

    context.restore();
    return canvas.toDataURL('image/png');
  }

  $effect(() => {
    selectedTextures;
    temperature;
    intensity;
    textureUrl = makeTexture();
  });

  function downloadTexture() {
    if (!textureUrl) return;
    const link = document.createElement('a');
    link.href = textureUrl;
    link.download = 'touch-journal-background.png';
    link.click();
  }

  function continueToSee() {
    try {
      sessionStorage.setItem('grounding-touch-background', textureUrl);
      sessionStorage.setItem('grounding-touch-summary', JSON.stringify({
        textures: selectedTextures,
        temperature,
        intensity
      }));
    } catch (error) {
      console.warn('Could not store the touch background.', error);
    }
    window.location.href = '/?start=see';
  }
</script>

<svelte:head>
  <title>TOUCH — A tactile grounding practice</title>
  <meta name="description" content="Translate a remembered touch into a tactile journal background." />
</svelte:head>

<main>
  <header>
    <a class="wordmark" href="/">GROUNDING<span>·</span></a>
    <span class="touch-mark">01 · TOUCH</span>
  </header>

  <section class="touch-layout">
    <div class="question-panel">
      <p class="eyebrow">A tactile grounding practice</p>

      {#if step === 'texture'}
        <span class="step-count">01 / 03</span>
        <h1>What did it<br />feel like?</h1>
        <p class="guidance">Choose one or two words that feel closest.</p>
        <div class="texture-grid">
          {#each textureOptions as texture}
            <button class:active={selectedTextures.includes(texture)} onclick={() => toggleTexture(texture)}>{texture}</button>
          {/each}
        </div>
        <form class="custom-texture" onsubmit={(event) => { event.preventDefault(); addCustomTexture(); }}>
          <input bind:value={customTexture} placeholder="Another word…" aria-label="Custom texture" />
          <button type="submit">Add</button>
        </form>
        {#if selectedTextures.some((item) => !textureOptions.includes(item))}
          <p class="custom-choice">Added: {selectedTextures.filter((item) => !textureOptions.includes(item)).join(', ')}</p>
        {/if}
        <button class="primary" disabled={!selectedTextures.length} onclick={() => step = 'temperature'}>Continue <span>→</span></button>

      {:else if step === 'temperature'}
        <span class="step-count">02 / 03</span>
        <h1>Was it warm<br />or cold?</h1>
        <p class="guidance">Let the texture change, rather than the color.</p>
        <div class="slider-wrap">
          <input type="range" min="-100" max="100" step="1" bind:value={temperature} aria-label="Temperature from cold to warm" />
          <div class="slider-labels"><span>Cold</span><span>Neutral</span><span>Warm</span></div>
        </div>
        <div class="actions"><button class="secondary" onclick={() => step = 'texture'}>Back</button><button class="primary" onclick={() => step = 'intensity'}>Continue <span>→</span></button></div>

      {:else if step === 'intensity'}
        <span class="step-count">03 / 03</span>
        <h1>How strong was<br />the sensation?</h1>
        <p class="guidance">Choose how present it felt.</p>
        <div class="intensity-scale">
          {#each [1, 2, 3, 4, 5] as level}
            <button class:active={intensity === level} onclick={() => intensity = level}><span>{level}</span><i style={`height:${16 + level * 13}px`}></i></button>
          {/each}
        </div>
        <p class="intensity-copy">{intensityWord()}</p>
        <div class="actions"><button class="secondary" onclick={() => step = 'temperature'}>Back</button><button class="primary" onclick={() => step = 'result'}>Translate it <span>→</span></button></div>

      {:else}
        <span class="step-count">Your translation</span>
        <h1>A surface from<br />what you felt.</h1>
        <dl class="summary">
          <div><dt>Texture</dt><dd>{selectedTextures.join(' + ')}</dd></div>
          <div><dt>Temperature</dt><dd>{temperatureWord()}</dd></div>
          <div><dt>Intensity</dt><dd>{intensity} / 5</dd></div>
        </dl>
        <p class="translation">{selectedTextures.join(' + ').toLowerCase()} + {temperatureWord()} + {intensityWord()}</p>
        <div class="actions"><button class="secondary" onclick={() => step = 'texture'}>Adjust</button><button class="primary" onclick={continueToSee}>Continue to SEE <span>→</span></button></div>
        <button class="download-link" onclick={downloadTexture}>Download this background</button>
      {/if}
    </div>

    <aside class="texture-panel">
      <span class="preview-label">Journal background</span>
      {#if textureUrl}
        <img src={textureUrl} alt="Generated tactile journal background" />
      {/if}
      <p>{selectedTextures.join(' + ')} · {temperatureWord()} · {intensity}/5</p>
    </aside>
  </section>
</main>

<style>
  :global(*) { box-sizing:border-box; }
  :global(html) { background:#f3f0e9; }
  :global(body) { margin:0; color:#1b211c; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  :global(button),:global(input) { font:inherit; color:inherit; }
  main { min-height:100svh; background:#f3f0e9; position:relative; overflow:hidden; }
  main::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.2; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E"); mix-blend-mode:multiply; }
  header { height:calc(78px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) clamp(22px,4vw,62px) 0; position:absolute; inset:0 0 auto; z-index:5; display:flex; align-items:center; justify-content:space-between; }
  .wordmark { color:inherit; text-decoration:none; font-family:Georgia,serif; font-size:22px; letter-spacing:.16em; }
  .wordmark span { color:#c54b34; }
  .touch-mark,.eyebrow,.step-count,.preview-label { text-transform:uppercase; font-size:10px; font-weight:650; letter-spacing:.2em; }
  .touch-mark { color:#777a72; }
  .touch-layout { min-height:100svh; display:grid; grid-template-columns:minmax(380px,.9fr) minmax(420px,1.1fr); gap:clamp(30px,5vw,80px); align-items:center; padding:105px clamp(24px,6vw,92px) 42px; position:relative; z-index:1; }
  .question-panel { max-width:560px; width:100%; justify-self:end; }
  .eyebrow { color:#7d8075; margin:0 0 34px; }
  .step-count { display:block; color:#c54b34; margin-bottom:16px; }
  h1 { font-family:Georgia,serif; font-weight:400; font-size:clamp(45px,5vw,72px); line-height:.98; letter-spacing:-.035em; margin:0 0 22px; }
  .guidance { color:#6d736d; line-height:1.5; margin:0 0 28px; }
  .texture-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:9px; margin-bottom:14px; }
  .texture-grid button { height:48px; border:1px solid #b7b5ad; border-radius:100px; background:rgba(255,255,255,.35); cursor:pointer; transition:.18s ease; }
  .texture-grid button.active { background:#1b211c; border-color:#1b211c; color:#fff; transform:translateY(-2px); }
  .custom-texture { display:flex; border-bottom:1px solid #aaa89f; margin:6px 0 30px; }
  .custom-texture input { flex:1; min-width:0; border:0; outline:0; background:transparent; padding:13px 2px; }
  .custom-texture button { border:0; background:transparent; cursor:pointer; padding:0 4px; color:#c54b34; }
  .custom-choice { color:#73776f; font-size:11px; margin:-20px 0 24px; }
  .primary,.secondary { border-radius:100px; cursor:pointer; height:52px; padding:0 24px; }
  .primary { border:0; min-width:170px; display:inline-flex; align-items:center; justify-content:space-between; gap:26px; background:#1b211c; color:#fff; }
  .primary:disabled { opacity:.35; cursor:not-allowed; }
  .secondary { border:1px solid #aaa89f; background:transparent; }
  .actions { display:flex; gap:10px; align-items:center; }
  .slider-wrap { margin:62px 0 55px; }
  .slider-wrap input { width:100%; accent-color:#1b211c; }
  .slider-labels { display:flex; justify-content:space-between; margin-top:13px; text-transform:uppercase; font-size:9px; letter-spacing:.15em; color:#777a72; }
  .intensity-scale { height:105px; display:flex; gap:10px; align-items:flex-end; margin:44px 0 12px; }
  .intensity-scale button { flex:1; height:100%; border:0; background:transparent; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; gap:9px; cursor:pointer; }
  .intensity-scale button span { font-family:Georgia,serif; font-size:20px; }
  .intensity-scale button i { width:100%; display:block; background:#cfcbc0; border-radius:3px 3px 0 0; transition:.2s ease; }
  .intensity-scale button.active i { background:#1b211c; }
  .intensity-copy { text-align:right; color:#777a72; font-size:12px; margin:0 0 32px; }
  .summary { margin:32px 0; border-top:1px solid #c5c2b8; }
  .summary div { display:flex; justify-content:space-between; gap:20px; padding:13px 0; border-bottom:1px solid #c5c2b8; }
  .summary dt { color:#777a72; }
  .summary dd { margin:0; text-transform:capitalize; text-align:right; }
  .translation { font-family:Georgia,serif; font-style:italic; font-size:19px; color:#646a63; margin:0 0 30px; }
  .download-link { margin-top:16px; padding:0; border:0; background:transparent; color:#666b65; cursor:pointer; font-size:11px; text-decoration:underline; text-underline-offset:4px; }
  .texture-panel { width:min(100%,560px); aspect-ratio:3/4; position:relative; justify-self:start; overflow:hidden; background:#ebe7dd; box-shadow:0 28px 70px rgba(38,42,36,.16); }
  .texture-panel img { width:100%; height:100%; object-fit:cover; display:block; }
  .texture-panel::after { content:""; position:absolute; inset:0; box-shadow:inset 0 0 90px rgba(92,82,64,.1); pointer-events:none; }
  .preview-label { position:absolute; z-index:2; left:18px; top:18px; padding:8px 11px; color:#fff; background:rgba(27,33,28,.7); border-radius:100px; }
  .texture-panel p { position:absolute; z-index:2; left:18px; bottom:16px; margin:0; padding:8px 11px; color:#fff; background:rgba(27,33,28,.7); border-radius:100px; text-transform:capitalize; font-size:10px; letter-spacing:.08em; }
  @media (max-width:800px) {
    main { overflow:auto; }
    .touch-layout { min-height:100svh; display:flex; flex-direction:column; padding:calc(88px + env(safe-area-inset-top)) 18px max(28px, env(safe-area-inset-bottom)); gap:28px; }
    .question-panel { max-width:560px; order:2; }
    .texture-panel { width:min(100%,360px); aspect-ratio:4/3; order:1; justify-self:center; }
    .eyebrow { display:none; }
    h1 { font-size:43px; }
    .texture-grid { grid-template-columns:repeat(2,1fr); }
  }
</style>
