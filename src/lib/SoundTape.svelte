<script lang="ts">
  import { onMount } from 'svelte';
  import { analyseSound, deleteRoll, loadRolls, saveRoll, tapeImage, type SoundFrame, type SoundRoll } from './sound-tape';
  export let onadd: (image: string, ratio: number) => void;
  export let onsaved: (roll: SoundRoll) => void = () => {};
  export let ondeleted: (id: string) => void = () => {};
  let state: 'idle' | 'requesting' | 'recording' | 'saving' = 'idle';
  let frames: SoundFrame[] = [];
  let rolls: SoundRoll[] = [];
  let selected: SoundRoll | null = null;
  let draft: SoundRoll | null = null;
  let pending: SoundRoll | null = null;
  let error = '';
  let elapsed = 0;
  let length = 65;
  let name = '';
  let audioUrl = '';
  let media: MediaStream | null = null;
  let context: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setInterval>;
  let disposed = false;
  let requestId = 0;
  let held = false;
  let liveTrace: number[] = [];
  let recordingTrace: number[] = [];
  let tearDrag: { y: number } | null = null;
  let tearProgress = 0;
  let tearing = false;
  let previewReady = false;
  let audioElement: HTMLAudioElement;
  let playing = false;
  let playbackTime = 0;
  $: shown = selected?.frames ?? frames;
  $: previewWidth = state === 'recording' ? Math.min(560, Math.max(120, 120 + elapsed * 110)) : selected ? 120 + length * 4.4 : 240;
  $: preview = tapeImage(shown, previewWidth, state === 'recording');
  $: livePath = waveformPath(liveTrace, previewWidth, true);
  $: playbackSamples = selected?.trace?.length ? selected.trace : legacyTrace(selected?.frames ?? []);
  $: playbackPath = waveformPath(playbackSamples, 460, false);
  $: playbackProgress = selected?.duration ? Math.min(100, playbackTime / selected.duration * 100) : 0;
  $: quiet = state === 'recording' && elapsed > 2 && frames.slice(-10).every(f => f.level < .25);

  function waveformPath(samples: number[], width: number, live: boolean) {
    if (samples.length < 2) return `M 0 44 L ${width} 44`;
    const pointCount = Math.max(28, Math.min(live ? 72 : 110, Math.floor(width / 5)));
    const source = live ? samples : Array.from({ length:Math.min(pointCount, samples.length) }, (_, index) => {
      const start = Math.floor(index / Math.min(pointCount, samples.length) * samples.length);
      const end = Math.max(start + 1, Math.floor((index + 1) / Math.min(pointCount, samples.length) * samples.length));
      let strongest = samples[start] ?? 0;
      for (let sampleIndex=start+1; sampleIndex<end; sampleIndex++) {
        if (Math.abs(samples[sampleIndex]) > Math.abs(strongest)) strongest = samples[sampleIndex];
      }
      return strongest;
    });
    const visible = live ? [...source].reverse() : source;
    const peak = Math.max(.0001, ...visible.map(sample => Math.abs(sample)));
    const visualStrength = Math.min(1, Math.sqrt(peak * (live ? 8 : 5)));
    const amplitude = 8 + visualStrength * (live ? 30 : 23);
    const points = visible.map((sample, index) => {
      const x = index / Math.max(1, visible.length - 1) * width;
      const y = 44 + (sample / peak) * amplitude;
      return { x, y };
    });
    let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index-1];
      const current = points[index];
      const midX = (previous.x + current.x) / 2;
      const midY = (previous.y + current.y) / 2;
      path += ` Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
    }
    const last = points[points.length-1];
    return `${path} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  }

  function traceSamples(wave: Uint8Array, points: number) {
    const peaks = Array.from({ length:points }, (_, point) => {
      const start = Math.floor(point / points * wave.length);
      const end = Math.max(start + 1, Math.floor((point + 1) / points * wave.length));
      let strongest = 0;
      for (let index = start; index < end; index++) {
        const sample = (wave[index] - 128) / 128;
        if (Math.abs(sample) > Math.abs(strongest)) strongest = sample;
      }
      return strongest;
    });
    return peaks.map((sample, index) => {
      const previous = peaks[index - 1] ?? sample;
      const next = peaks[index + 1] ?? sample;
      return previous * .2 + sample * .6 + next * .2;
    });
  }

  function easeFrame(next: SoundFrame, previous?: SoundFrame): SoundFrame {
    if (!previous) return next;
    return {
      level: previous.level * .42 + next.level * .58,
      brightness: previous.brightness * .5 + next.brightness * .5,
      richness: previous.richness * .5 + next.richness * .5
    };
  }

  function legacyTrace(oldFrames: SoundFrame[]) {
    return oldFrames.flatMap((frame, index) => [
      Math.sin(index * 1.7) * frame.level * .7,
      Math.sin(index * 1.7 + 1.1) * frame.level * .7
    ]);
  }

  function releaseResources() {
    clearInterval(timer);
    media?.getTracks().forEach(t => t.stop()); media = null;
    void context?.close().catch(() => {}); context = null;
  }
  function choose(roll: SoundRoll) {
    audioElement?.pause(); playing = false; playbackTime = 0;
    draft = null; previewReady = false; tearProgress = 0; tearing = false;
    selected = roll; frames = roll.frames; elapsed = roll.duration; name = roll.name;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(roll.audio);
  }
  async function persist(roll: SoundRoll) {
    const keepPreview = previewReady;
    state = 'saving';
    try {
      await saveRoll(roll);
      if (disposed) return;
      pending = null; rolls = [roll, ...rolls.filter(r => r.id !== roll.id)]; choose(roll); previewReady = keepPreview; onsaved(roll);
    } catch { pending = roll; error = 'This recording is still here, but could not be saved on this device. Try saving again.'; }
    finally { if (!disposed) state = 'idle'; }
  }
  async function start(isHold = false) {
    if (state !== 'idle' || pending) return;
    error = '';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      error = 'Microphone recording is unavailable here. Open this page in Safari or Chrome over HTTPS, or in the iPhone app.'; return;
    }
    const id = ++requestId;
    state = 'requesting';
    try {
      context = new AudioContext();
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (disposed || id !== requestId || (isHold && !held)) { stream.getTracks().forEach(t => t.stop()); releaseResources(); if (!disposed) state = 'idle'; return; }
      media = stream;
      const analyser = context!.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = .35;
      context!.createMediaStreamSource(stream).connect(analyser);
      const wave = new Uint8Array(analyser.fftSize), spectrum = new Uint8Array(analyser.frequencyBinCount);
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder = current;
      const chunks: Blob[] = [];
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        if (disposed) return;
        const audio = new Blob(chunks, { type: current.mimeType || chunks[0]?.type });
        if (!audio.size) { error = 'The recording was interrupted before audio was captured. Please try again.'; state = 'idle'; return; }
        const roll: SoundRoll = { id: crypto.randomUUID(), name: name.trim() || `Listening ${rolls.length + 1}`, created: Date.now(), duration: elapsed, frames: [...frames], trace: [...recordingTrace], audio };
        choose(roll); draft = roll; state = 'idle';
      };
      current.onerror = () => { error = 'Recording was interrupted. Any captured audio will be kept.'; stop(); };
      frames = []; liveTrace = []; recordingTrace = []; selected = null; draft = null; previewReady = false; elapsed = 0; name = '';
      if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = '';
      const started = performance.now();
      current.start(250); state = 'recording';
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(wave); analyser.getByteFrequencyData(spectrum);
        const nextFrame = easeFrame(analyseSound(wave, spectrum), frames.at(-1));
        const nextTrace = traceSamples(wave, 72);
        frames = [...frames, nextFrame];
        liveTrace = nextTrace.map((sample, index) => {
          const previous = liveTrace[index] ?? sample;
          return previous * .56 + sample * .44;
        });
        recordingTrace = [...recordingTrace, ...traceSamples(wave, 6)].slice(-1800);
        elapsed = (performance.now() - started) / 1000;
        if (elapsed >= 30) stop();
      }, 66);
      stream.getAudioTracks().forEach(track => { track.onended = stop; });
    } catch (cause) {
      releaseResources(); if (disposed) return;
      state = 'idle';
      error = cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. Enable microphone access in your browser or app settings, then try again.'
        : 'The microphone could not start. Close other recording apps and try again.';
    }
  }
  function stop() {
    held = false;
    if (state === 'requesting') { ++requestId; return; }
    if (state !== 'recording') return;
    state = 'saving';
    if (recorder?.state !== 'inactive') recorder?.stop();
    releaseResources();
  }
  function holdStart(event: PointerEvent) {
    if (event.button !== 0 || state !== 'idle' || pending) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    held = true; void start(true);
  }
  function addToCollage() {
    if (!selected || pending) return;
    const portion = selected.frames.slice(0, Math.max(1, Math.ceil(selected.frames.length * length / 100)));
    const width = 120 + length * 4.4;
    onadd(tapeImage(portion, width), width / 88);
  }
  function saveCurrent() {
    if (!selected || rolls.some(roll => roll.id === selected?.id)) return;
    const roll = { ...(draft ?? selected), name:name.trim() || selected.name };
    void persist(roll);
  }
  async function removeRoll(roll: SoundRoll) {
    try {
      await deleteRoll(roll.id);
      rolls = rolls.filter(item => item.id !== roll.id);
      ondeleted(roll.id);
      if (selected?.id === roll.id) {
        audioElement?.pause();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = ''; selected = null; draft = null; frames = []; elapsed = 0;
        previewReady = false; playbackTime = 0; playing = false;
      }
    } catch { error = 'This tape could not be deleted. Please try again.'; }
  }
  function openPreview() {
    tearing = false; tearProgress = 0; previewReady = true;
  }
  function tearStart(event: PointerEvent) {
    if (!selected || pending || tearing) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    tearDrag = { y:event.clientY }; tearProgress = 0;
  }
  function tearMove(event: PointerEvent) {
    if (!tearDrag) return;
    tearProgress = Math.max(0, Math.min(110, event.clientY-tearDrag.y));
  }
  function tearEnd() {
    if (!tearDrag) return;
    tearDrag = null;
    if (tearProgress >= 68) {
      tearing = true; tearProgress = 110;
      if (navigator.vibrate) navigator.vibrate(18);
      window.setTimeout(openPreview, 220);
    } else tearProgress = 0;
  }
  function togglePlayback() {
    if (!audioElement) return;
    if (audioElement.paused) void audioElement.play();
    else audioElement.pause();
  }
  function seekPlayback(event: MouseEvent) {
    if (!audioElement || !selected) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX-box.left)/box.width));
    audioElement.currentTime = ratio * selected.duration;
    playbackTime = audioElement.currentTime;
  }
  onMount(() => {
    loadRolls().then(saved => { if (!disposed) rolls = saved; }).catch(() => { error = 'Saved tapes could not be loaded. Device storage may be unavailable.'; });
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stop);
    return () => {
      disposed = true; ++requestId;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseResources(); audioElement?.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', stop);
    };
  });
</script>

<section class="sound" class:preview-mode={previewReady}>
  <div class="intro"><p class="eyebrow">A moment of listening</p><h2>What can you hear?</h2><p>Let a little of your surroundings become a piece of tape.</p></div>
  <div class="workbench" class:recording={state === 'recording'}>
    <div class="machine" class:recording={state === 'recording'}>
      <div class="shell-highlight" aria-hidden="true"></div>
      <div class="roll"><div class="core"><span></span></div></div>
      <div class="machine-detail" aria-hidden="true"><i></i><i></i><i></i></div>
      <span class="machine-label">SOUND / TAPE</span>
      <div class="slot" aria-hidden="true"><span></span></div>
      <div class="feet" aria-hidden="true"><i></i><i></i></div>
    </div>
    <div class="feed">
      <div class="feed-visual" class:tear-ready={!!selected && state === 'idle' && !previewReady} class:previewed={previewReady} class:tearing style={`width:${previewWidth}px;--tear-angle:${(tearProgress*.065).toFixed(2)}deg;--tear-drop:${(tearProgress*.08).toFixed(2)}px`}>
        <img src={preview} alt="A dotted sound tape: quiet moments gather near the middle and stronger sounds spread the dots wider" />
        {#if state === 'recording'}
          <svg class="live-wave" viewBox={`0 0 ${previewWidth} 88`} preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2={previewWidth} y1="44" y2="44"></line>
            <path class="wave-halo" d={livePath}></path>
            <path class="wave-main" d={livePath}></path>
          </svg>
        {/if}
        {#if selected && state === 'idle' && !previewReady}
          <button class="tear-grip" aria-label="Drag down to tear and preview this tape" onpointerdown={tearStart} onpointermove={tearMove} onpointerup={tearEnd} onpointercancel={tearEnd} onlostpointercapture={tearEnd} onclick={event => { if (event.detail === 0) { tearProgress = 110; tearing = true; window.setTimeout(openPreview,220); } }}><span>↓</span></button>
        {/if}
      </div>
      <span class="edge-label">{state === 'recording' ? 'your sound, moving now' : selected ? previewReady ? 'tape ready' : tearProgress >= 68 ? 'release to tear' : 'drag down to preview' : 'waiting for a sound'}</span>
    </div>
  </div>
  <p class="status" aria-live="polite">{state === 'requesting' ? 'Allow microphone access to begin.' : state === 'saving' ? 'Keeping this moment…' : quiet ? 'Quiet sounds stay close to the middle.' : state === 'recording' ? 'Stronger sounds open the pattern wider.' : selected ? previewReady ? 'Listen once more, then choose where it belongs.' : 'Pull the tape down when the length feels right.' : 'Quiet gathers. Sound opens the dots.'}</p>
  <div class="controls">
    <button class="primary hold" disabled={state === 'saving' || !!pending} onpointerdown={holdStart} onpointerup={() => { if (held) stop(); }} onpointercancel={() => { if (held) stop(); }} onlostpointercapture={() => { if (held) stop(); }} onclick={event => { if (state === 'recording' && !held) stop(); else if (event.detail === 0) void start(); }}>{state === 'recording' ? 'Stop listening' : state === 'requesting' ? 'Opening microphone…' : 'Hold to listen'} <span aria-hidden="true">●</span></button>
    <span class="time">{elapsed.toFixed(1)} / 30s</span>
  </div>
  {#if state === 'idle' && !pending}<button class="text-button hands-free" onclick={() => start()}>Or tap to start hands-free</button>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if pending}<button onclick={() => { error = ''; if (pending) void persist(pending); }} disabled={state !== 'idle'}>Try saving again</button>{/if}
  {#if selected && state === 'idle' && !previewReady}
    <div class="length-before-tear">
      <label for="tape-length">Pull out your tape <span>{length}% of this moment</span></label>
      <input id="tape-length" type="range" min="15" max="100" step="1" bind:value={length} />
    </div>
  {/if}
  {#if selected && state === 'idle' && previewReady}
    <div class="saved">
      <p class="eyebrow">Tape preview</p>
      <h3>Keep this listening?</h3>
      <label for="sound-name">What did you notice?</label><input id="sound-name" bind:value={name} maxlength="60" placeholder="A passing car, the air, a voice…" />
      <audio class="source-audio" bind:this={audioElement} src={audioUrl} onplay={() => playing=true} onpause={() => playing=false} onended={() => { playing=false; playbackTime=0; }} ontimeupdate={() => playbackTime=audioElement.currentTime} aria-label="Recorded sound"></audio>
      <div class="tape-player">
        <button class="play-toggle" onclick={togglePlayback} aria-label={playing ? 'Pause recorded sound' : 'Play recorded sound'}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span></button>
        <button class="player-strip" onclick={seekPlayback} aria-label={`Sound playback position ${Math.round(playbackProgress)} percent`}>
          <img src={tapeImage(selected.frames,460)} alt="" />
          <svg viewBox="0 0 460 88" preserveAspectRatio="none" aria-hidden="true">
            <path class="wave-ghost" d={playbackPath}></path>
            <path class="wave-progress" d={playbackPath} pathLength="100" stroke-dasharray={`${playbackProgress} 100`}></path>
            <line class="playhead" x1={playbackProgress*4.6} x2={playbackProgress*4.6} y1="7" y2="81"></line>
          </svg>
        </button>
        <span class="player-time">{playbackTime.toFixed(1)} / {selected.duration.toFixed(1)}s</span>
      </div>
      <p class="preview-length">This piece keeps {length}% of the recording.</p>
      <div class="preview-actions">
        <button class="secondary" onclick={saveCurrent} disabled={rolls.some(roll => roll.id === selected?.id)}>{rolls.some(roll => roll.id === selected?.id) ? 'Saved to your library' : 'Save this tape'}</button>
        <button class="primary" onclick={addToCollage}>Add to today’s collage <span aria-hidden="true">→</span></button>
      </div>
      {#if rolls.some(roll => roll.id === selected?.id)}<button class="delete-current" onclick={() => selected && removeRoll(selected)}>Delete this tape</button>{/if}
    </div>
  {/if}
  {#if rolls.length}<div class="library"><p class="eyebrow">Your listening shelf · {rolls.length}</p><div class="shelf">{#each rolls as roll}<div class="shelf-item" class:selected={selected?.id === roll.id}><button class="shelf-select" disabled={state !== 'idle' || !!pending} onclick={() => choose(roll)}><img src={tapeImage(roll.frames, 150)} alt="" /><span>{roll.name}</span><small>{roll.duration.toFixed(1)}s</small></button><button class="shelf-delete" onclick={() => removeRoll(roll)} aria-label={`Delete ${roll.name}`}>×</button></div>{/each}</div></div>{/if}
</section>

<style>
  .sound { --ink:#1b211c; --paper:#f3f0e9; --muted:#60675e; --accent:#c54b34; max-width:1000px; margin:auto; padding:calc(104px + env(safe-area-inset-top)) 24px max(48px,env(safe-area-inset-bottom)); text-align:center; color:var(--ink); }
  .sound.preview-mode { max-width:620px; }.preview-mode>.intro,.preview-mode>.workbench,.preview-mode>.status,.preview-mode>.controls,.preview-mode>.hands-free { display:none; }
  .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted); } h2 { font:400 clamp(36px,5vw,60px)/1.08 Georgia,serif; letter-spacing:-.025em; margin:20px 0; } .intro>p:last-child { color:var(--muted); line-height:1.6; }
  .workbench { display:flex; align-items:center; justify-content:center; max-width:760px; height:285px; margin:20px auto 0; padding:0 16px; overflow:hidden; }
  .machine { width:175px; height:190px; flex-shrink:0; position:relative; border-radius:88px 88px 22px 22px; background:linear-gradient(145deg,#c7c9b8 0 44%,#adb2a0 100%); border:1px solid #8f9785; box-shadow:inset 0 1px 0 #eef0e180,inset 0 -12px 22px #737c6a15,0 18px 28px #1b211c1d; z-index:2; }
  .shell-highlight { position:absolute; inset:7px 8px 32px; border-radius:76px 76px 13px 13px; border:1px solid #eef0e14f; pointer-events:none; }
  .roll { position:relative; width:120px; height:120px; margin:16px auto 0; border-radius:50%; border:1px solid #77816f; background:repeating-radial-gradient(circle,#d9ddca 0 4px,#b8c0a9 5px 6px,#d4d9c5 7px 9px); display:grid; place-items:center; box-shadow:inset 0 2px 7px #5d67582b,0 1px 0 #fff8; }
  .core { width:48px; height:48px; border:8px solid #e6dfcf; border-radius:50%; background:#f6f1e7; box-shadow:inset 0 0 0 1px #b9b09f,0 3px 6px #1b211c24; display:grid; place-items:center; }.core span { width:8px; height:8px; border-radius:50%; background:#9ba28f; box-shadow:inset 0 1px 2px #59615266; }
  .machine-detail { position:absolute; left:18px; bottom:27px; display:flex; gap:4px; }.machine-detail i { display:block; width:4px; height:4px; border-radius:50%; background:#6f776a; opacity:.7; }.machine-label { position:absolute; left:50%; bottom:22px; transform:translateX(-50%); white-space:nowrap; font-size:8px; font-weight:650; letter-spacing:.2em; }
  .slot { position:absolute; right:-7px; top:60px; height:101px; width:13px; border-radius:5px; background:linear-gradient(90deg,#50594d,#737c6c 68%,#424940); box-shadow:1px 2px 4px #1b211c33; }.slot span { position:absolute; right:-3px; top:7px; bottom:7px; width:4px; border-radius:2px; background:#313831; }
  .feet { position:absolute; left:17px; right:17px; bottom:-6px; display:flex; justify-content:space-between; }.feet i { width:26px; height:7px; border-radius:0 0 5px 5px; background:#596152; box-shadow:0 3px 5px #1b211c24; }
  .feed { flex:1; max-width:560px; min-width:0; text-align:left; position:relative; padding-top:35px; }.feed-visual { height:88px; position:relative; max-width:none; transform-origin:0 50%; filter:drop-shadow(0 8px 7px #1b211c12); transition:transform .26s cubic-bezier(.2,.75,.3,1),opacity .18s; }.feed-visual.tear-ready { transform:translateY(var(--tear-drop)) rotate(var(--tear-angle)); }.feed-visual.previewed { opacity:0; pointer-events:none; }.feed-visual.tearing { animation:torn-away .24s ease-in forwards; }.feed img { width:100%; height:88px; display:block; max-width:none; transition:opacity .12s ease; }.live-wave { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }.live-wave line { stroke:#596152; stroke-width:.7; stroke-dasharray:2 5; opacity:.3; }.live-wave path { fill:none; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }.live-wave .wave-halo { stroke:#fff8ec; stroke-width:7; opacity:.82; }.live-wave .wave-main { stroke:#9f392f; stroke-width:3.4; filter:drop-shadow(0 1px 1px #7b302544); }.workbench.recording .feed img { opacity:.82; }.tear-grip { position:absolute; z-index:3; left:min(110px,calc(100% - 38px)); bottom:-21px; width:38px; height:42px; min-height:42px; padding:0; border:0; border-radius:0 0 18px 18px; background:#f7f1e7e8; box-shadow:0 4px 8px #1b211c1c; touch-action:none; display:grid; place-items:center; color:#7b3f35; }.tear-grip::before { content:""; position:absolute; left:4px; right:4px; top:0; border-top:1px dashed #7b3f3577; }.tear-grip span { transform:translateY(2px); font-size:16px; }.edge-label { position:absolute; left:18px; bottom:-39px; white-space:nowrap; font:italic 14px Georgia,serif; color:var(--muted); }
  @keyframes torn-away { to { transform:translate(22px,46px) rotate(10deg); opacity:0; } }
  .recording .roll { animation:turn 10s linear infinite; } @keyframes turn { to { transform:rotate(360deg); } }
  .status { min-height:25px; color:var(--muted); font:italic 17px Georgia,serif; }.controls { display:flex; justify-content:center; align-items:center; gap:24px; }.time { font-variant-numeric:tabular-nums; font-size:12px; color:var(--muted); }
  button,input { font:inherit; } button { cursor:pointer; color:inherit; border:1px solid #909789; background:transparent; border-radius:28px; min-height:48px; padding:12px 22px; } button:disabled { opacity:.45; cursor:default; } button:active:not(:disabled) { opacity:.7; } button:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:4px; }
  .primary { background:var(--ink); color:white; border:0; display:inline-flex; align-items:center; justify-content:center; gap:28px; min-height:56px; }.secondary { background:#fffdf9; border-color:#8f9689; }.hold,.tear-grip { touch-action:none; user-select:none; -webkit-user-select:none; }.text-button,.delete-current { border:0; text-decoration:underline; text-underline-offset:5px; font-size:13px; }.delete-current { color:#8d4035; align-self:center; min-height:44px; }.error { max-width:480px; margin:16px auto; color:#943521; line-height:1.6; }
  .length-before-tear { width:min(500px,100%); margin:2px auto 22px; display:grid; gap:7px; }.saved { max-width:500px; margin:8px auto 32px; padding-top:28px; border-top:1px solid #c8c9bc; display:flex; flex-direction:column; align-items:stretch; gap:12px; }.saved>.eyebrow { margin:0; }.saved h3 { margin:0 0 12px; font:400 30px/1.2 Georgia,serif; text-align:left; } label { text-align:left; font-size:13px; } label span { float:right; color:var(--muted); font-size:11px; } input:not([type=range]) { background:#faf9f5; border:1px solid #9b9c93; padding:14px; border-radius:4px; min-width:0; }.source-audio { display:none; } input[type=range] { width:100%; min-height:44px; accent-color:var(--ink); }.preview-length { margin:0; color:var(--muted); font-size:12px; text-align:left; }.preview-actions { display:grid; grid-template-columns:1fr 1.2fr; gap:10px; margin-top:7px; }.preview-actions button { padding-inline:15px; }
  .tape-player { display:grid; grid-template-columns:48px minmax(0,1fr); gap:8px 10px; align-items:center; margin:12px 0 18px; }.play-toggle { width:48px; min-height:48px; padding:0; display:grid; place-items:center; border-color:#7d8478; background:#fffdf9; }.play-toggle span { font-size:14px; transform:translateX(1px); }.player-strip { position:relative; height:64px; min-height:64px; padding:0; border:0; border-radius:3px; overflow:hidden; text-align:left; }.player-strip img,.player-strip svg { position:absolute; inset:0; width:100%; height:100%; }.player-strip img { object-fit:fill; opacity:.7; }.player-strip svg path { fill:none; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }.wave-ghost { stroke:#813f36; stroke-width:1.6; opacity:.28; }.wave-progress { stroke:#a33f35; stroke-width:3; filter:drop-shadow(0 1px 1px #fff8ec); }.playhead { stroke:#fffdf9; stroke-width:2; opacity:.95; vector-effect:non-scaling-stroke; }.player-time { grid-column:2; color:var(--muted); font-size:11px; text-align:right; margin-top:-4px; font-variant-numeric:tabular-nums; }
  .library { margin:40px auto 0; border-top:1px solid #c8c9bc; padding-top:20px; }.shelf { display:flex; flex-wrap:wrap; justify-content:center; gap:12px; }.shelf-item { width:150px; position:relative; border:1px solid transparent; border-radius:4px; }.shelf-item.selected { border-color:var(--muted); }.shelf-select { width:100%; border:0; border-radius:4px; padding:10px; text-align:left; }.shelf-delete { position:absolute; right:4px; top:4px; width:32px; height:32px; min-height:32px; padding:0; border:0; background:#fffdf9e8; color:#8d4035; box-shadow:0 2px 7px #1b211c17; }.shelf img { width:100%; height:38px; object-fit:cover; }.shelf span { display:block; font:16px Georgia,serif; margin-top:10px; overflow-wrap:anywhere; }.shelf small { color:var(--muted); }
  @media(max-width:520px) { .sound { padding-inline:20px; }.workbench { height:235px; padding:0; }.machine { width:130px; height:161px; border-radius:66px 66px 17px 17px; }.shell-highlight { inset:5px 6px 27px; border-radius:60px 60px 10px 10px; }.roll { width:95px; height:95px; margin:12px auto 0; }.core { width:34px; height:34px; border-width:6px; }.core span { width:6px; height:6px; }.machine-detail { left:13px; bottom:22px; }.machine-label { bottom:17px; font-size:7px; }.slot { top:45px; height:91px; }.feet { left:13px; right:13px; }.feet i { width:20px; }.feed { padding-top:29px; }.controls { gap:14px; }.time { font-size:11px; }.preview-actions { grid-template-columns:1fr; } }
  @media(prefers-reduced-motion:reduce) { .recording .roll { animation:none; }.feed img,.feed-visual { transition:none; }.feed-visual.tearing { animation:none; opacity:0; } }
</style>
