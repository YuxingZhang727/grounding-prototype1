<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import AppIcon from '$lib/AppIcon.svelte';
  import { deleteRoll, loadRolls, tapeImage, type SoundRoll } from '$lib/sound-tape';
  import { deleteJournal, deleteSticker, loadJournals, loadStickers, type SavedJournal, type SavedSticker } from '$lib/artifact-store';
  import { exportImage, journalFileName } from '$lib/image-export';
  import { estimateArousal, type ArousalEstimate, type InterventionType } from '$lib/arousal-estimator';
  import {
    availableMetrics,
    describeDeviation,
    getHealthTrends,
    healthTrendsAvailable,
    requestHealthAuthorization,
    type TrendMetric,
    type TrendsPayload
  } from '$lib/health';
  import {
    getLatestWatchSignal,
    getWatchAvailability,
    getWatchCheckIns,
    isWatchSignalNative,
    onWatchAvailabilityChanged,
    onWatchCheckIn,
    onWatchSignal,
    requestLatestWatchSignal,
    type WatchAvailability,
    type WatchCheckIn,
    type WatchSignalSnapshot
  } from '$lib/watch-signal';

  type Tab = 'home' | 'history' | 'exercises' | 'archive' | 'profile';
  const tabs: { id: Tab; label: string }[] = [
    { id:'home', label:'Home' }, { id:'history', label:'History' }, { id:'exercises', label:'Exercises' },
    { id:'archive', label:'Archive' }, { id:'profile', label:'Profile' }
  ];
  const methods = [
    { name:'Breathing', meta:'1–5 min', theme:'breathing', symbol:'◯ 〰' },
    { name:'Mindfulness', meta:'3–5 min', theme:'mindfulness', symbol:'◒ ＝' },
    { name:'Standard Grounding', meta:'5-4-3-2-1', theme:'sensory', symbol:'•  ◦  •  ◦' },
    { name:'Creative Digital Grounding', meta:'2–5 min', theme:'digital', symbol:'▱ ◇ ▱' }
  ];
  let tab: Tab = 'home';
  let duration = 'all';
  let rolls: SoundRoll[] = [];
  let stickers: SavedSticker[] = [];
  let journals: SavedJournal[] = [];
  let exportingJournalId = '';
  let exportNotice = '';
  let notice = '';
  type HealthState = 'checking' | 'unavailable' | 'ready' | 'connecting' | 'loading' | 'connected' | 'empty' | 'error';
  const healthMetricDetails: { key: TrendMetric['key']; label: string; unit: string }[] = [
    { key:'hrv', label:'Heart-rate variability', unit:'ms' },
    { key:'restingHeartRate', label:'Resting heart rate', unit:'bpm' },
    { key:'respiratoryRate', label:'Respiratory rate', unit:'breaths/min' },
    { key:'mindfulMinutes', label:'Mindful minutes', unit:'min' }
  ];
  const healthRequestedKey = 'grounding.health.requested';
  let healthState: HealthState = 'checking';
  let healthTrends: TrendsPayload | null = null;
  let selectedHealthKey: TrendMetric['key'] | null = null;
  let selectedHealthMetric: TrendMetric | undefined;
  let selectedHealthDetails: (typeof healthMetricDetails)[number] | undefined;
  let selectedHealthChart: { points:string; baselineY:number | null; minimum:number; maximum:number; lastX:number; lastY:number };
  let healthPanelOpen = false;
  let healthMessage = 'Checking whether Apple Health is available…';
  let watchAvailability: WatchAvailability = { available:false, activated:false, paired:false, watchAppInstalled:false, reachable:false };
  let watchSnapshot: WatchSignalSnapshot = { available:false };
  let watchCheckIns: WatchCheckIn[] = [];
  let watchClock = Date.now();
  let arousal: ArousalEstimate;
  $: arousal = estimateArousal(watchSnapshot, healthTrends, watchClock);
  $: selectedHealthMetric = selectedHealthKey ? healthMetric(selectedHealthKey) : undefined;
  $: selectedHealthDetails = selectedHealthKey ? healthMetricDetails.find(item => item.key === selectedHealthKey) : undefined;
  $: selectedHealthChart = healthChart(selectedHealthMetric);

  function watchIsLive() {
    if (!watchSnapshot.isRunning || !watchSnapshot.timestamp) return false;
    const age = watchClock - new Date(watchSnapshot.timestamp).getTime();
    return Number.isFinite(age) && age >= 0 && age < 15_000;
  }
  function watchAgeSeconds() {
    if (!watchSnapshot.timestamp) return null;
    const age = Math.floor((watchClock - new Date(watchSnapshot.timestamp).getTime()) / 1000);
    return Number.isFinite(age) ? Math.max(0, age) : null;
  }
  function watchStatusLabel() {
    if (!watchAvailability.activated) return 'Connecting';
    if (!watchAvailability.paired) return 'Not paired';
    if (watchIsLive()) return 'Live now';
    if (!watchAvailability.watchAppInstalled) return 'Not installed';
    if (watchAgeSeconds() !== null) return 'Signal delayed';
    if (watchAvailability.reachable) return 'Ready';
    return 'Waiting';
  }
  function watchStatusDescription() {
    if (!watchAvailability.activated) return 'Connecting to your paired Apple Watch…';
    if (!watchAvailability.paired) return 'Pair an Apple Watch to receive live body signals.';
    if (watchIsLive()) return watchSnapshot.status || 'Receiving current signals from your watch.';
    if (!watchAvailability.watchAppInstalled) return 'Install the Grounding Watch app to begin.';
    if (watchAgeSeconds() !== null) return `Last Watch update was ${watchAgeSeconds()} seconds ago.`;
    return 'Open Grounding on your watch and start a measurement.';
  }
  function checkInTime(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
  }

  function readTab(): Tab {
    const value = new URLSearchParams(location.search).get('tab') as Tab | null;
    return tabs.some(item => item.id === value) ? value! : 'home';
  }
  function selectTab(next: Tab, replace = false) {
    tab = next;
    const url = new URL(location.href); url.searchParams.set('tab', next);
    void goto(url.pathname + url.search, { replaceState:replace, noScroll:true, keepFocus:true });
    document.querySelector('.app-scroll')?.scrollTo({ top:0, behavior:'instant' });
  }
  function startDigital() { location.href = '/touch?flow=grounding'; }
  function chooseMethod(name: string) {
    if (name === 'Creative Digital Grounding' || name === 'Digital Grounding') startDigital();
    else notice = `${name} is represented in the app framework; its active exercise will be built after Digital Grounding.`;
  }
  function startRecommendedIntervention(type: InterventionType) {
    if (type === 'Creative Digital Grounding') {
      startDigital();
      return;
    }
    notice = `${type} is recommended from the current estimate. Its guided exercise is the next prototype step.`;
  }
  function cadenceLabel(minutes: number) {
    return minutes <= 5 ? 'Check again in about 5 minutes' : `Check again in about ${minutes} minutes`;
  }
  async function removeRoll(roll: SoundRoll) { await deleteRoll(roll.id); rolls = rolls.filter(item => item.id !== roll.id); }
  async function removeSticker(sticker: SavedSticker) { await deleteSticker(sticker.id); stickers = stickers.filter(item => item.id !== sticker.id); }
  async function removeJournal(journal: SavedJournal) { await deleteJournal(journal.id); journals = journals.filter(item => item.id !== journal.id); }
  async function exportJournal(journal: SavedJournal) {
    if (exportingJournalId) return;
    exportingJournalId = journal.id;
    exportNotice = '';
    try {
      const result = await exportImage(journal.image, journalFileName(journal.created));
      exportNotice = result === 'photos'
        ? 'Journal saved to your photo library.'
        : result === 'shared'
          ? 'The journal is ready to share or save.'
          : 'Journal image downloaded.';
    } catch (error) {
      exportNotice = error instanceof Error ? error.message : 'The journal image could not be exported.';
    } finally {
      exportingJournalId = '';
    }
  }
  function journalDate(created: number) {
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', year:'numeric' }).format(created);
  }
  function healthProfileSummary() {
    if (healthState === 'checking') return 'Checking availability…';
    if (healthState === 'unavailable') return 'Not available in this build';
    if (healthState === 'ready') return 'Not connected';
    if (healthState === 'connecting') return 'Waiting for permission…';
    if (healthState === 'loading') return 'Refreshing recent data…';
    if (healthState === 'connected') return `Connected · ${availableMetrics(healthTrends!).length} recent signals`;
    if (healthState === 'empty') return 'Access set up · no recent data';
    return 'Needs attention';
  }
  function healthStatusLabel() {
    if (healthState === 'connected') return 'Up to date';
    if (healthState === 'empty') return 'No recent data';
    if (healthState === 'loading' || healthState === 'checking' || healthState === 'connecting') return 'Checking';
    if (healthState === 'ready') return 'Not connected';
    if (healthState === 'unavailable') return 'iPhone only';
    return 'Try again';
  }
  function healthMetric(key: TrendMetric['key']) { return healthTrends?.[key]; }
  function openHealthMetric(key: TrendMetric['key']) {
    selectedHealthKey = key;
    setTimeout(() => document.querySelector<HTMLElement>('#health-detail-heading')?.focus(), 0);
  }
  function closeHealthMetric() {
    const key = selectedHealthKey;
    selectedHealthKey = null;
    if (key) setTimeout(() => document.querySelector<HTMLElement>(`[data-health-key="${key}"]`)?.focus(), 0);
  }
  function healthChart(metric: TrendMetric | undefined) {
    const series = metric?.series ?? [];
    if (!series.length) return { points:'', baselineY:null as number | null, minimum:0, maximum:0, lastX:0, lastY:0 };
    const values = series.map(point => point.value);
    if (typeof metric?.baseline === 'number') values.push(metric.baseline);
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    const padding = Math.max((maximum - minimum) * 0.15, maximum * 0.03, 1);
    minimum = Math.max(0, minimum - padding);
    maximum += padding;
    const range = Math.max(maximum - minimum, 1);
    const x = (index: number) => 14 + (series.length === 1 ? 136 : index * 272 / (series.length - 1));
    const y = (value: number) => 12 + (maximum - value) * 104 / range;
    return {
      points: series.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' '),
      baselineY: typeof metric?.baseline === 'number' ? y(metric.baseline) : null,
      minimum,
      maximum,
      lastX: x(series.length - 1),
      lastY: y(series[series.length - 1].value)
    };
  }
  function healthMetricExplanation(key: TrendMetric['key']) {
    if (key === 'hrv') return 'Daily HRV averages recorded by Apple Health. The dashed line is your recent personal median; day-to-day variation is common.';
    if (key === 'restingHeartRate') return 'Daily resting heart-rate values recorded by Apple Health, compared with your recent personal median.';
    if (key === 'respiratoryRate') return 'Daily respiratory-rate averages available in Apple Health, often recorded while resting or sleeping.';
    return 'Total duration of mindful sessions recorded in Apple Health for each day.';
  }
  function chartDay(day: string) {
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric' }).format(new Date(`${day}T12:00:00`));
  }
  function healthChartSummary(metric: TrendMetric | undefined) {
    if (!metric?.series.length) return 'No historical readings are available.';
    const first = metric.series[0];
    const last = metric.series[metric.series.length - 1];
    if (metric.series.length < 2 || first.value === 0) return `${metric.series.length} recorded day${metric.series.length === 1 ? '' : 's'}.`;
    const change = ((last.value - first.value) / first.value) * 100;
    if (Math.abs(change) < 3) return `Broadly stable across ${metric.series.length} recorded days.`;
    return `${Math.abs(change).toFixed(0)}% ${change > 0 ? 'higher' : 'lower'} than the first visible reading.`;
  }
  function handleAppKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && selectedHealthKey) closeHealthMetric();
  }
  function healthValue(metric: TrendMetric | undefined) {
    if (!metric?.available || metric.latest === null) return '—';
    const maximumFractionDigits = metric.key === 'respiratoryRate' ? 1 : 0;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(metric.latest);
  }
  function healthDay(metric: TrendMetric | undefined) {
    if (!metric?.latestDay) return 'No recent reading';
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric' }).format(new Date(`${metric.latestDay}T12:00:00`));
  }
  function healthDescription(key: TrendMetric['key']) {
    const metric = healthMetric(key);
    return metric?.available ? describeDeviation(metric) : 'No recent reading yet.';
  }
  function healthUpdatedAt() {
    if (!healthTrends || healthTrends.generatedAt === new Date(0).toISOString()) return '';
    const date = new Date(healthTrends.generatedAt);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
  }
  async function refreshHealthTrends() {
    healthState = 'loading';
    healthMessage = 'Refreshing your recent Apple Health data…';
    const payload = await getHealthTrends(30);
    if (payload.unavailable) {
      healthTrends = null;
      healthState = 'error';
      healthMessage = 'Recent health data could not be read. You can try again from this device.';
      return;
    }
    healthTrends = payload;
    const count = availableMetrics(payload).length;
    healthState = count ? 'connected' : 'empty';
    healthMessage = count
      ? `${count} of ${healthMetricDetails.length} recent signals are available.`
      : 'Health access is set up, but there are no recent readings for these signals yet.';
  }
  async function connectHealth() {
    if (healthState === 'connecting' || healthState === 'loading' || healthState === 'unavailable') return;
    healthState = 'connecting';
    healthMessage = 'Choose which signals Grounding may read in the Apple Health sheet.';
    const completed = await requestHealthAuthorization();
    if (!completed) {
      healthState = 'error';
      healthMessage = 'Health access was not completed. Your app still works without it.';
      return;
    }
    localStorage.setItem(healthRequestedKey, 'true');
    await refreshHealthTrends();
  }
  async function initializeHealth() {
    healthState = 'checking';
    const available = await healthTrendsAvailable();
    if (!available) {
      healthState = 'unavailable';
      healthMessage = 'Apple Health is available only in an entitled iPhone build.';
      return;
    }
    if (localStorage.getItem(healthRequestedKey) === 'true') {
      await refreshHealthTrends();
      return;
    }
    healthState = 'ready';
    healthMessage = 'Connect Apple Health when you are ready. This is optional.';
  }
  function revealHealthPanel(focusHeading = false) {
    setTimeout(() => {
      document.querySelector<HTMLElement>('#health-permission-panel')?.scrollIntoView({ block:'start' });
      if (focusHeading) document.querySelector<HTMLElement>('#health-permission-heading')?.focus();
    }, 0);
  }
  function toggleHealthPanel() {
    healthPanelOpen = !healthPanelOpen;
    if (healthPanelOpen) revealHealthPanel();
  }
  function openHealthSetup() {
    healthPanelOpen = true;
    selectTab('profile');
    revealHealthPanel(true);
  }
  onMount(() => {
    selectTab(readTab(), true);
    loadJournals().then(value => journals = value).catch(() => {});
    loadRolls().then(value => rolls = value).catch(() => {});
    loadStickers().then(value => stickers = value).catch(() => {});
    void initializeHealth();
    const watchListenerHandles: Array<{ remove: () => Promise<void> }> = [];
    let watchListenersDisposed = false;
    let watchRequestInFlight = false;
    async function initializeWatch() {
      if (!isWatchSignalNative()) return;
      try {
        // Subscribe before reading initial state so session activation cannot
        // complete in the small gap between the read and listener setup.
        const handles = await Promise.all([
          onWatchSignal(snapshot => {
            watchSnapshot = snapshot;
            watchAvailability = {
              ...watchAvailability,
              available:true,
              activated:true,
              paired:true,
              watchAppInstalled:true,
              reachable:true
            };
          }),
          onWatchCheckIn(entry => {
            watchCheckIns = [entry, ...watchCheckIns.filter(item => item.id !== entry.id)].slice(0, 100);
            watchAvailability = { ...watchAvailability, available:true, activated:true, paired:true, watchAppInstalled:true };
          }),
          onWatchAvailabilityChanged(availability => watchAvailability = availability)
        ]);
        if (watchListenersDisposed) {
          handles.forEach(handle => void handle?.remove());
        } else {
          handles.forEach(handle => { if (handle) watchListenerHandles.push(handle); });
        }
        [watchAvailability, watchSnapshot, watchCheckIns] = await Promise.all([
          getWatchAvailability(), getLatestWatchSignal(), getWatchCheckIns()
        ]);
        if (watchSnapshot.kind === 'snapshot') {
          watchAvailability = { ...watchAvailability, paired:true, watchAppInstalled:true };
        }
      } catch {
        watchAvailability = { available:true, activated:false, paired:false, watchAppInstalled:false, reachable:false };
      }
    }
    void initializeWatch();
    const watchRefreshTimer = window.setInterval(async () => {
      watchClock = Date.now();
      if (!isWatchSignalNative() || watchRequestInFlight) return;
      watchRequestInFlight = true;
      try {
        const snapshot = await requestLatestWatchSignal();
        if (snapshot.kind === 'snapshot') watchSnapshot = snapshot;
      } finally {
        watchRequestInFlight = false;
      }
    }, 2_000);
    const back = () => tab = readTab(); window.addEventListener('popstate', back);
    return () => {
      watchListenersDisposed = true;
      window.clearInterval(watchRefreshTimer);
      watchListenerHandles.forEach(handle => void handle.remove());
      window.removeEventListener('popstate', back);
    };
  });
</script>

<svelte:head><title>Grounding</title><meta name="description" content="A calm place to check in, choose an exercise, and keep grounding artifacts." /></svelte:head>
<svelte:window onkeydown={handleAppKeydown}/>

<div class="app-shell">
  <aside class="desktop-rail" aria-label="Primary navigation">
    <strong>GROUNDING<span>·</span></strong>
    {#each tabs as item}<button class:active={tab===item.id} onclick={() => selectTab(item.id)}><AppIcon name={item.id} /><span>{item.label}</span></button>{/each}
  </aside>
  <main class="app-scroll" tabindex="-1">
    <div class="page" class:exercises-page={tab === 'exercises'}>
      {#if tab === 'home'}
        <header class="page-header"><div><p class="eyebrow">Saturday, September 19</p><h1>Good afternoon.</h1></div><div class="avatar" aria-hidden="true"></div></header>
        <section class:unavailable={arousal.level === 'unavailable'} class:mild={arousal.level === 'mild'} class:elevated={arousal.level === 'elevated'} class="state-card" aria-labelledby="arousal-heading">
          <div>
            <p class="eyebrow">Right now · physiological estimate</p>
            <h2 id="arousal-heading">{arousal.label}</h2>
            <p>{arousal.summary}</p>
          </div>
          {#if isWatchSignalNative()}
            <div class:active={watchIsLive()} class:delayed={!watchIsLive() && watchAgeSeconds() !== null} class="watch-source" aria-label={`Apple Watch status: ${watchStatusLabel()}`}>
              <span aria-hidden="true"><AppIcon name="watch" size={24}/><i></i></span>
              <strong>Watch</strong><small>{watchStatusLabel()}</small>
            </div>
          {/if}
        </section>
        {#if arousal.factors.length}
          <details class="estimate-details">
            <summary><span><strong>How this was estimated</strong><small>{arousal.factors.length} current and historical inputs</small></span><AppIcon name="chevron" size={18}/></summary>
            <div class="estimate-details-body">
              <ul>
                {#each arousal.factors.slice(0, 4) as factor}
                  <li><span class:confounded={factor.direction === 'confounded'}>{factor.direction === 'confounded' ? 'Context' : factor.direction === 'supporting' ? 'Adds score' : 'No added score'}</span><p>{factor.label}</p></li>
                {/each}
              </ul>
              <div class="estimate-method">
                <strong>What “near baseline” means in this prototype</strong>
                <p>The internal rule score is {arousal.score ?? 0}/100: 0–24 is near baseline, 25–49 is a slight shift, and 50–100 is higher activation.</p>
                <p>The live baseline is the median of the first 5–8 low-motion heart-rate readings in this Watch session. Historical signals use the previous 14 days, excluding the latest reading.</p>
              </div>
              <p class="estimate-disclaimer">This is a rule-based estimate of bodily arousal. It cannot determine whether you are anxious or explain why a signal changed.</p>
            </div>
          </details>
        {/if}
        <section class:prominent={arousal.policy.prominence === 'high'} class="focus-card">
          <div class="focus-copy">
            <p class="eyebrow">Suggested now · {arousal.policy.intensity}</p>
            <h2>{arousal.policy.type}</h2>
            <p>{arousal.policy.reason}</p>
            <div class="policy-meta"><span>{cadenceLabel(arousal.policy.repeatAfterMinutes)}</span><span>{arousal.policy.prominence} priority</span></div>
            <button class="primary" onclick={() => startRecommendedIntervention(arousal.policy.type)}>Try this intervention</button>
          </div>
          <div class="paper-motif" aria-hidden="true"><i></i><i></i><b></b></div>
        </section>
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
        <div class="section-title"><h2>Later today</h2><button>See plan</button></div>
        <section class="task-list"><article><AppIcon name="calendar"/><div><strong>Project reading</strong><span>3:30 PM · 25 minutes</span></div><span>Next</span></article><article><AppIcon name="heart"/><div><strong>Check in again</strong><span>After your next task</span></div><span>Later</span></article></section>
      {:else if tab === 'history'}
        <header class="page-header"><div><p class="eyebrow">Your patterns</p><h1>History</h1></div></header>
        <section class="summary-card"><div><strong>4</strong><span>grounding sessions</span></div><div><strong>12m</strong><span>time spent noticing</span></div><div><strong>{rolls.length}</strong><span>sound tapes kept</span></div></section>
        {#if isWatchSignalNative()}
          <section class="watch-checkins" aria-labelledby="watch-checkins-heading">
            <div class="section-title"><div><p class="eyebrow">From Apple Watch</p><h2 id="watch-checkins-heading">Momentary anxiety check-ins</h2></div><span>{watchCheckIns.length}</span></div>
            {#if watchCheckIns.length}
              <div class="watch-checkin-list">
                {#each watchCheckIns.slice(0, 5) as entry}
                  <article><strong>{entry.rating}</strong><div><span>{checkInTime(entry.timestamp)}</span><small>{entry.bpm ? `${Math.round(entry.bpm)} BPM at check-in` : 'No heart-rate sample'} · self-reported 0–10</small></div></article>
                {/each}
              </div>
            {:else}
              <p class="collection-empty">Check-ins recorded on your watch will appear here automatically.</p>
            {/if}
          </section>
        {/if}
        <section class="trend-card"><div class="section-title"><h2>This week</h2><span>Gentler by Friday</span></div><div class="bars" aria-label="Tension trend: Monday 4, Tuesday 3, Wednesday 4, Thursday 2, Friday 2">{#each [4,3,4,2,2] as value,index}<i style={`height:${22+value*14}px`}><span>{['M','T','W','T','F'][index]}</span></i>{/each}</div><p>Your check-ins eased after short creative exercises. This is a personal pattern, not a diagnosis.</p></section>
        <section class="health-card" aria-labelledby="recent-health-heading">
          <div class="health-card-header">
            <div class="health-title"><span class="health-icon" aria-hidden="true"><AppIcon name="heart"/></span><div><p class="eyebrow">Apple Health · Last 30 days</p><h2 id="recent-health-heading">Recent health context</h2></div></div>
            <span class="health-status" class:active={healthState === 'connected'}>{healthStatusLabel()}</span>
          </div>
          {#if healthState === 'connected'}
            <div class="health-grid">
              {#each healthMetricDetails as item}
                <button data-health-key={item.key} class:unavailable={!healthMetric(item.key)?.available} onclick={() => openHealthMetric(item.key)} aria-label={`View ${item.label} history and data source`}>
                  <span>{item.label}</span>
                  <div><strong>{healthValue(healthMetric(item.key))}</strong>{#if healthMetric(item.key)?.available}<small>{item.unit}</small>{/if}</div>
                  <p>{healthDescription(item.key)} · {healthDay(healthMetric(item.key))}</p>
                  <span class="view-history">{healthMetric(item.key)?.available ? 'View history' : 'About this data'} <AppIcon name="chevron" size={14}/></span>
                </button>
              {/each}
            </div>
            <div class="health-card-footer"><p>Compared with your own 14-day baseline. This is supporting context, not a diagnosis.</p><span>{healthUpdatedAt() ? `Updated ${healthUpdatedAt()}` : ''}</span></div>
          {:else if healthState === 'empty'}
            <div class="health-empty"><strong>Access is set up, waiting for recent readings.</strong><p>Wear your watch as usual or add a mindful session. New data will appear here when Apple Health has it.</p></div>
          {:else if healthState === 'checking' || healthState === 'loading' || healthState === 'connecting'}
            <div class="health-empty loading"><span class="loading-dot" aria-hidden="true"></span><strong>{healthState === 'connecting' ? 'Waiting for your choice…' : 'Checking recent data…'}</strong><p>This usually takes only a moment.</p></div>
          {:else if healthState === 'unavailable'}
            <div class="health-empty"><strong>Recent health context is available in the iPhone app.</strong><p>Your check-ins and grounding history still work on this device.</p></div>
          {:else}
            <div class="health-empty"><strong>{healthState === 'ready' ? 'Connect Apple Health to add personal context.' : 'Recent data could not be loaded.'}</strong><p>Grounding only reads the signals you choose, and the app remains useful without them.</p></div>
          {/if}
          <div class="health-actions">
            {#if healthState === 'ready' || healthState === 'error'}
              <button class="secondary" onclick={openHealthSetup}>Review and connect</button>
            {:else if healthState === 'connected' || healthState === 'empty'}
              <button class="secondary" onclick={refreshHealthTrends}>Refresh recent data</button>
            {/if}
          </div>
          <p class="sr-status" aria-live="polite">{healthMessage}</p>
        </section>
        <h2 class="list-heading">Recent sessions</h2><section class="session-list"><article><span class="method-dot digital"></span><div><strong>Digital Grounding</strong><small>Today · Touch, sight, and sound</small></div><AppIcon name="chevron"/></article><article><span class="method-dot breathing"></span><div><strong>Breathing</strong><small>Thursday · 3 minutes</small></div><AppIcon name="chevron"/></article></section>
      {:else if tab === 'exercises'}
        <header class="page-header"><h1>Exercises</h1><div class="avatar" aria-hidden="true"></div></header>
        <button class="featured" onclick={startDigital}><div><p class="eyebrow">For you</p><h2>Digital Grounding</h2><span>3 min · visual + touch + sound</span></div><div class="digital-lines" aria-hidden="true"><i></i><i></i><i></i></div></button>
        <div class="filters" aria-label="Filter by duration">{#each [['all','All'],['short','1–3 min'],['five','5 min']] as filter}<button class:active={duration===filter[0]} aria-pressed={duration===filter[0]} onclick={() => duration=filter[0]}>{filter[1]}</button>{/each}</div>
        <h2 class="list-heading">All methods</h2>
        <section class="method-grid">{#each methods as method}<button class={method.theme} onclick={() => chooseMethod(method.name)}><span class="method-symbol" aria-hidden="true">{method.symbol}</span><strong>{method.name}</strong><small>{method.meta}</small></button>{/each}</section>
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      {:else if tab === 'archive'}
        <header class="page-header"><div><p class="eyebrow">What you have noticed</p><h1>Archive</h1></div></header>
        <section class="archive-hero"><h2>Your sensory collection</h2><p>Completed pages and reusable pieces stay on this device.</p><div class="archive-count"><strong>{journals.length + rolls.length + stickers.length}</strong><span>items kept</span></div></section>
        {#if exportNotice}<p class="export-notice" role="status">{exportNotice}</p>{/if}

        <section class="collection-section journals-section">
          <div class="collection-heading"><div><p class="eyebrow">Completed grounding</p><h2>Journal Pages</h2></div><span>{journals.length}</span></div>
          {#if journals.length}
            <div class="journal-grid">
              {#each journals as journal}
                <article class="journal-card">
                  <button class="artifact-delete" onclick={() => removeJournal(journal)} aria-label={`Delete journal from ${journalDate(journal.created)}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button>
                  <img src={journal.image} alt={`Grounding journal from ${journalDate(journal.created)}`}/>
                  <div>
                    <strong>{journalDate(journal.created)}</strong>
                    <span>{journal.stickerCount} stickers · {journal.tapeCount} tapes</span>
                    <button class="journal-export" onclick={() => exportJournal(journal)} disabled={Boolean(exportingJournalId)}>
                      {exportingJournalId === journal.id ? 'Preparing…' : 'Save image'}
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {:else}<p class="collection-empty">Finish a Digital Grounding session and the complete page will appear here.</p>{/if}
        </section>

        <section class="collection-section">
          <div class="collection-heading"><div><p class="eyebrow">Reusable visual pieces</p><h2>Sticker Collection</h2></div><span>{stickers.length}</span></div>
          {#if stickers.length}
            <div class="artifact-grid sticker-grid">
              {#each stickers as sticker}<article class="artifact"><button class="artifact-delete" onclick={() => removeSticker(sticker)} aria-label={`Delete ${sticker.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button><img class="sticker-image" src={sticker.image} alt={sticker.name}/><div><strong>{sticker.name}</strong><span>Saved sticker</span></div></article>{/each}
            </div>
          {:else}<p class="collection-empty">Stickers you create and keep will collect here.</p>{/if}
        </section>

        <section class="collection-section">
          <div class="collection-heading"><div><p class="eyebrow">Reusable sound pieces</p><h2>Tape Collection</h2></div><span>{rolls.length}</span></div>
          {#if rolls.length}
            <div class="artifact-grid tape-grid">
              {#each rolls as roll}<article class="artifact tape-artifact"><button class="artifact-delete" onclick={() => removeRoll(roll)} aria-label={`Delete ${roll.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg></button><img src={tapeImage(roll.frames,520)} alt={`Sound tape: ${roll.name}`}/><div><strong>{roll.name}</strong><span>{roll.duration.toFixed(1)} seconds · sound tape</span></div></article>{/each}
            </div>
          {:else}<p class="collection-empty">Sound tapes you explicitly save will collect here.</p>{/if}
        </section>

        {#if !journals.length && !rolls.length && !stickers.length}<div class="empty"><div class="paper-motif" aria-hidden="true"><i></i><i></i><b></b></div><h2>Your first page will appear here.</h2><p>Complete Digital Grounding to build your archive.</p><button class="primary" onclick={startDigital}>Start Digital Grounding</button></div>{/if}
      {:else}
        <header class="page-header"><div><p class="eyebrow">Your space</p><h1>Profile</h1></div><div class="avatar large" aria-hidden="true"></div></header>
        <section class="profile-card"><h2>Yuxing</h2><p>Grounding adapts to your check-ins and preferences on this device.</p></section>
        <h2 class="list-heading">Connected context</h2>
        <section class="settings-list">
          <button class="settings-row" onclick={toggleHealthPanel} aria-expanded={healthPanelOpen} aria-controls="health-permission-panel">
            <AppIcon name="heart"/><div><strong>Apple Health</strong><small>{healthProfileSummary()}</small></div><span class="row-end">{#if healthState === 'connected'}<i class="status-dot" aria-hidden="true"></i>{/if}<AppIcon name="chevron"/></span>
          </button>
        </section>
        {#if healthPanelOpen}
          <section class="health-permission-card" id="health-permission-panel" aria-labelledby="health-permission-heading">
            <div class="permission-heading"><div><p class="eyebrow">Optional context</p><h2 id="health-permission-heading" tabindex="-1">Connect Apple Health</h2></div><button class="text-button" onclick={() => healthPanelOpen = false}>Close</button></div>
            <p>With your permission, Grounding can compare a few recent signals with your own baseline and make exercise suggestions feel more relevant.</p>
            <ul>
              <li>Heart-rate variability</li><li>Resting heart rate</li><li>Respiratory rate</li><li>Mindful minutes</li>
            </ul>
            <div class="privacy-note"><AppIcon name="heart"/><p><strong>Your choice stays yours.</strong><span>Only summarized trends enter the app. Grounding does not diagnose you, and you can change access later in the Health app.</span></p></div>
            <p class="permission-status" aria-live="polite">{healthMessage}</p>
            {#if healthState === 'ready' || healthState === 'error'}
              <button class="primary permission-action" onclick={connectHealth}>Connect Apple Health</button>
            {:else if healthState === 'connected' || healthState === 'empty'}
              <button class="primary permission-action" onclick={refreshHealthTrends}>Refresh recent data</button>
            {:else if healthState === 'checking' || healthState === 'connecting' || healthState === 'loading'}
              <button class="primary permission-action" disabled>{healthState === 'connecting' ? 'Waiting for permission…' : 'Checking…'}</button>
            {/if}
          </section>
        {/if}
        <h2 class="list-heading">App preferences</h2><section class="settings-list"><article><span class="setting-icon">Aa</span><div><strong>Text and accessibility</strong><small>System text size · reduced motion</small></div><AppIcon name="chevron"/></article><article><span class="setting-icon">↕</span><div><strong>Display orientation</strong><small>Portrait on phone · adaptive on iPad and web</small></div><span>Portrait</span></article></section>
      {/if}
    </div>
  </main>
  {#if selectedHealthKey && selectedHealthDetails}
    <div class="health-detail-layer" role="presentation">
      <button class="health-detail-scrim" aria-label="Close health history" onclick={closeHealthMetric}></button>
      <div class="health-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="health-detail-heading">
        <div class="health-detail-handle" aria-hidden="true"></div>
        <header>
          <div><p class="eyebrow">Apple Health · Last 30 days</p><h2 id="health-detail-heading" tabindex="-1">{selectedHealthDetails.label}</h2></div>
          <button class="health-detail-close" onclick={closeHealthMetric} aria-label="Close health history"><span aria-hidden="true">×</span></button>
        </header>
        {#if selectedHealthMetric?.available && selectedHealthMetric.series.length}
          <div class="health-detail-summary">
            <div><span>Latest</span><strong>{healthValue(selectedHealthMetric)}</strong><small>{selectedHealthDetails.unit}</small></div>
            <div><span>Personal baseline</span><strong>{selectedHealthMetric.baseline === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits:1 }).format(selectedHealthMetric.baseline)}</strong><small>{selectedHealthDetails.unit}</small></div>
          </div>
          <div class="health-line-chart">
            <div class="chart-scale"><span>{selectedHealthChart.maximum.toFixed(0)}</span><span>{selectedHealthChart.minimum.toFixed(0)}</span></div>
            <svg viewBox="0 0 300 128" role="img" aria-label={`${selectedHealthDetails.label} history. ${healthChartSummary(selectedHealthMetric)}`}>
              <path class="chart-grid" d="M14 12H286M14 64H286M14 116H286"/>
              {#if selectedHealthChart.baselineY !== null}<path class="chart-baseline" d={`M14 ${selectedHealthChart.baselineY}H286`}/>{/if}
              <polyline points={selectedHealthChart.points}/>
              <circle cx={selectedHealthChart.lastX} cy={selectedHealthChart.lastY} r="4"/>
            </svg>
            <div class="chart-dates"><span>{chartDay(selectedHealthMetric.series[0].day)}</span><span>{chartDay(selectedHealthMetric.series[selectedHealthMetric.series.length - 1].day)}</span></div>
          </div>
          <p class="health-chart-summary">{healthChartSummary(selectedHealthMetric)}</p>
        {:else}
          <div class="health-detail-empty">
            <strong>No recorded history yet</strong>
            <p>Apple Health did not return a reading for this metric in the last 30 days. You can still see where the data will come from below.</p>
          </div>
        {/if}
        <div class="health-source-note"><strong>Where this comes from</strong><p>{healthMetricExplanation(selectedHealthKey)}</p></div>
        {#if selectedHealthMetric?.series.length}
          <div class="health-reading-list" aria-label="Recent recorded values">
            <strong>Recent readings</strong>
            {#each selectedHealthMetric.series.slice(-7).reverse() as point}
              <div><span>{chartDay(point.day)}</span><span>{new Intl.NumberFormat(undefined, { maximumFractionDigits:1 }).format(point.value)} {selectedHealthDetails.unit}</span></div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  <nav class="bottom-nav" aria-label="Primary navigation">
    {#each tabs as item}<button class:active={tab===item.id} aria-current={tab===item.id?'page':undefined} onclick={() => selectTab(item.id)}><AppIcon name={item.id}/><span>{item.label}</span></button>{/each}
  </nav>
</div>

<style>
  :global(*){box-sizing:border-box} :global(html){background:#f7f1e7} :global(body){margin:0;color:#2f302d;font-family:Manrope,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overscroll-behavior:none} :global(button){font:inherit;color:inherit} :global(button:focus-visible),:global(a:focus-visible){outline:2px solid #b9785f;outline-offset:3px}
  .app-shell{--bg:#f7f1e7;--surface:#fffdf9;--cream:#f1e7d6;--border:#ded6c9;--muted:#6f716b;--sun:#efb23e;--sun-soft:#fcecc6;--teal:#ddebe6;--coral:#efc5b5;min-height:100dvh;background:var(--bg);position:relative;overflow:hidden}.app-scroll{height:100dvh;overflow-y:auto;overscroll-behavior-y:contain;scrollbar-width:none;padding:0 max(env(safe-area-inset-right),0px) calc(100px + env(safe-area-inset-bottom)) max(env(safe-area-inset-left),0px)}.app-scroll::-webkit-scrollbar{display:none}.page{width:min(100%,680px);min-height:100%;margin:auto;padding:calc(22px + env(safe-area-inset-top)) 24px 34px}.page-header{min-height:44px;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.page-header h1{font-size:28px;line-height:1.2;margin:0;font-weight:750;letter-spacing:-.025em}.eyebrow{text-transform:uppercase;letter-spacing:.11em;font-size:10px;font-weight:650;color:#b26e54;margin:0 0 7px}.avatar{width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#fff8df 0 18%,transparent 19%),linear-gradient(145deg,#f0b33f 0 46%,#dcebe6 47%);border:1px solid #d6c8b6}.avatar.large{width:48px;height:48px}
  h2{margin:0}.state-card,.focus-card,.summary-card,.trend-card,.health-card,.profile-card,.settings-list,.session-list{border:1px solid var(--border);background:var(--surface);border-radius:22px}.state-card{padding:18px;display:flex;align-items:center;gap:20px;justify-content:space-between;border-left:5px solid #7aa59d}.state-card>div:first-child{min-width:0}.state-card.unavailable{border-left-color:#bbb3a7}.state-card.mild{border-left-color:var(--sun)}.state-card.elevated{border-left-color:#c46f57}.state-card h2{font-size:19px;margin-bottom:7px}.state-card p:last-child,.focus-card p,.trend-card p,.profile-card p,.archive-hero p{font-size:13px;line-height:1.55;color:var(--muted);margin:0}.watch-source{width:78px;flex:none;display:flex;flex-direction:column;align-items:center;text-align:center;color:var(--muted)}.watch-source>span{position:relative;width:44px;height:44px;display:grid;place-items:center;border-radius:15px;background:var(--cream)}.watch-source i{position:absolute;right:4px;bottom:4px;width:9px;height:9px;border:2px solid var(--surface);border-radius:50%;background:#aaa59d}.watch-source strong{margin-top:6px;font-size:11px}.watch-source small{margin-top:2px;font-size:9px}.watch-source.active{color:#355f59}.watch-source.active>span{background:var(--teal)}.watch-source.active i{background:#3f9187}.watch-source.delayed i{background:#d4982d}.focus-card{margin-top:14px;padding:21px;background:var(--coral);border:0;display:grid;grid-template-columns:1fr 110px;min-height:220px;overflow:hidden}.focus-card.prominent{box-shadow:inset 5px 0 0 #b65f49}.focus-copy{position:relative;z-index:2}.focus-card h2{font-size:23px;line-height:1.2;margin:5px 0 9px}.primary{min-height:52px;padding:0 20px;border:0;border-radius:16px;background:var(--sun);font-weight:700;cursor:pointer;touch-action:manipulation}.primary:active{opacity:.72}.primary:disabled{cursor:default;opacity:.55}.focus-card .primary{margin-top:17px}.policy-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}.policy-meta span{padding:6px 8px;border-radius:999px;background:#fffdf980;font-size:9px;font-weight:700;text-transform:capitalize;color:#655f58}.paper-motif{position:relative;min-height:130px}.paper-motif i,.paper-motif b{position:absolute;display:block;width:82px;height:72px;border-radius:18px;transform:rotate(8deg);background:var(--sun-soft);top:35px;left:0}.paper-motif i:nth-child(2){background:var(--teal);transform:rotate(-8deg);left:35px;top:20px}.paper-motif b{width:45px;height:45px;border-radius:50%;background:var(--sun);left:70px;top:63px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:26px 0 10px}.section-title h2,.list-heading{font-size:17px}.section-title button{border:0;background:none;color:var(--muted);font-size:12px}.task-list,.session-list,.settings-list{overflow:hidden}.task-list article,.session-list article,.settings-list article{min-height:67px;padding:12px 15px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}.task-list article:last-child,.session-list article:last-child,.settings-list article:last-child{border:0}.task-list div,.session-list div,.settings-list div{display:flex;flex:1;flex-direction:column;gap:3px}.task-list span,.session-list small,.settings-list small,.settings-list article>span{font-size:11px;color:var(--muted)}
  .estimate-details{margin-top:12px;border:1px solid var(--border);border-radius:18px;background:var(--surface);overflow:hidden}.estimate-details summary{min-height:58px;padding:10px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}.estimate-details summary::-webkit-details-marker{display:none}.estimate-details summary>span{display:flex;flex-direction:column;gap:3px}.estimate-details summary strong{font-size:12px}.estimate-details summary small{font-size:10px;color:var(--muted)}.estimate-details summary :global(svg){transition:transform .2s ease}.estimate-details[open] summary :global(svg){transform:rotate(90deg)}.estimate-details-body{padding:0 15px 15px;border-top:1px solid var(--border)}.estimate-details ul{display:grid;gap:9px;margin:14px 0 0;padding:0;list-style:none}.estimate-details li{display:grid;grid-template-columns:84px 1fr;gap:10px;align-items:start}.estimate-details li>span{padding:5px 7px;border-radius:9px;background:var(--teal);font-size:9px;font-weight:700;text-align:center}.estimate-details li>span.confounded{background:var(--sun-soft)}.estimate-details li p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--muted)}.estimate-method{margin-top:14px;padding:13px;border-radius:14px;background:var(--cream)}.estimate-method strong{font-size:11px}.estimate-method p{margin:6px 0 0;font-size:10px;line-height:1.5;color:var(--muted)}.estimate-disclaimer{margin:15px 0 0;padding-top:13px;border-top:1px solid var(--border);font-size:10px;line-height:1.5;color:var(--muted)}
  .summary-card{display:grid;grid-template-columns:repeat(3,1fr);padding:16px;margin-bottom:14px}.summary-card div{display:flex;flex-direction:column;gap:3px;padding:5px 10px;border-right:1px solid var(--border)}.summary-card div:last-child{border:0}.summary-card strong{font-size:24px}.summary-card span{font-size:10px;color:var(--muted)}.trend-card{padding:18px}.trend-card .section-title{margin:0 0 18px}.trend-card .section-title span{font-size:11px;color:var(--muted)}.bars{height:105px;display:flex;gap:13px;align-items:end;border-bottom:1px solid var(--border);margin-bottom:18px}.bars i{display:block;position:relative;width:28px;max-height:90px;border-radius:9px 9px 0 0;background:#c9ddb8}.bars i:nth-child(3){background:#efc5b5}.bars span{position:absolute;bottom:-17px;width:100%;text-align:center;font:10px/1 Manrope;color:var(--muted)}.list-heading{margin:24px 0 10px}.method-dot{width:34px;height:34px;border-radius:12px;background:var(--coral)}.method-dot.breathing{background:#c8dde8}
  .health-card{margin-top:14px;padding:18px}.health-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.health-title{display:flex;align-items:center;gap:11px}.health-title .eyebrow{margin-bottom:4px}.health-title h2{font-size:18px}.health-icon{width:42px;height:42px;flex:none;border-radius:14px;display:grid;place-items:center;background:var(--coral);color:#844f43}.health-status{flex:none;padding:7px 9px;border-radius:999px;background:var(--cream);color:var(--muted);font-size:10px;font-weight:700}.health-status.active{background:var(--teal);color:#355f59}.health-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.health-grid>button{min-width:0;min-height:154px;padding:14px;border:0;border-radius:17px;background:#f7f1e7;text-align:left;cursor:pointer;display:flex;flex-direction:column;align-items:stretch}.health-grid>button:active{opacity:.72}.health-grid>button.unavailable{background:#f5f2ec;opacity:.72}.health-grid>button>span:first-child{display:block;min-height:30px;font-size:11px;line-height:1.35;color:var(--muted)}.health-grid>button>div{display:flex;align-items:baseline;gap:5px;margin-top:6px}.health-grid strong{font-size:25px;line-height:1}.health-grid small{font-size:10px;color:var(--muted)}.health-grid>button>p{min-height:32px;margin:9px 0 0;font-size:10px;line-height:1.45;color:var(--muted)}.health-grid .view-history{min-height:auto!important;margin-top:auto;padding-top:10px;display:flex!important;align-items:center;justify-content:flex-end;gap:3px;color:#466b64!important;font-size:9px!important;font-weight:700}.health-card-footer{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-top:14px;padding-top:13px;border-top:1px solid var(--border)}.health-card-footer p{max-width:380px;margin:0;font-size:10px;line-height:1.45;color:var(--muted)}.health-card-footer span{flex:none;font-size:9px;line-height:1.4;color:var(--muted);text-align:right}.health-empty{min-height:132px;margin-top:18px;padding:22px;border-radius:18px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;background:#f7f1e7}.health-empty strong{font-size:14px}.health-empty p{margin:7px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}.health-empty.loading{align-items:center;text-align:center}.loading-dot{width:22px;height:22px;margin-bottom:12px;border:3px solid #d8ccbd;border-top-color:#b26e54;border-radius:50%;animation:health-spin .8s linear infinite}.health-actions{display:flex;justify-content:flex-end;margin-top:13px}.secondary{min-height:44px;padding:0 15px;border:1px solid var(--border);border-radius:14px;background:var(--surface);font-size:12px;font-weight:700;cursor:pointer}.secondary:active,.settings-row:active,.text-button:active{opacity:.66}.sr-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes health-spin{to{transform:rotate(360deg)}}
  .watch-checkins{margin:0 0 14px;padding:18px;border:1px solid var(--border);border-radius:22px;background:var(--surface)}.watch-checkins .section-title{margin:0 0 12px}.watch-checkins .section-title>div{display:block}.watch-checkins .section-title>span{min-width:30px;height:30px;border-radius:15px;background:var(--teal);display:grid;place-items:center;font-size:11px;font-weight:700}.watch-checkin-list{overflow:hidden;border:1px solid var(--border);border-radius:17px}.watch-checkin-list article{min-height:62px;padding:10px 13px;display:flex;align-items:center;gap:13px;border-bottom:1px solid var(--border)}.watch-checkin-list article:last-child{border:0}.watch-checkin-list article>strong{width:38px;height:38px;border-radius:14px;background:var(--sun-soft);display:grid;place-items:center;font-size:19px}.watch-checkin-list article>div{display:flex;flex-direction:column;gap:3px}.watch-checkin-list span{font-size:12px;font-weight:700}.watch-checkin-list small{font-size:10px;color:var(--muted)}
  .featured{width:100%;min-height:126px;border:0;border-radius:26px;background:var(--coral);padding:18px;display:flex;text-align:left;justify-content:space-between;align-items:center;cursor:pointer}.featured h2{font-size:18px;margin:3px 0 5px}.featured span{font-size:11px;color:var(--muted)}.digital-lines{position:relative;width:90px;height:70px}.digital-lines i{position:absolute;width:47px;height:35px;border:2px solid #2f302d;top:18px;left:5px}.digital-lines i:nth-child(2){left:26px;transform:rotate(10deg)}.digital-lines i:nth-child(3){left:47px;transform:rotate(-7deg)}.filters{display:flex;gap:8px;margin:12px 0 14px}.filters button{min-height:44px;flex:1;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:13px}.filters button.active{background:var(--sun-soft);border-color:var(--sun)}.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.method-grid button{min-height:156px;border:0;border-radius:24px;padding:16px;text-align:left;display:flex;flex-direction:column;cursor:pointer}.method-grid .breathing{background:#c8dde8}.method-grid .mindfulness{background:#ddd6ee}.method-grid .sensory{background:#cfdfc0}.method-grid .digital{background:var(--coral)}.method-symbol{height:57px;display:flex;align-items:center;font:24px Georgia;letter-spacing:.15em}.method-grid strong{font-size:14px;margin-top:auto}.method-grid small{font-size:11px;color:var(--muted);margin-top:7px}.notice{font-size:12px;line-height:1.5;color:var(--muted);margin:14px 2px}
  .archive-hero{position:relative;padding:20px 100px 20px 20px;border-radius:24px;background:var(--teal);min-height:128px}.archive-hero h2{font-size:20px;margin-bottom:8px}.archive-count{position:absolute;right:20px;top:22px;display:flex;flex-direction:column;text-align:center}.archive-count strong{font-size:30px}.archive-count span{font-size:10px;color:var(--muted)}
  .collection-section{margin-top:30px}.collection-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.collection-heading .eyebrow{margin-bottom:5px}.collection-heading h2{font-size:20px}.collection-heading>span{min-width:36px;height:36px;padding:0 10px;border-radius:18px;background:var(--cream);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--muted)}.collection-empty{margin:0;padding:20px;border:1px dashed #cfc5b6;border-radius:18px;color:var(--muted);font-size:12px;line-height:1.5;background:rgba(255,253,249,.48)}
  .journal-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.journal-card{min-width:0;border:1px solid var(--border);border-radius:22px;overflow:hidden;background:var(--surface);position:relative}.journal-card>img{display:block;width:100%;aspect-ratio:1;object-fit:cover}.journal-card>div{padding:13px;display:flex;flex-direction:column;gap:4px}.journal-card span,.artifact span{font-size:10px;color:var(--muted)}
  .journal-export{min-height:44px;margin-top:8px;padding:0 12px;border:1px solid var(--border);border-radius:12px;background:var(--cream);color:var(--ink);font:inherit;font-size:11px;font-weight:700;cursor:pointer}.journal-export:active{opacity:.66}.journal-export:disabled{cursor:default;opacity:.5}.export-notice{margin:12px 0 0;padding:11px 13px;border-radius:14px;background:#e3efea;color:#355f59;font-size:12px;line-height:1.45}
  .artifact-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.artifact{min-width:0;border:1px solid var(--border);border-radius:20px;overflow:hidden;background:var(--surface);position:relative}.artifact>img{display:block;width:100%;height:130px;object-fit:cover}.artifact>img.sticker-image{object-fit:contain;padding:12px;background:#f5eee3}.artifact>div{padding:13px;display:flex;flex-direction:column;gap:4px}.tape-grid{grid-template-columns:1fr}.tape-artifact>img{height:96px;padding:18px 16px;object-fit:contain;background:#f5eee3}
  .artifact-delete{position:absolute;z-index:2;right:8px;top:8px;width:44px;height:44px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:#fffdf9ed;color:#934235;box-shadow:0 2px 8px #2f302d20;cursor:pointer}.artifact-delete svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.artifact-delete:active{opacity:.68}.empty{padding:30px;text-align:center}.empty .paper-motif{width:130px;margin:auto}.empty h2{font-size:19px}.empty p{font-size:13px;line-height:1.5;color:var(--muted)}.profile-card{padding:19px}.profile-card h2{font-size:19px;margin-bottom:4px}.setting-icon{width:24px;text-align:center;color:#6b7e77}.status-dot{display:block;width:10px!important;height:10px;border-radius:50%;background:#4f9e95}.settings-row{width:100%;min-height:68px;padding:12px 15px;border:0;background:transparent;display:flex;align-items:center;gap:12px;text-align:left;cursor:pointer}.settings-row>div{display:flex;flex:1;flex-direction:column;gap:3px}.settings-row small{font-size:11px;color:var(--muted)}.row-end{display:flex;align-items:center;gap:10px;color:var(--muted)}.health-permission-card{scroll-margin-block:calc(22px + env(safe-area-inset-top)) 120px;margin-top:12px;padding:20px;border-radius:22px;background:var(--teal);border:1px solid #c8ddd5}.permission-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.permission-heading h2{font-size:20px}.text-button{min-height:44px;padding:0 10px;border:0;background:transparent;color:#466b64;font-size:12px;font-weight:700;cursor:pointer}.health-permission-card>p{margin:14px 0 0;font-size:13px;line-height:1.55;color:#52645f}.health-permission-card ul{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:17px 0;padding:0;list-style:none}.health-permission-card li{position:relative;padding-left:16px;font-size:12px;line-height:1.45}.health-permission-card li::before{content:'';position:absolute;left:0;top:.42em;width:7px;height:7px;border-radius:50%;background:#efb23e}.privacy-note{display:flex;gap:11px;padding:14px;border-radius:16px;background:#fffdf9b8}.privacy-note :global(svg){flex:none;color:#8a5548}.privacy-note p{display:flex;flex-direction:column;gap:4px;margin:0}.privacy-note strong{font-size:12px}.privacy-note span{font-size:11px;line-height:1.45;color:var(--muted)}.health-permission-card .permission-status{min-height:37px;margin-top:13px;font-size:11px}.permission-action{width:100%;margin-top:10px}
  .health-detail-layer{position:fixed;z-index:90;inset:0;display:flex;align-items:flex-end;justify-content:center}.health-detail-scrim{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;background:rgba(42,38,34,.46);cursor:pointer}.health-detail-sheet{position:relative;width:min(100%,620px);max-height:min(88dvh,760px);padding:10px 22px calc(26px + env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:var(--surface);overflow-y:auto;box-shadow:0 -12px 40px rgba(45,40,35,.16)}.health-detail-handle{width:38px;height:4px;margin:0 auto 13px;border-radius:999px;background:#c9c1b6}.health-detail-sheet header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.health-detail-sheet header h2{font-size:23px;line-height:1.2}.health-detail-close{width:44px;height:44px;flex:none;padding:0;border:1px solid var(--border);border-radius:50%;background:var(--surface);font-size:26px;line-height:1;cursor:pointer}.health-detail-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.health-detail-summary>div{padding:14px;border-radius:17px;background:var(--cream)}.health-detail-summary span{display:block;font-size:10px;color:var(--muted)}.health-detail-summary strong{display:inline-block;margin-top:8px;font-size:25px;font-variant-numeric:tabular-nums}.health-detail-summary small{margin-left:5px;font-size:9px;color:var(--muted)}.health-line-chart{position:relative;margin-top:18px;padding:9px 8px 0 30px;border:1px solid var(--border);border-radius:18px;background:#faf7f1}.health-line-chart svg{display:block;width:100%;height:150px;overflow:visible}.health-line-chart polyline{fill:none;stroke:#4f827b;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.health-line-chart circle{fill:var(--sun);stroke:#fffdf9;stroke-width:3}.health-line-chart .chart-grid{fill:none;stroke:#ded6c9;stroke-width:1}.health-line-chart .chart-baseline{fill:none;stroke:#b26e54;stroke-width:1.5;stroke-dasharray:5 5}.chart-scale{position:absolute;left:7px;top:19px;bottom:30px;display:flex;flex-direction:column;justify-content:space-between;font-size:8px;color:var(--muted)}.chart-dates{display:flex;justify-content:space-between;padding:0 4px 10px;font-size:9px;color:var(--muted)}.health-chart-summary{margin:9px 2px 0;font-size:11px;line-height:1.5;color:var(--muted)}.health-source-note{margin-top:17px;padding:14px;border-radius:17px;background:var(--teal)}.health-source-note strong,.health-reading-list>strong{font-size:12px}.health-source-note p{margin:5px 0 0;font-size:11px;line-height:1.5;color:#52645f}.health-reading-list{margin-top:17px}.health-reading-list>div{min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);font-size:11px}.health-reading-list>div span:last-child{font-weight:700;font-variant-numeric:tabular-nums}
  .bottom-nav{position:fixed;z-index:20;left:max(24px,env(safe-area-inset-left));right:max(24px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));max-width:640px;margin:auto;height:72px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-radius:24px;background:rgba(241,231,214,.96);box-shadow:0 8px 24px rgba(45,40,35,.1);backdrop-filter:blur(16px)}.bottom-nav button{width:58px;height:52px;border:0;border-radius:18px;background:none;color:#72766f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}.bottom-nav button.active{background:var(--sun-soft);color:#2f302d}.bottom-nav span{font-size:9px}.desktop-rail{display:none}
  @media(max-width:374px){.page{padding-inline:18px}.focus-card{grid-template-columns:1fr 80px}.state-card{gap:10px}.watch-source{width:68px}.method-grid{gap:12px}.method-grid button{min-height:145px}.summary-card span{font-size:9px}.bottom-nav{left:12px;right:12px}.bottom-nav button{width:52px}.artifact-grid,.journal-grid,.health-grid{grid-template-columns:1fr}.health-card-header{align-items:flex-start}.health-status{max-width:92px;text-align:center}.health-permission-card ul{grid-template-columns:1fr}.health-detail-sheet{padding-inline:18px}.health-detail-summary{grid-template-columns:1fr}}
  @media(min-width:900px){.app-shell{display:grid;grid-template-columns:230px 1fr}.desktop-rail{display:flex;height:100dvh;padding:calc(32px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));flex-direction:column;gap:8px;border-right:1px solid var(--border);background:#f3ebde}.desktop-rail strong{font-size:18px;letter-spacing:.12em;margin:0 10px 30px}.desktop-rail strong span{color:#b9785f}.desktop-rail button{height:48px;border:0;border-radius:15px;background:none;display:flex;align-items:center;gap:12px;padding:0 15px;color:var(--muted)}.desktop-rail button.active{background:var(--sun-soft);color:#2f302d}.app-scroll{padding-bottom:24px}.page{width:min(100%,820px);padding:48px}.bottom-nav{display:none}.method-grid{grid-template-columns:repeat(4,1fr)}.health-grid{grid-template-columns:repeat(4,1fr)}.focus-card{grid-template-columns:1fr 220px}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
  .health-detail-empty{margin-top:18px;padding:20px;border-radius:18px;background:var(--cream)}
  .health-detail-empty strong{font-size:14px}
  .health-detail-empty p{margin:7px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}
</style>
