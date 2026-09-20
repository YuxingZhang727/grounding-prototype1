<script lang="ts">
  import { onMount } from 'svelte';
  import { generateTouchTexture } from '$lib/touch-texture';
  import GroundingSteps from '$lib/GroundingSteps.svelte';

  type TouchStep = 'texture' | 'temperature' | 'result';

  const textureOptions = ['Soft', 'Rough', 'Smooth', 'Bumpy', 'Fuzzy', 'Sticky', 'Firm', 'Slippery'];
  let step: TouchStep = $state('texture');
  let selectedTextures: string[] = $state(['Soft']);
  let customTexture = $state('');
  let temperature = $state(35);
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

  $effect(() => {
    const textures = [...selectedTextures];
    const currentTemperature = temperature;
    const timer = window.setTimeout(() => {
      textureUrl = generateTouchTexture({
        textures,
        temperature: currentTemperature
      });
    }, 70);
    return () => window.clearTimeout(timer);
  });

  function downloadTexture() {
    if (!textureUrl) return;
    const link = document.createElement('a');
    link.href = textureUrl;
    link.download = 'touch-journal-background.jpg';
    link.click();
  }

  function continueToSee() {
    try {
      sessionStorage.setItem('grounding-touch-background', textureUrl);
      sessionStorage.setItem('grounding-touch-summary', JSON.stringify({
        textures: selectedTextures,
        temperature
      }));
    } catch (error) {
      console.warn('Could not store the touch background.', error);
    }
    window.location.href = '/?start=see';
  }

  function selectGroundingStage(next: 'touch' | 'see' | 'hear') {
    if (next === 'touch') return;
    try {
      sessionStorage.setItem('grounding-touch-background', textureUrl);
      sessionStorage.setItem('grounding-touch-summary', JSON.stringify({ textures:selectedTextures, temperature }));
    } catch (error) { console.warn('Could not store the touch background.', error); }
    window.location.href = next === 'see' ? '/?start=see' : '/?start=sound';
  }
</script>

<svelte:head>
  <title>TOUCH — A tactile grounding practice</title>
  <meta name="description" content="Translate a remembered touch into a tactile journal background." />
</svelte:head>

<GroundingSteps active="touch" onselect={selectGroundingStage} />
<main class:result={step === 'result'} style={`--touch-paper:${textureUrl ? `url(${textureUrl})` : 'none'}`}>
  <header>
    <a class="wordmark" href="/">GROUNDING<span>·</span></a>
    <span class="touch-mark">01 · TOUCH</span>
  </header>

  <section class="touch-layout">
    <div class="question-panel">
      <p class="eyebrow">A tactile grounding practice</p>

      {#if step === 'texture'}
        <span class="step-count">01 / 02</span>
        <h1>What did it<br />feel like?</h1>
        <p class="guidance">Choose one or two words that feel closest.</p>
        <div class="texture-grid">
          {#each textureOptions as texture}
            <button
              class:active={selectedTextures.includes(texture)}
              aria-pressed={selectedTextures.includes(texture)}
              onclick={() => toggleTexture(texture)}
            >{texture}</button>
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
        <span class="step-count">02 / 02</span>
        <h1>Was it warm<br />or cold?</h1>
        <p class="guidance">Let the texture change, rather than the color.</p>
        <div class="slider-wrap">
          <input type="range" min="-100" max="100" step="1" bind:value={temperature} aria-label="Temperature from cold to warm" />
          <div class="slider-labels"><span>Cold</span><span>Neutral</span><span>Warm</span></div>
        </div>
        <div class="actions"><button class="secondary" onclick={() => step = 'texture'}>Back</button><button class="primary" onclick={() => step = 'result'}>Translate it <span>→</span></button></div>

      {:else}
        <span class="step-count">Your translation</span>
        <h1>A surface from<br />what you felt.</h1>
        <dl class="summary">
          <div><dt>Texture</dt><dd>{selectedTextures.join(' + ')}</dd></div>
          <div><dt>Temperature</dt><dd>{temperatureWord()}</dd></div>
        </dl>
        <p class="translation">{selectedTextures.join(' + ').toLowerCase()} + {temperatureWord()}</p>
        <div class="actions"><button class="secondary" onclick={() => step = 'texture'}>Adjust</button><button class="primary" onclick={continueToSee}>Continue to SEE <span>→</span></button></div>
        <button class="download-link" onclick={downloadTexture}>Download this background</button>
      {/if}
    </div>

    <aside class="texture-panel" aria-label="Live journal page preview">
      <span class="binding-shadow"></span>
      <span class="preview-label">Journal page · live</span>
      {#if textureUrl}
        <img src={textureUrl} alt="Generated tactile journal background" />
      {/if}
      <span class="page-rule"></span>
      <span class="page-number">01</span>
      <p>{selectedTextures.join(' + ')} · {temperatureWord()}</p>
    </aside>
  </section>
</main>

<style>
  :global(*) { box-sizing:border-box; }
  :global(html) { background:#f3f0e9; }
  :global(body) { margin:0; color:#1b211c; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  :global(button),:global(input) { font:inherit; color:inherit; }
  :global(button:focus-visible),:global(input:focus-visible),:global(a:focus-visible) { outline:2px solid #c54b34; outline-offset:3px; }
  :global(button:active) { opacity:.76; }
  main { min-height:100svh; background:#f3f0e9; position:relative; overflow:hidden; isolation:isolate; }
  main::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.2; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.15'/%3E%3C/svg%3E"); mix-blend-mode:multiply; }
  main::after { content:""; position:fixed; inset:0; z-index:-1; pointer-events:none; background-image:var(--touch-paper); background-size:cover; background-position:center; opacity:.13; mix-blend-mode:multiply; transition:opacity .35s ease; }
  header { display:none; }
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
  .summary { margin:32px 0; border-top:1px solid #c5c2b8; }
  .summary div { display:flex; justify-content:space-between; gap:20px; padding:13px 0; border-bottom:1px solid #c5c2b8; }
  .summary dt { color:#777a72; }
  .summary dd { margin:0; text-transform:capitalize; text-align:right; }
  .translation { font-family:Georgia,serif; font-style:italic; font-size:19px; color:#646a63; margin:0 0 30px; }
  .download-link { margin-top:16px; padding:0; border:0; background:transparent; color:#666b65; cursor:pointer; font-size:11px; text-decoration:underline; text-underline-offset:4px; }
  .texture-panel { width:min(100%,560px); aspect-ratio:3/4; position:relative; justify-self:start; overflow:hidden; background:#ebe7dd; border:1px solid rgba(89,80,65,.16); box-shadow:4px 3px 0 rgba(255,255,255,.5),8px 8px 0 rgba(112,101,81,.07),0 30px 75px rgba(38,42,36,.18); transform:rotate(.35deg); }
  .texture-panel img { width:100%; height:100%; object-fit:cover; display:block; }
  .texture-panel::after { content:""; position:absolute; inset:0; box-shadow:inset 0 0 90px rgba(92,82,64,.1),inset 12px 0 22px rgba(72,61,45,.055); pointer-events:none; }
  .binding-shadow { position:absolute; z-index:2; inset:0 auto 0 0; width:14px; background:linear-gradient(90deg,rgba(73,61,43,.18),rgba(255,255,255,.08) 45%,transparent); opacity:.55; }
  .page-rule { position:absolute; z-index:2; left:11%; right:9%; top:12%; height:1px; background:rgba(76,73,65,.15); }
  .page-number { position:absolute; z-index:2; right:8%; top:7%; font-family:Georgia,serif; color:rgba(44,47,41,.42); font-size:13px; font-style:italic; }
  .preview-label { position:absolute; z-index:2; left:18px; top:18px; padding:8px 11px; color:#fff; background:rgba(27,33,28,.7); border-radius:100px; }
  .texture-panel p { position:absolute; z-index:2; left:18px; bottom:16px; margin:0; padding:8px 11px; color:#fff; background:rgba(27,33,28,.7); border-radius:100px; text-transform:capitalize; font-size:10px; letter-spacing:.08em; }
  @media (max-width:900px) {
    main { height:100dvh; overflow:hidden; }
    .touch-layout { height:100dvh; min-height:0; display:flex; flex-direction:column; gap:24px; align-items:stretch; overflow-y:auto; overscroll-behavior-y:contain; -webkit-overflow-scrolling:touch; padding:calc(88px + env(safe-area-inset-top)) 20px max(32px, calc(20px + env(safe-area-inset-bottom))); }
    .question-panel { max-width:560px; width:100%; margin:0 auto; flex:0 0 auto; }
    .texture-panel { display:block; order:-1; width:min(54vw,220px); max-width:100%; aspect-ratio:3/4; align-self:center; justify-self:auto; flex:0 0 auto; box-shadow:3px 3px 0 rgba(255,255,255,.5),6px 6px 0 rgba(112,101,81,.07),0 16px 38px rgba(38,42,36,.16); }
    .preview-label { left:10px; top:10px; padding:6px 8px; font-size:8px; }
    .texture-panel p { left:10px; right:10px; bottom:10px; max-width:calc(100% - 20px); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 8px; }
    .eyebrow { display:none; }
    h1 { font-size:clamp(38px,11vw,46px); }
    .texture-grid { grid-template-columns:repeat(2,1fr); }
    .slider-wrap { margin:48px 0 44px; }
  }
  @media (max-width:900px) and (orientation:landscape) {
    .touch-layout { display:grid; grid-template-columns:minmax(150px,32vw) minmax(0,1fr); gap:24px; align-items:start; padding-top:calc(76px + env(safe-area-inset-top)); }
    .texture-panel { order:0; grid-column:1; grid-row:1; width:min(100%,calc((100svh - 104px) * .75),210px); align-self:start; position:relative; top:auto; }
    .question-panel { grid-column:2; grid-row:1; }
  }
  @media (prefers-reduced-motion:reduce) {
    *,*::before,*::after { scroll-behavior:auto !important; transition-duration:.01ms !important; animation-duration:.01ms !important; }
  }
</style>
