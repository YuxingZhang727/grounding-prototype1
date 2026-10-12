<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    getLatestWatchSignal,
    getWatchAvailability,
    isWatchSignalNative,
    onWatchSignal,
    startWatchMeasurement,
    stopWatchMeasurement,
    type WatchSignalSnapshot
  } from '$lib/watch-signal';

  export let mode: 'breathing' | 'mindfulness' | 'grounding';

  const configs = {
    breathing: {
      eyebrow: '1–5 minute reset',
      title: 'Breathe with the shape.',
      intro: 'A gentle 4–4–6 rhythm can give your attention one simple place to rest.',
      accent: '#c8dde8',
      dark: '#365f73'
    },
    mindfulness: {
      eyebrow: '3–5 minute practice',
      title: 'Notice this moment.',
      intro: 'Turn inward to notice thoughts and feelings without trying to solve or change them.',
      accent: '#ddd6ee',
      dark: '#62527a'
    },
    grounding: {
      eyebrow: '5–4–3–2–1 practice',
      title: 'Come back to your senses.',
      intro: 'Move through what you can see, feel, hear, smell, and taste—one sense at a time.',
      accent: '#cfdfc0',
      dark: '#4e6c45'
    }
  } as const;

  const mindfulnessPrompts = [
    { label:'Settle', title:'Let one breath happen by itself.', hint:'There is no rhythm to follow and nothing to improve. Simply notice a natural breath begin and end.', cue:'I am here' },
    { label:'Observe', title:'Watch a thought pass through.', hint:'You do not need to finish it, challenge it, or make it disappear. Notice that thinking is happening.', cue:'Thinking' },
    { label:'Name', title:'Give the feeling a quiet name.', hint:'Choose a simple word—uneasy, tired, calm, uncertain. A name is enough; no explanation is needed.', cue:'This is here' },
    { label:'Allow', title:'Make room without fixing it.', hint:'For this moment, let the thought or feeling exist without pushing it away or following it further.', cue:'It can be here' },
    { label:'Return', title:'Come back to one natural breath.', hint:'Attention wandered and returned. That return—not perfect stillness—is the practice.', cue:'Coming back' }
  ];

  const groundingSteps = [
    { count:5, sense:'see', title:'Look around slowly.', hint:'Name five things you can see.' },
    { count:4, sense:'feel', title:'Notice points of contact.', hint:'Name four things you can feel.' },
    { count:3, sense:'hear', title:'Let sounds find you.', hint:'Name three things you can hear.' },
    { count:2, sense:'smell', title:'Notice the air around you.', hint:'Name two things you can smell—or remember.' },
    { count:1, sense:'taste', title:'Notice one taste.', hint:'Name one thing you can taste—or would like to taste.' }
  ];

  type Screen = 'intro' | 'preparing' | 'practice' | 'recovery' | 'complete';
  let screen: Screen = 'intro';
  let isRunning = false;
  let breathPhase = 0;
  let breathSeconds = 4;
  let breathCycles = 0;
  let mindfulnessStep = 0;
  let groundingStep = 0;
  let note = '';
  let groundingAnswers: string[][] = groundingSteps.map(() => []);
  let timer: ReturnType<typeof setInterval> | undefined;
  let watchListener: { remove: () => Promise<void> } | null = null;
  let watchSnapshot: WatchSignalSnapshot = { available:false };
  let measurementStage: 'idle' | 'pre' | 'recovery' | 'done' | 'unavailable' = 'idle';
  let measurementMessage = '';
  let preSamples: number[] = [];
  let postSamples: number[] = [];
  let lastMeasurementTimestamp = '';
  let preRating = 5;
  let postRating = 5;
  let measurementResult: { preBPM:number | null; postBPM:number | null; bpmChange:number | null; feelingChange:number } | null = null;

  $: config = configs[mode];
  $: breathInstruction = ['Breathe in', 'Hold gently', 'Breathe out'][breathPhase];
  $: breathDuration = [4, 4, 6][breathPhase];
  $: progress = mode === 'breathing'
    ? Math.min(100, breathCycles / 6 * 100)
    : mode === 'mindfulness'
      ? (mindfulnessStep + 1) / mindfulnessPrompts.length * 100
      : (groundingStep + 1) / groundingSteps.length * 100;
  $: preBPM = median(preSamples) ?? watchSnapshot.baselineBPM ?? null;
  $: postBPM = median(postSamples);

  function median(values: number[]) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.floor(ordered.length / 2)];
  }

  function acceptMeasurement(snapshot: WatchSignalSnapshot) {
    watchSnapshot = { ...watchSnapshot, ...snapshot, bpm:snapshot.bpm ?? snapshot.heartRateBPM ?? watchSnapshot.bpm };
    const bpm = Number(snapshot.bpm ?? snapshot.heartRateBPM ?? snapshot.bpmText);
    if (!snapshot.isRunning || !Number.isFinite(bpm) || snapshot.timestamp === lastMeasurementTimestamp) return;
    lastMeasurementTimestamp = snapshot.timestamp ?? `${Date.now()}`;
    if (measurementStage === 'pre') preSamples = [...preSamples.slice(-9), bpm];
    if (measurementStage === 'recovery') postSamples = [...postSamples.slice(-9), bpm];
  }

  async function prepareMeasurement() {
    if (!isWatchSignalNative()) {
      measurementStage = 'unavailable';
      beginPractice();
      return;
    }
    screen = 'preparing';
    measurementStage = 'pre';
    measurementMessage = 'Opening Grounding on your Apple Watch…';
    preSamples = [];
    postSamples = [];
    lastMeasurementTimestamp = '';
    try {
      const availability = await getWatchAvailability();
      if (!availability.paired || !availability.watchAppInstalled) {
        measurementStage = 'unavailable';
        measurementMessage = availability.paired ? 'Install the Grounding Watch app to add a before-and-after measurement.' : 'A paired Apple Watch was not found.';
        return;
      }
      watchListener ??= await onWatchSignal(acceptMeasurement);
      const latest = await getLatestWatchSignal();
      if (latest.isRunning) acceptMeasurement(latest);
      if (!latest.isRunning) await startWatchMeasurement();
      measurementMessage = 'Keep your wrist relaxed while the Watch collects a short baseline.';
    } catch (error) {
      measurementStage = 'unavailable';
      measurementMessage = error instanceof Error ? error.message : 'The Watch measurement could not start.';
    }
  }

  function beginPractice() {
    screen = 'practice';
    if (mode === 'breathing') startBreathing();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.practice-card h1')?.focus());
  }

  function startBreathing() {
    if (timer) clearInterval(timer);
    isRunning = true;
    timer = setInterval(() => {
      if (breathSeconds > 1) {
        breathSeconds -= 1;
        return;
      }
      if (breathPhase === 2) {
        breathCycles += 1;
        navigator.vibrate?.(8);
        if (breathCycles >= 5) {
          finish();
          return;
        }
      }
      breathPhase = (breathPhase + 1) % 3;
      breathSeconds = [4, 4, 6][breathPhase];
    }, 1000);
  }

  function toggleBreathing() {
    if (isRunning) {
      isRunning = false;
      if (timer) clearInterval(timer);
      timer = undefined;
    } else startBreathing();
  }

  function resetBreathing() {
    if (timer) clearInterval(timer);
    breathPhase = 0;
    breathSeconds = 4;
    breathCycles = 0;
    startBreathing();
  }

  function nextMindfulness() {
    if (mindfulnessStep === mindfulnessPrompts.length - 1) finish();
    else mindfulnessStep += 1;
  }

  function addGroundingAnswer() {
    const answer = note.trim();
    if (!answer) return;
    groundingAnswers[groundingStep] = [...groundingAnswers[groundingStep], answer];
    groundingAnswers = [...groundingAnswers];
    note = '';
    navigator.vibrate?.(8);
  }

  function removeGroundingAnswer(index: number) {
    groundingAnswers[groundingStep] = groundingAnswers[groundingStep].filter((_, itemIndex) => itemIndex !== index);
    groundingAnswers = [...groundingAnswers];
  }

  function nextGrounding() {
    if (groundingStep === groundingSteps.length - 1) finish();
    else groundingStep += 1;
  }

  function finish() {
    if (timer) clearInterval(timer);
    timer = undefined;
    isRunning = false;
    if (measurementStage === 'pre' && watchSnapshot.isRunning) {
      measurementStage = 'recovery';
      postSamples = [];
      lastMeasurementTimestamp = '';
    }
    screen = 'recovery';
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.recovery h1')?.focus());
  }

  async function completeSession() {
    const before = preBPM;
    const after = postBPM;
    measurementResult = {
      preBPM:before,
      postBPM:after,
      bpmChange:before !== null && after !== null ? after - before : null,
      feelingChange:postRating - preRating
    };
    if (measurementStage === 'recovery') await stopWatchMeasurement().catch(() => false);
    measurementStage = 'done';
    screen = 'complete';
    navigator.vibrate?.(16);
    try {
      const sessions = JSON.parse(localStorage.getItem('grounding.guidedSessions') || '[]');
      sessions.unshift({ mode, completedAt:Date.now(), preRating, postRating, ...measurementResult });
      localStorage.setItem('grounding.guidedSessions', JSON.stringify(sessions.slice(0, 30)));
    } catch { /* Completion should never depend on storage. */ }
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.completion h1')?.focus());
  }

  function restart() {
    if (timer) clearInterval(timer);
    screen = 'intro';
    breathPhase = 0;
    breathSeconds = 4;
    breathCycles = 0;
    mindfulnessStep = 0;
    groundingStep = 0;
    groundingAnswers = groundingSteps.map(() => []);
    note = '';
    measurementStage = 'idle';
    measurementMessage = '';
    watchSnapshot = { available:false };
    preSamples = [];
    postSamples = [];
    preRating = 5;
    postRating = 5;
    measurementResult = null;
  }

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (measurementStage === 'pre' || measurementStage === 'recovery') void stopWatchMeasurement();
    void watchListener?.remove();
  });
</script>

<svelte:head>
  <title>{mode === 'breathing' ? 'Breathing' : mode === 'mindfulness' ? 'Mindfulness' : '5–4–3–2–1 Grounding'} — Grounding</title>
  <meta name="description" content={config.intro} />
</svelte:head>

<main style={`--accent:${config.accent};--accent-dark:${config.dark}`}>
  <header class="topbar">
    <a class="back" href="/app?tab=exercises" aria-label="Back to exercises">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
    </a>
    <a class="wordmark" href="/app?tab=home">GROUNDING<span>·</span></a>
    <span class="method-name">{mode === 'grounding' ? '5–4–3–2–1' : mode}</span>
  </header>

  {#if screen === 'intro'}
    <section class="intro" aria-labelledby="intro-heading">
      <div class="intro-copy">
        <p class="eyebrow">{config.eyebrow}</p>
        <h1 id="intro-heading">{config.title}</h1>
        <p class="lede">{config.intro}</p>
        <div class="intro-meta">
          <span><b aria-hidden="true">○</b> No score</span>
          <span><b aria-hidden="true">◷</b> Stop anytime</span>
        </div>
        <label class="feeling-scale" for="before-feeling">
          <span><strong>How activated do you feel?</strong><b>{preRating}/10</b></span>
          <input id="before-feeling" type="range" min="0" max="10" step="1" bind:value={preRating} />
          <small><span>Settled</span><span>Very activated</span></small>
        </label>
        <button class="primary" onclick={prepareMeasurement}>Begin with Watch measurement <span aria-hidden="true">→</span></button>
      </div>

      <div class:breath-visual={mode === 'breathing'} class:mindful-visual={mode === 'mindfulness'} class:senses-visual={mode === 'grounding'} class="hero-visual" aria-hidden="true">
        {#if mode === 'breathing'}
          <i></i><i></i><i></i>
        {:else if mode === 'mindfulness'}
          <i></i><i></i><span></span>
        {:else}
          {#each [5,4,3,2,1] as count}<i>{count}</i>{/each}
        {/if}
      </div>
    </section>

  {:else if screen === 'preparing'}
    <section class="measurement-stage" aria-labelledby="measurement-heading">
      <div class="watch-pulse" class:connected={watchSnapshot.isRunning} aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="4"/><path d="M9 1h6M9 23h6"/><path d="M9 12h2l1-3 2 6 1-3h1"/></svg>
      </div>
      <p class="eyebrow">Before the practice</p>
      <h1 id="measurement-heading" tabindex="-1">Let’s capture your starting point.</h1>
      <p>{measurementMessage}</p>
      {#if measurementStage === 'pre'}
        <div class="measurement-reading" aria-live="polite">
          <span>Live heart rate</span>
          <strong>{typeof watchSnapshot.bpm === 'number' ? Math.round(watchSnapshot.bpm) : '—'} <small>BPM</small></strong>
          <div><i style={`width:${Math.min(100, preSamples.length / 5 * 100)}%`}></i></div>
          <small>{preSamples.length >= 5 ? 'Starting point ready' : `${Math.min(preSamples.length, 5)} of 5 readings`}</small>
        </div>
        <button class="primary" disabled={preSamples.length < 3 && typeof watchSnapshot.baselineBPM !== 'number'} onclick={beginPractice}>Start the practice <span aria-hidden="true">→</span></button>
      {/if}
      <button class="text-action" onclick={beginPractice}>{measurementStage === 'unavailable' ? 'Continue without Watch' : 'Skip measurement'}</button>
    </section>

  {:else if screen === 'practice'}
    <section class="practice-shell">
      <div class="progress-header">
        <span>{mode === 'breathing' ? `Round ${Math.min(breathCycles + 1, 6)} of 6` : mode === 'mindfulness' ? `Step ${mindfulnessStep + 1} of ${mindfulnessPrompts.length}` : `${groundingSteps[groundingStep].count} things to ${groundingSteps[groundingStep].sense}`}</span>
        <button onclick={finish}>End early</button>
      </div>
      <div class="progress-track" aria-hidden="true"><i style={`width:${progress}%`}></i></div>

      {#if mode === 'breathing'}
        <article class="practice-card breathing-card">
          <div class="breath-orbit" class:paused={!isRunning} data-phase={breathPhase}>
            <div><span>{breathInstruction}</span><strong>{breathSeconds}</strong></div>
          </div>
          <h1 tabindex="-1">{breathInstruction}</h1>
          <p>{breathPhase === 0 ? 'Let the breath arrive without pulling.' : breathPhase === 1 ? 'Stay soft in your face and shoulders.' : 'Make a little more room as you let go.'}</p>
          <div class="breath-dots" aria-label={`${breathCycles} of 6 rounds complete`}>
            {#each Array(6) as _, index}<i class:complete={index < breathCycles}></i>{/each}
          </div>
          <div class="actions">
            <button class="secondary" onclick={resetBreathing}>Restart</button>
            <button class="primary" onclick={toggleBreathing}>{isRunning ? 'Pause' : 'Continue'}</button>
          </div>
        </article>

      {:else if mode === 'mindfulness'}
        <article class="practice-card prompt-card">
          <div class="prompt-number" aria-hidden="true">0{mindfulnessStep + 1}</div>
          <p class="eyebrow">{mindfulnessPrompts[mindfulnessStep].label}</p>
          <h1 tabindex="-1">{mindfulnessPrompts[mindfulnessStep].title}</h1>
          <p>{mindfulnessPrompts[mindfulnessStep].hint}</p>
          <div class="mindful-anchor" aria-hidden="true">
            <i></i><i></i><i></i>
            <span>{mindfulnessPrompts[mindfulnessStep].cue}</span>
          </div>
          <p class="practice-note">Nothing to record. Stay for a few breaths, then continue when you are ready.</p>
          <div class="actions split">
            <button class="secondary" disabled={mindfulnessStep === 0} onclick={() => mindfulnessStep -= 1}>Back</button>
            <button class="primary" onclick={nextMindfulness}>{mindfulnessStep === mindfulnessPrompts.length - 1 ? 'Complete' : 'Next prompt'} <span aria-hidden="true">→</span></button>
          </div>
        </article>

      {:else}
        <article class="practice-card senses-card">
          <div class="sense-count" aria-hidden="true">{groundingSteps[groundingStep].count}</div>
          <p class="eyebrow">Things you can {groundingSteps[groundingStep].sense}</p>
          <h1 tabindex="-1">{groundingSteps[groundingStep].title}</h1>
          <p>{groundingSteps[groundingStep].hint}</p>
          <form onsubmit={(event) => { event.preventDefault(); addGroundingAnswer(); }}>
            <input bind:value={note} aria-label={`Add something you can ${groundingSteps[groundingStep].sense}`} placeholder={`I ${groundingSteps[groundingStep].sense}…`} />
            <button type="submit" disabled={!note.trim()}>Add</button>
          </form>
          <div class="answer-list" aria-live="polite">
            {#each groundingAnswers[groundingStep] as answer, index}
              <button onclick={() => removeGroundingAnswer(index)} aria-label={`Remove ${answer}`}>{answer}<span aria-hidden="true">×</span></button>
            {/each}
          </div>
          <div class="actions split">
            <button class="secondary" disabled={groundingStep === 0} onclick={() => groundingStep -= 1}>Back</button>
            <button class="primary" onclick={nextGrounding}>{groundingStep === groundingSteps.length - 1 ? 'Complete' : 'Next sense'} <span aria-hidden="true">→</span></button>
          </div>
        </article>
      {/if}
    </section>

  {:else if screen === 'recovery'}
    <section class="measurement-stage recovery" aria-labelledby="recovery-heading">
      <div class="watch-pulse connected" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="4"/><path d="M9 1h6M9 23h6"/><path d="M9 12h2l1-3 2 6 1-3h1"/></svg>
      </div>
      <p class="eyebrow">After the practice</p>
      <h1 id="recovery-heading" tabindex="-1">Notice what changed.</h1>
      <p>{measurementStage === 'recovery' ? 'Stay still for a few moments while your Watch captures a recovery reading.' : 'Add one more check-in so you can compare how the practice felt.'}</p>
      <div class="comparison-preview">
        <div><span>Before</span><strong>{preBPM === null ? '—' : Math.round(preBPM)} <small>BPM</small></strong></div>
        <div><span>After</span><strong>{postBPM === null ? '—' : Math.round(postBPM)} <small>BPM</small></strong></div>
      </div>
      <label class="feeling-scale recovery-scale" for="after-feeling">
        <span><strong>How activated do you feel now?</strong><b>{postRating}/10</b></span>
        <input id="after-feeling" type="range" min="0" max="10" step="1" bind:value={postRating} />
        <small><span>Settled</span><span>Very activated</span></small>
      </label>
      <button class="primary" onclick={completeSession}>{postSamples.length >= 3 ? 'See comparison' : 'Finish when ready'} <span aria-hidden="true">→</span></button>
      <small class="reading-count" aria-live="polite">{Math.min(postSamples.length, 5)} of 5 recovery readings</small>
    </section>

  {:else}
    <section class="completion">
      <div class="completion-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="m11 21 6 6 13-15"/></svg></div>
      <p class="eyebrow">Practice complete</p>
      <h1 tabindex="-1">You made a little room.</h1>
      <p>Notice what feels the same and what feels even slightly different. Both answers are okay.</p>
      {#if measurementResult}
        <div class="result-card">
          <div><span>Body signal</span><strong>{measurementResult.bpmChange === null ? 'Not measured' : `${measurementResult.bpmChange > 0 ? '+' : ''}${Math.round(measurementResult.bpmChange)} BPM`}</strong><small>{measurementResult.bpmChange === null ? 'No Watch comparison was available.' : 'Median recovery heart rate compared with the starting median.'}</small></div>
          <div><span>Your check-in</span><strong>{measurementResult.feelingChange > 0 ? '+' : ''}{measurementResult.feelingChange} points</strong><small>{preRating}/10 before · {postRating}/10 after</small></div>
        </div>
        <p class="result-note">A lower number can suggest settling, but one short session cannot diagnose anxiety or prove that an exercise caused the change.</p>
      {/if}
      <div class="reflection">
        <span>Before you move on</span>
        <strong>Unclench your jaw. Let your shoulders drop.</strong>
      </div>
      <div class="actions completion-actions">
        <button class="secondary" onclick={restart}>Practice again</button>
        <a class="primary" href="/app?tab=exercises">Back to exercises <span aria-hidden="true">→</span></a>
      </div>
    </section>
  {/if}
</main>

<style>
  :global(*){box-sizing:border-box}:global(html){background:#f7f1e7}:global(body){margin:0;color:#2f302d;font-family:Manrope,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}:global(button),:global(textarea),:global(input){font:inherit;color:inherit}:global(button:focus-visible),:global(a:focus-visible),:global(textarea:focus-visible),:global(input:focus-visible){outline:2px solid var(--accent-dark);outline-offset:3px}
  main{--paper:#f7f1e7;--surface:#fffdf9;--line:#dcd3c6;--muted:#6f716b;min-height:100svh;background:var(--paper);overflow:hidden;position:relative}main::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.14;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.13'/%3E%3C/svg%3E")}
  .topbar{height:76px;padding:calc(12px + env(safe-area-inset-top)) clamp(20px,4vw,48px) 0;display:grid;grid-template-columns:44px 1fr 90px;align-items:center;position:relative;z-index:2}.back{width:44px;height:44px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;color:inherit;background:#fffdf97d}.back svg{width:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.wordmark{justify-self:center;color:inherit;text-decoration:none;font-family:Georgia,serif;font-size:16px;letter-spacing:.15em}.wordmark span{color:#b9785f}.method-name{text-align:right;text-transform:uppercase;font-size:9px;font-weight:750;letter-spacing:.14em;color:var(--muted)}
  .intro{width:min(1120px,100%);min-height:calc(100svh - 76px);margin:auto;padding:clamp(36px,7vw,92px) clamp(24px,7vw,88px);display:grid;grid-template-columns:minmax(300px,520px) 1fr;gap:clamp(40px,9vw,130px);align-items:center}.intro-copy{position:relative;z-index:1}.eyebrow{margin:0 0 14px;text-transform:uppercase;font-size:10px;font-weight:750;letter-spacing:.16em;color:var(--accent-dark)}h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(46px,6vw,76px);line-height:.98;letter-spacing:-.04em;margin:0}.lede{max-width:470px;margin:25px 0 0;color:var(--muted);font-size:16px;line-height:1.65}.intro-meta{display:flex;gap:10px;margin:26px 0}.intro-meta span{min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:999px;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);background:#fffdf980}.intro-meta b{font-size:16px;color:var(--accent-dark)}.primary,.secondary{min-height:52px;padding:0 20px;border-radius:16px;font-weight:750;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:24px;text-decoration:none}.primary{border:0;background:var(--accent-dark);color:#fff}.secondary{border:1px solid var(--line);background:#fffdf9}.primary:active,.secondary:active{opacity:.72}.primary:disabled,.secondary:disabled{opacity:.35;cursor:default}.hero-visual{width:min(38vw,440px);aspect-ratio:1;justify-self:center;position:relative}.breath-visual{border-radius:50%;background:var(--accent);box-shadow:0 0 0 34px color-mix(in srgb,var(--accent) 45%,transparent),0 0 0 70px color-mix(in srgb,var(--accent) 18%,transparent)}.breath-visual i{position:absolute;inset:50% auto auto 50%;width:50%;height:1px;transform-origin:left;background:var(--accent-dark);opacity:.26}.breath-visual i:nth-child(2){transform:rotate(120deg)}.breath-visual i:nth-child(3){transform:rotate(240deg)}.mindful-visual{border-radius:46% 54% 62% 38%/42% 43% 57% 58%;background:var(--accent);transform:rotate(-7deg)}.mindful-visual i{position:absolute;border:1px solid var(--accent-dark);border-radius:50%;opacity:.38}.mindful-visual i:first-child{width:64%;height:64%;left:18%;top:18%}.mindful-visual i:nth-child(2){width:36%;height:36%;left:32%;top:32%}.mindful-visual span{position:absolute;width:10%;height:10%;left:45%;top:45%;border-radius:50%;background:var(--accent-dark)}.senses-visual{display:grid;place-items:center}.senses-visual i{position:absolute;display:grid;place-items:center;border:1px solid var(--accent-dark);border-radius:50%;font:italic 22px Georgia;color:var(--accent-dark);background:color-mix(in srgb,var(--accent) 86%,white);box-shadow:0 18px 45px #66735f1f}.senses-visual i:nth-child(1){width:43%;height:43%;left:29%;top:3%}.senses-visual i:nth-child(2){width:34%;height:34%;right:4%;top:36%}.senses-visual i:nth-child(3){width:30%;height:30%;right:24%;bottom:0}.senses-visual i:nth-child(4){width:32%;height:32%;left:3%;bottom:17%}.senses-visual i:nth-child(5){width:24%;height:24%;left:8%;top:13%}
  .practice-shell{width:min(780px,100%);min-height:calc(100svh - 76px);margin:auto;padding:clamp(28px,5vw,58px) 24px 44px;position:relative;z-index:1}.progress-header{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:11px}.progress-header button{min-height:44px;padding:0 4px;border:0;background:transparent;text-decoration:underline;text-underline-offset:4px;cursor:pointer}.progress-track{height:4px;margin:7px 0 clamp(24px,5vw,52px);border-radius:99px;background:#ded6c9;overflow:hidden}.progress-track i{display:block;height:100%;border-radius:inherit;background:var(--accent-dark);transition:width .35s ease}.practice-card{min-height:560px;padding:clamp(28px,6vw,58px);border:1px solid var(--line);border-radius:32px;background:#fffdf9;box-shadow:0 24px 70px #4a473f12;display:flex;flex-direction:column;align-items:flex-start}.practice-card h1{max-width:620px;font-size:clamp(39px,7vw,66px)}.practice-card>p:not(.eyebrow){max-width:510px;margin:20px 0;color:var(--muted);font-size:15px;line-height:1.6}.actions{width:100%;display:flex;gap:10px;justify-content:center}.actions.split{margin-top:auto;justify-content:space-between}.breathing-card{align-items:center;text-align:center}.breath-orbit{width:min(45vw,210px);aspect-ratio:1;margin:0 auto 28px;border-radius:50%;display:grid;place-items:center;background:var(--accent);box-shadow:0 0 0 16px color-mix(in srgb,var(--accent) 35%,transparent);animation:breathe-in 4s ease-in-out both}.breath-orbit[data-phase="1"]{animation:hold 4s linear both}.breath-orbit[data-phase="2"]{animation:breathe-out 6s ease-in-out both}.breath-orbit.paused{animation-play-state:paused}.breath-orbit div{display:flex;flex-direction:column}.breath-orbit span{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--accent-dark)}.breath-orbit strong{font:56px Georgia;color:var(--accent-dark)}.breathing-card h1{font-size:38px}.breath-dots{display:flex;gap:8px;margin:8px 0 26px}.breath-dots i{width:8px;height:8px;border-radius:50%;background:#ddd8cf}.breath-dots i.complete{background:var(--accent-dark)}
  .prompt-card,.senses-card{position:relative;overflow:hidden}.prompt-number,.sense-count{position:absolute;right:26px;top:8px;font:clamp(120px,24vw,190px) Georgia;color:var(--accent);line-height:1;z-index:0}.prompt-card>*:not(.prompt-number),.senses-card>*:not(.sense-count){position:relative;z-index:1}.mindful-anchor{width:100%;min-height:150px;margin:8px 0 12px;display:grid;place-items:center;position:relative}.mindful-anchor i{position:absolute;border:1px solid var(--accent-dark);border-radius:50%;opacity:.16}.mindful-anchor i:first-child{width:142px;height:142px}.mindful-anchor i:nth-child(2){width:106px;height:106px;opacity:.22}.mindful-anchor i:nth-child(3){width:72px;height:72px;background:var(--accent);border:0;opacity:1}.mindful-anchor span{position:relative;max-width:62px;color:var(--accent-dark);font:italic 14px/1.15 Georgia;text-align:center}.prompt-card .practice-note{margin:0 0 24px;padding:12px 14px;border-left:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 22%,transparent);font-size:12px;line-height:1.5}.senses-card form{width:100%;display:flex;gap:8px;margin-top:22px}.senses-card input{min-width:0;flex:1;height:52px;padding:0 16px;border:1px solid var(--line);border-radius:16px;background:#f8f4ed}.senses-card form button{min-width:70px;border:0;border-radius:15px;background:var(--accent);font-weight:750;cursor:pointer}.senses-card form button:disabled{opacity:.4}.answer-list{width:100%;min-height:88px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:8px;margin:16px 0}.answer-list button{min-height:40px;padding:0 10px 0 14px;border:0;border-radius:999px;background:var(--accent);cursor:pointer}.answer-list span{margin-left:8px;color:var(--accent-dark)}
  .completion{width:min(660px,100%);min-height:calc(100svh - 76px);margin:auto;padding:clamp(44px,9vw,100px) 24px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;z-index:1}.completion-mark{width:86px;height:86px;margin-bottom:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent)}.completion-mark svg{width:45px;fill:none;stroke:var(--accent-dark);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.completion h1{font-size:clamp(48px,8vw,72px)}.completion>p:not(.eyebrow){max-width:480px;margin:22px 0;color:var(--muted);font-size:15px;line-height:1.65}.reflection{width:min(100%,480px);margin:12px 0 30px;padding:18px;border:1px solid var(--line);border-radius:18px;background:#fffdf9;text-align:left}.reflection span{display:block;margin-bottom:6px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.reflection strong{font:18px/1.35 Georgia}.completion-actions{flex-wrap:wrap}.completion-actions .primary,.completion-actions .secondary{min-width:180px}
  .feeling-scale{width:min(100%,470px);display:block;margin:12px 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:17px;background:#fffdf9}.feeling-scale>span,.feeling-scale>small{display:flex;justify-content:space-between;gap:16px}.feeling-scale strong{font-size:11px}.feeling-scale b{font-size:12px;color:var(--accent-dark)}.feeling-scale input{width:100%;height:30px;margin:4px 0 0;accent-color:var(--accent-dark)}.feeling-scale small{font-size:9px;color:var(--muted)}
  .measurement-stage{width:min(620px,100%);min-height:calc(100svh - 76px);margin:auto;padding:clamp(40px,8vw,90px) 24px 48px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;z-index:1}.measurement-stage h1{max-width:580px;font-size:clamp(42px,8vw,66px)}.measurement-stage>p:not(.eyebrow){max-width:500px;margin:20px 0;color:var(--muted);font-size:14px;line-height:1.6}.watch-pulse{width:84px;height:84px;margin-bottom:26px;border-radius:28px;display:grid;place-items:center;background:#eee8dd;color:#817d75;box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}.watch-pulse.connected{background:var(--accent);color:var(--accent-dark);animation:watch-pulse 2.2s ease-out infinite}.watch-pulse svg{width:38px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.measurement-reading{width:min(100%,430px);margin:6px 0 20px;padding:18px;border:1px solid var(--line);border-radius:20px;background:#fffdf9}.measurement-reading>span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.measurement-reading>strong{display:block;margin:8px 0;font:42px Georgia}.measurement-reading strong small{font:10px Manrope;color:var(--muted)}.measurement-reading>div{height:5px;border-radius:999px;background:#e3ddd3;overflow:hidden}.measurement-reading>div i{display:block;height:100%;border-radius:inherit;background:var(--accent-dark);transition:width .25s ease}.measurement-reading>small{display:block;margin-top:8px;font-size:9px;color:var(--muted)}.measurement-stage>.primary{min-width:min(100%,300px)}.text-action{min-height:44px;margin-top:8px;padding:0 12px;border:0;background:transparent;color:var(--muted);font-size:11px;text-decoration:underline;text-underline-offset:4px;cursor:pointer}.comparison-preview{width:min(100%,430px);display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 12px}.comparison-preview>div{padding:15px;border:1px solid var(--line);border-radius:18px;background:#fffdf9}.comparison-preview span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.comparison-preview strong{display:block;margin-top:7px;font:25px Georgia}.comparison-preview small{font:9px Manrope;color:var(--muted)}.recovery-scale{margin:4px 0 18px;text-align:left}.reading-count{margin-top:9px;color:var(--muted);font-size:9px}
  .result-card{width:min(100%,480px);display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 0;text-align:left}.result-card>div{padding:16px;border:1px solid var(--line);border-radius:18px;background:#fffdf9}.result-card span{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.result-card strong{display:block;margin:7px 0 4px;font:21px Georgia}.result-card small{font-size:9px;line-height:1.4;color:var(--muted)}.completion .result-note{margin:10px 0 4px!important;font-size:10px!important}
  @keyframes breathe-in{from{transform:scale(.76)}to{transform:scale(1)}}@keyframes hold{from,to{transform:scale(1)}}@keyframes breathe-out{from{transform:scale(1)}to{transform:scale(.76)}}@keyframes watch-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 60%,transparent)}70%,100%{box-shadow:0 0 0 18px transparent}}
  @media(max-width:700px){.topbar{grid-template-columns:44px 1fr 72px;padding-inline:16px}.wordmark{font-size:13px}.intro{min-height:calc(100svh - 76px);grid-template-columns:1fr;gap:26px;padding:32px 24px 48px}.hero-visual{order:-1;width:min(54vw,230px)}.intro h1{font-size:clamp(43px,13vw,60px)}.lede{font-size:14px;margin-top:18px}.intro-meta{margin:20px 0}.intro .primary{width:100%}.practice-shell{padding:22px 16px 32px}.practice-card{min-height:calc(100svh - 160px);padding:28px 22px;border-radius:25px}.practice-card h1{font-size:clamp(38px,11vw,52px)}.prompt-number,.sense-count{right:14px}.completion-actions{flex-direction:column}.completion-actions>*{width:100%}}
  @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
