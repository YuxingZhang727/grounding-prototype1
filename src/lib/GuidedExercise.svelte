<script lang="ts">
  import { onDestroy } from 'svelte';

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
      intro: 'Nothing to solve. Follow a few quiet prompts and let each answer be enough.',
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
    { label:'Arrive', title:'Feel where your body is supported.', hint:'Notice the chair, floor, or surface holding your weight.' },
    { label:'Listen', title:'Let one sound come to you.', hint:'Near or far, pleasant or ordinary—there is no right sound.' },
    { label:'Notice', title:'Name what is here without changing it.', hint:'A sensation, a thought, or a feeling can simply be present.' },
    { label:'Return', title:'Follow one natural breath.', hint:'Notice where you feel it most clearly, then let it go.' }
  ];

  const groundingSteps = [
    { count:5, sense:'see', title:'Look around slowly.', hint:'Name five things you can see.' },
    { count:4, sense:'feel', title:'Notice points of contact.', hint:'Name four things you can feel.' },
    { count:3, sense:'hear', title:'Let sounds find you.', hint:'Name three things you can hear.' },
    { count:2, sense:'smell', title:'Notice the air around you.', hint:'Name two things you can smell—or remember.' },
    { count:1, sense:'taste', title:'Notice one taste.', hint:'Name one thing you can taste—or would like to taste.' }
  ];

  type Screen = 'intro' | 'practice' | 'complete';
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

  $: config = configs[mode];
  $: breathInstruction = ['Breathe in', 'Hold gently', 'Breathe out'][breathPhase];
  $: breathDuration = [4, 4, 6][breathPhase];
  $: progress = mode === 'breathing'
    ? Math.min(100, breathCycles / 6 * 100)
    : mode === 'mindfulness'
      ? (mindfulnessStep + 1) / mindfulnessPrompts.length * 100
      : (groundingStep + 1) / groundingSteps.length * 100;

  function begin() {
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
    note = '';
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
    screen = 'complete';
    navigator.vibrate?.(16);
    try {
      const sessions = JSON.parse(localStorage.getItem('grounding.guidedSessions') || '[]');
      sessions.unshift({ mode, completedAt:Date.now() });
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
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
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
        <button class="primary" onclick={begin}>Begin practice <span aria-hidden="true">→</span></button>
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
          <label for="mindful-note">A word or short note <span>optional</span></label>
          <textarea id="mindful-note" bind:value={note} rows="3" placeholder="What do you notice?"></textarea>
          <div class="actions split">
            <button class="secondary" disabled={mindfulnessStep === 0} onclick={() => { mindfulnessStep -= 1; note = ''; }}>Back</button>
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

  {:else}
    <section class="completion">
      <div class="completion-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="m11 21 6 6 13-15"/></svg></div>
      <p class="eyebrow">Practice complete</p>
      <h1 tabindex="-1">You made a little room.</h1>
      <p>Notice what feels the same and what feels even slightly different. Both answers are okay.</p>
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
  .prompt-card,.senses-card{position:relative;overflow:hidden}.prompt-number,.sense-count{position:absolute;right:26px;top:8px;font:clamp(120px,24vw,190px) Georgia;color:var(--accent);line-height:1;z-index:0}.prompt-card>*:not(.prompt-number),.senses-card>*:not(.sense-count){position:relative;z-index:1}.prompt-card label{margin-top:24px;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.prompt-card label span{font-weight:500;color:var(--muted);text-transform:none;letter-spacing:0}.prompt-card textarea{width:100%;margin-top:9px;padding:15px;border:1px solid var(--line);border-radius:16px;background:#f8f4ed;resize:none;line-height:1.5}.senses-card form{width:100%;display:flex;gap:8px;margin-top:22px}.senses-card input{min-width:0;flex:1;height:52px;padding:0 16px;border:1px solid var(--line);border-radius:16px;background:#f8f4ed}.senses-card form button{min-width:70px;border:0;border-radius:15px;background:var(--accent);font-weight:750;cursor:pointer}.senses-card form button:disabled{opacity:.4}.answer-list{width:100%;min-height:88px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:8px;margin:16px 0}.answer-list button{min-height:40px;padding:0 10px 0 14px;border:0;border-radius:999px;background:var(--accent);cursor:pointer}.answer-list span{margin-left:8px;color:var(--accent-dark)}
  .completion{width:min(660px,100%);min-height:calc(100svh - 76px);margin:auto;padding:clamp(44px,9vw,100px) 24px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;z-index:1}.completion-mark{width:86px;height:86px;margin-bottom:28px;border-radius:50%;display:grid;place-items:center;background:var(--accent)}.completion-mark svg{width:45px;fill:none;stroke:var(--accent-dark);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.completion h1{font-size:clamp(48px,8vw,72px)}.completion>p:not(.eyebrow){max-width:480px;margin:22px 0;color:var(--muted);font-size:15px;line-height:1.65}.reflection{width:min(100%,480px);margin:12px 0 30px;padding:18px;border:1px solid var(--line);border-radius:18px;background:#fffdf9;text-align:left}.reflection span{display:block;margin-bottom:6px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.reflection strong{font:18px/1.35 Georgia}.completion-actions{flex-wrap:wrap}.completion-actions .primary,.completion-actions .secondary{min-width:180px}
  @keyframes breathe-in{from{transform:scale(.76)}to{transform:scale(1)}}@keyframes hold{from,to{transform:scale(1)}}@keyframes breathe-out{from{transform:scale(1)}to{transform:scale(.76)}}
  @media(max-width:700px){.topbar{grid-template-columns:44px 1fr 72px;padding-inline:16px}.wordmark{font-size:13px}.intro{min-height:calc(100svh - 76px);grid-template-columns:1fr;gap:26px;padding:32px 24px 48px}.hero-visual{order:-1;width:min(54vw,230px)}.intro h1{font-size:clamp(43px,13vw,60px)}.lede{font-size:14px;margin-top:18px}.intro-meta{margin:20px 0}.intro .primary{width:100%}.practice-shell{padding:22px 16px 32px}.practice-card{min-height:calc(100svh - 160px);padding:28px 22px;border-radius:25px}.practice-card h1{font-size:clamp(38px,11vw,52px)}.prompt-number,.sense-count{right:14px}.completion-actions{flex-direction:column}.completion-actions>*{width:100%}}
  @media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
