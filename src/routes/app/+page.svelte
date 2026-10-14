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
    isWatchSignalNative,
    onWatchAvailabilityChanged,
    onWatchSignal,
    requestLatestWatchSignal,
    startWatchCalibration as beginWatchCalibration,
    startWatchMeasurement,
    stopWatchMeasurement,
    type WatchAvailability,
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
  let isPreparingStickerPhoto = false;
  let stickerImportMessage = '';
  let stickerImportFailed = false;
  let notice = '';
  type HealthState = 'checking' | 'unavailable' | 'ready' | 'connecting' | 'loading' | 'connected' | 'empty' | 'error';
  const healthMetricDetails: { key: TrendMetric['key']; label: string; unit: string }[] = [
    { key:'hrv', label:'Heart-rate variability', unit:'ms' },
    { key:'restingHeartRate', label:'Resting heart rate', unit:'bpm' },
    { key:'respiratoryRate', label:'Respiratory rate', unit:'breaths/min' },
    { key:'mindfulMinutes', label:'Mindful minutes', unit:'min' },
    { key:'sleepDuration', label:'Sleep duration', unit:'hr' },
    { key:'wristTemperature', label:'Wrist temperature', unit:'°C' }
  ];
  const healthRequestedKey = 'grounding.health.requested';
  let healthState: HealthState = 'checking';
  let healthTrends: TrendsPayload | null = null;
  let selectedHealthKey: TrendMetric['key'] | null = null;
  let selectedHealthMetric: TrendMetric | undefined;
  let selectedHealthDetails: (typeof healthMetricDetails)[number] | undefined;
  type HealthReading = { day:string; value:number };
  type ChartPoint = HealthReading & { x:number; y:number };
  let selectedHealthChart: { points:string; chartPoints:ChartPoint[]; baselineY:number | null; minimum:number; maximum:number; lastX:number; lastY:number };
  type HealthRange = 'week' | 'month' | 'all';
  const healthRanges: { id:HealthRange; label:string; days:number }[] = [
    { id:'week', label:'Week', days:7 }, { id:'month', label:'Month', days:30 },
    { id:'all', label:'All', days:5000 }
  ];
  let healthRange: HealthRange = 'month';
  let detailHealthTrends: TrendsPayload | null = null;
  let detailHealthLoading = false;
  let selectedHealthPoint: HealthReading | null = null;
  let isScrubbingHealthChart = false;
  let healthPanelOpen = false;
  let healthMessage = 'Checking whether Apple Health is available…';
  let watchAvailability: WatchAvailability = { available:false, activated:false, paired:false, watchAppInstalled:false, reachable:false };
  let watchSnapshot: WatchSignalSnapshot = { available:false };
  let watchConnectionOpen = false;
  let watchConnectionState: 'idle' | 'testing' | 'success' | 'error' = 'idle';
  let watchConnectionMessage = '';
  type WatchCalibration = { baselineBPM:number; completedAt:string };
  const watchCalibrationKey = 'grounding.watch.calibration.v1';
  let watchCalibration: WatchCalibration | null = null;
  let watchCalibrationState: 'idle' | 'starting' | 'running' | 'complete' | 'error' = 'idle';
  let watchCalibrationMessage = '';
  let analysisSnapshot: WatchSignalSnapshot = { available:false };
  let recentLiveHeartRates: number[] = [];
  let lastAnalyzedTimestamp = '';
  let arousal: ArousalEstimate;
  type MoodId = 'calm' | 'okay' | 'tense' | 'low' | 'energized';
  const moodOptions: { id:MoodId; label:string }[] = [
    { id:'calm', label:'Calm' },
    { id:'okay', label:'Okay' },
    { id:'tense', label:'Tense' },
    { id:'low', label:'Low' },
    { id:'energized', label:'Energized' }
  ];
  const moodStorageKey = 'grounding.today.mood';
  const moodHistoryKey = 'grounding.mood.history.v1';
  const appLocale = 'en-US';
  type MoodCheckIn = { id:string; mood:MoodId; timestamp:number };
  type GuidedSession = { mode:'breathing'|'mindfulness'|'grounding'; completedAt:number; preRating?:number; postRating?:number };
  let selectedMood: MoodId | null = null;
  let moodHistory: MoodCheckIn[] = [];
  let guidedSessions: GuidedSession[] = [];
  let feelingDetailOpen = false;
  let feelingTrigger: HTMLElement | null = null;
  $: arousal = estimateArousal(analysisSnapshot, healthTrends);
  $: homeContext = buildHomeContext(healthTrends, selectedMood);
  $: selectedHealthMetric = selectedHealthKey ? detailHealthTrends?.[selectedHealthKey] ?? healthMetric(selectedHealthKey) : undefined;
  $: selectedHealthDetails = selectedHealthKey ? healthMetricDetails.find(item => item.key === selectedHealthKey) : undefined;
  $: selectedHealthChart = healthChart(selectedHealthMetric);

  function buildHomeContext(trends: TrendsPayload | null, mood: MoodId | null) {
    if (mood) {
      const copy: Record<MoodId, { label:string; summary:string; type:InterventionType }> = {
        calm:{ label:'Feeling calm', summary:'Your check-in says calm.', type:'Creative Digital Grounding' },
        okay:{ label:'Feeling okay', summary:'Your check-in says okay.', type:'Creative Digital Grounding' },
        tense:{ label:'Feeling tense', summary:'Your check-in says tense. A short breathing practice may help.', type:'Breathing' },
        low:{ label:'Feeling low', summary:'Your check-in says low. Try something gentle.', type:'Mindfulness' },
        energized:{ label:'Feeling energized', summary:'Your check-in says energized. Try a sensory practice.', type:'Standard Grounding' }
      };
      return { ...copy[mood], source:'Your check-in', level:mood === 'tense' ? 'elevated' : mood === 'low' ? 'mild' : 'settled' };
    }
    const metrics = trends
      ? [trends.hrv, trends.restingHeartRate, trends.respiratoryRate].filter((metric): metric is TrendMetric => Boolean(metric?.available))
      : [];
    const resting = trends?.restingHeartRate?.deviation;
    const hrv = trends?.hrv?.deviation;
    const respiratory = trends?.respiratoryRate?.deviation;
    const shifted = (resting ?? 0) >= .08 || (hrv ?? 0) <= -.10 || (respiratory ?? 0) >= .08;
    const elevated = (resting ?? 0) >= .15 || (hrv ?? 0) <= -.20 || (respiratory ?? 0) >= .15;
    if (!metrics.length) return {
      label:'How does today feel?',
      summary:'Not enough recent data yet. Check in below if you like.',
      source:'Waiting for recent context', level:'unavailable', type:'Creative Digital Grounding' as InterventionType
    };
    if (elevated) return {
      label:'Today may feel a little more activated',
      summary:'A few signals are farther from your usual pattern.',
      source:`Recent body context · ${metrics.length} signals`, level:'elevated', type:'Breathing' as InterventionType
    };
    if (shifted) return {
      label:'Today may feel a little different',
      summary:'A few signals have shifted from your usual pattern.',
      source:`Recent body context · ${metrics.length} signals`, level:'mild', type:'Standard Grounding' as InterventionType
    };
    return {
      label:'Today may feel fairly steady',
      summary:'Recent signals are close to your usual pattern.',
      source:`Recent body context · ${metrics.length} signals`, level:'settled', type:'Creative Digital Grounding' as InterventionType
    };
  }

  function selectMood(mood: MoodId) {
    selectedMood = mood;
    const timestamp = Date.now();
    const day = localDay(timestamp);
    localStorage.setItem(moodStorageKey, JSON.stringify({ mood, day }));
    moodHistory = [{ id:crypto.randomUUID(), mood, timestamp }, ...moodHistory.filter(item => localDay(item.timestamp) !== day)].slice(0, 120);
    localStorage.setItem(moodHistoryKey, JSON.stringify(moodHistory));
    navigator.vibrate?.(10);
  }

  function localDay(value: number | Date) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function todayLabel() { return new Intl.DateTimeFormat(appLocale, { weekday:'long', month:'long', day:'numeric' }).format(new Date()); }
  function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.'; }

  function openFeelingDetails(event: MouseEvent) {
    feelingTrigger = event.currentTarget as HTMLElement;
    feelingDetailOpen = true;
    setTimeout(() => document.querySelector<HTMLElement>('#feeling-detail-heading')?.focus(), 0);
  }

  function closeFeelingDetails() {
    feelingDetailOpen = false;
    setTimeout(() => feelingTrigger?.focus(), 0);
  }

  function feelingMetricRole(metric: TrendMetric) {
    if (selectedMood) return 'Context only';
    return ['mindfulMinutes','sleepDuration','wristTemperature'].includes(metric.key) ? 'Context only' : 'Used in conclusion';
  }

  function feelingMetricReason(metric: TrendMetric) {
    if (['mindfulMinutes','sleepDuration','wristTemperature'].includes(metric.key)) {
      return 'Shown for context; it does not change today’s conclusion.';
    }
    if (metric.deviation === null) return 'A personal baseline is still being built, so this signal cannot change the conclusion yet.';
    if (selectedMood) return `${describeDeviation(metric)} Your check-in takes priority, so this signal does not override it.`;
    if (metric.key === 'hrv') {
      if (metric.deviation <= -.20) return 'At least 20% below your baseline, crossing the larger-change threshold.';
      if (metric.deviation <= -.10) return 'At least 10% below your baseline, crossing the small-change threshold.';
      return 'Less than 10% below your baseline, so it stays inside the steady range.';
    }
    if (metric.deviation >= .15) return 'At least 15% above your baseline, crossing the larger-change threshold.';
    if (metric.deviation >= .08) return 'At least 8% above your baseline, crossing the small-change threshold.';
    return 'Less than 8% above your baseline, so it stays inside the steady range.';
  }

  function feelingMetricValue(metric: TrendMetric) {
    const details = healthMetricDetails.find(item => item.key === metric.key);
    const latest = healthValue(metric);
    const baseline = metric.baseline === null
      ? 'baseline building'
      : `usual ${new Intl.NumberFormat(appLocale, { maximumFractionDigits:1 }).format(metric.baseline)} ${details?.unit ?? metric.unit}`;
    return `${latest} ${details?.unit ?? metric.unit} · ${baseline}`;
  }

  function watchHasReading() {
    return watchSnapshot.isRunning === true && typeof watchSnapshot.bpm === 'number';
  }
  function baselineTarget() {
    return Math.max(1, watchSnapshot.baselineTarget ?? 5);
  }
  function baselineSampleCount() {
    return Math.min(baselineTarget(), Math.max(0, watchSnapshot.baselineSampleCount ?? 0));
  }
  function baselineIsReady() {
    return watchSnapshot.isRunning === true && typeof watchSnapshot.baselineBPM === 'number';
  }
  function watchStatusLabel() {
    if (!watchAvailability.activated) return 'Connecting';
    if (!watchAvailability.paired) return 'Not paired';
    if (!watchAvailability.watchAppInstalled) return 'Not installed';
    if (watchSnapshot.isRunning) return typeof watchSnapshot.baselineBPM === 'number' ? 'Measuring' : 'Calibrating';
    if (watchAvailability.reachable) return 'Ready';
    return 'Waiting';
  }
  function watchLiveLabel() {
    return watchHasReading() ? `${Math.round(watchSnapshot.bpm!)} bpm` : watchStatusLabel();
  }
  function watchStatusDescription() {
    if (!watchAvailability.activated) return 'Connecting to your paired Apple Watch…';
    if (!watchAvailability.paired) return 'Pair an Apple Watch to receive live body signals.';
    if (!watchAvailability.watchAppInstalled) return 'Install the Grounding Watch app to begin.';
    if (watchSnapshot.isRunning) return watchSnapshot.status || 'Receiving signals from your watch.';
    return 'Open Grounding on your watch and start a measurement.';
  }
  function openWatchSettings() {
    watchConnectionOpen = true;
    watchConnectionState = 'idle';
    watchConnectionMessage = watchStatusDescription();
    selectTab('profile');
  }
  function toggleWatchConnection() {
    watchConnectionOpen = !watchConnectionOpen;
    if (watchConnectionOpen) {
      healthPanelOpen = false;
      watchConnectionState = 'idle';
      watchConnectionMessage = watchStatusDescription();
    }
  }
  function closeWatchConnection() {
    watchConnectionOpen = false;
  }
  async function testWatchConnection() {
    if (watchConnectionState === 'testing') return;
    watchConnectionState = 'testing';
    watchConnectionMessage = 'Checking your Watch connection…';
    try {
      const availability = await getWatchAvailability();
      watchAvailability = availability;
      const snapshot = await requestLatestWatchSignal();
      if (snapshot.kind === 'snapshot') {
        acceptWatchSnapshot(snapshot);
        watchAvailability = {
          ...watchAvailability,
          activated:true,
          paired:true,
          watchAppInstalled:true,
          reachable:true
        };
      }
      const connected = watchAvailability.reachable || snapshot.kind === 'snapshot';
      watchConnectionState = connected ? 'success' : 'error';
      watchConnectionMessage = connected
        ? 'Connected. Your Watch can reach this iPhone.'
        : watchStatusDescription();
    } catch {
      watchConnectionState = 'error';
      watchConnectionMessage = 'Could not reach your Watch. Open Grounding on the Watch and try again.';
    }
  }
  async function startWatchCalibration() {
    if (watchCalibrationState === 'starting' || watchCalibrationState === 'running') return;
    watchCalibrationState = 'starting';
    watchCalibrationMessage = 'Opening a short calibration session on your Watch…';
    try {
      const started = await beginWatchCalibration();
      if (!started) throw new Error('Calibration could not start');
      watchCalibrationMessage = 'Watch opened. Waiting for the first reading…';
      window.setTimeout(() => {
        if (watchCalibrationState === 'starting') {
          watchCalibrationState = 'error';
          watchCalibrationMessage = 'No reading arrived. Keep Grounding open on your Watch and try again.';
        }
      }, 20_000);
    } catch {
      watchCalibrationState = 'error';
      watchCalibrationMessage = 'Calibration could not start. Keep your Watch unlocked and try again.';
    }
  }
  function calibrationProgressMessage() {
    if ((watchSnapshot.motionIntensity ?? 0) >= 0.12) return 'Hold your wrist still — movement has paused calibration.';
    return 'Keep your wrist still while five readings are collected.';
  }
  async function cancelWatchCalibration() {
    await stopWatchMeasurement().catch(() => false);
    watchCalibrationState = 'idle';
    watchCalibrationMessage = '';
  }
  function normalizeWatchSnapshot(snapshot: WatchSignalSnapshot): WatchSignalSnapshot {
    const raw = snapshot as WatchSignalSnapshot & Record<string, unknown>;
    const rawRunning = (snapshot as Record<string, unknown>).isRunning;
    const numberValue = (value: unknown) => {
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const runningValue = rawRunning === undefined
      ? undefined
      : rawRunning === true || rawRunning === 1 || rawRunning === 'true';
    return {
      ...snapshot,
      bpm:numberValue(raw.bpm) ?? numberValue(raw.heartRateBPM) ?? numberValue(raw.bpmText),
      heartRateBPM:numberValue(raw.heartRateBPM) ?? numberValue(raw.bpm) ?? numberValue(raw.bpmText),
      baselineBPM:numberValue(raw.baselineBPM),
      baselineSampleCount:numberValue(raw.baselineSampleCount),
      baselineTarget:numberValue(raw.baselineTarget),
      motionIntensity:numberValue(raw.motionIntensity),
      elapsedTime:numberValue(raw.elapsedTime),
      isRunning:runningValue
    };
  }
  function acceptWatchSnapshot(rawSnapshot: WatchSignalSnapshot) {
    const snapshot = normalizeWatchSnapshot(rawSnapshot);
    const incomingTime = snapshot.timestamp ? new Date(snapshot.timestamp).getTime() : Number.NaN;
    const currentTime = watchSnapshot.timestamp ? new Date(watchSnapshot.timestamp).getTime() : Number.NaN;
    if (Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime < currentTime) return;
    if (!snapshot.isRunning) {
      watchSnapshot = {
        ...snapshot,
        bpm:undefined,
        baselineBPM:undefined,
        baselineSampleCount:0
      };
      recentLiveHeartRates = [];
      lastAnalyzedTimestamp = '';
      analysisSnapshot = watchSnapshot;
      return;
    }
    // During an active session, a transport-level status packet must not erase
    // the last physiological reading. Only explicitly present values replace it.
    watchSnapshot = {
      ...watchSnapshot,
      ...snapshot,
      bpm:snapshot.bpm ?? watchSnapshot.bpm,
      baselineBPM:snapshot.baselineBPM ?? watchSnapshot.baselineBPM,
      baselineSampleCount:snapshot.baselineSampleCount ?? watchSnapshot.baselineSampleCount
    };
    if (typeof snapshot.bpm === 'number' && snapshot.timestamp && snapshot.timestamp !== lastAnalyzedTimestamp) {
      lastAnalyzedTimestamp = snapshot.timestamp;
      recentLiveHeartRates = [...recentLiveHeartRates.slice(-4), snapshot.bpm];
    }
    const ordered = [...recentLiveHeartRates].sort((a, b) => a - b);
    const smoothedBPM = ordered.length ? ordered[Math.floor(ordered.length / 2)] : snapshot.bpm;
    analysisSnapshot = { ...watchSnapshot, bpm:smoothedBPM };
    if ((watchCalibrationState === 'starting' || watchCalibrationState === 'running') && watchSnapshot.isRunning) {
      watchCalibrationState = 'running';
      watchCalibrationMessage = calibrationProgressMessage();
    }
    if (watchCalibrationState === 'running' && typeof watchSnapshot.baselineBPM === 'number') {
      watchCalibration = { baselineBPM:watchSnapshot.baselineBPM, completedAt:new Date().toISOString() };
      localStorage.setItem(watchCalibrationKey, JSON.stringify(watchCalibration));
      watchCalibrationState = 'complete';
      watchCalibrationMessage = `Calibration saved at ${Math.round(watchSnapshot.baselineBPM)} bpm.`;
    }
  }
  function checkInTime(timestamp: string) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
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
    const routes: Record<string, string> = {
      'Breathing':'/breathing',
      'Mindfulness':'/mindfulness',
      'Standard Grounding':'/grounding'
    };
    if (name === 'Creative Digital Grounding' || name === 'Digital Grounding') startDigital();
    else if (routes[name]) location.href = routes[name];
  }
  function startRecommendedIntervention(type: InterventionType) {
    if (type === 'Creative Digital Grounding') {
      startDigital();
      return;
    }
    chooseMethod(type);
  }
  function cadenceLabel(minutes: number) {
    return minutes <= 5 ? 'Check again in about 5 minutes' : `Check again in about ${minutes} minutes`;
  }
  async function removeRoll(roll: SoundRoll) { await deleteRoll(roll.id); rolls = rolls.filter(item => item.id !== roll.id); }
  async function removeSticker(sticker: SavedSticker) { await deleteSticker(sticker.id); stickers = stickers.filter(item => item.id !== sticker.id); }
  async function removeJournal(journal: SavedJournal) { await deleteJournal(journal.id); journals = journals.filter(item => item.id !== journal.id); }
  function readStickerImage(file: File) {
    return new Promise<{ image:string; aspectRatio:number }>((resolve, reject) => {
      const source = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const maxDimension = 1600;
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight, 1));
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('This device could not prepare the sticker image.');
          context.drawImage(image, 0, 0, width, height);
          const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          resolve({ image:canvas.toDataURL(outputType, .9), aspectRatio:width / height });
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(source);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(source);
        reject(new Error('That image could not be read. Try a PNG, JPG, or WebP file.'));
      };
      image.src = source;
    });
  }
  async function makeStickerFromPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || isPreparingStickerPhoto) return;
    isPreparingStickerPhoto = true;
    stickerImportMessage = '';
    stickerImportFailed = false;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) {
        throw new Error('Choose a PNG, JPG, or WebP image.');
      }
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
      const prepared = await readStickerImage(file);
      sessionStorage.setItem('grounding-sticker-source', prepared.image);
      window.location.href = '/?start=sticker&return=archive';
    } catch (error) {
      stickerImportFailed = true;
      stickerImportMessage = error instanceof Error ? error.message : 'The photo could not be prepared.';
    } finally {
      isPreparingStickerPhoto = false;
    }
  }
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
    return new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric', year:'numeric' }).format(created);
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
    healthRange = 'month';
    detailHealthTrends = healthTrends;
    selectedHealthPoint = null;
    setTimeout(() => document.querySelector<HTMLElement>('#health-detail-heading')?.focus(), 0);
  }
  function closeHealthMetric() {
    const key = selectedHealthKey;
    selectedHealthKey = null;
    detailHealthTrends = null;
    selectedHealthPoint = null;
    if (key) setTimeout(() => document.querySelector<HTMLElement>(`[data-health-key="${key}"]`)?.focus(), 0);
  }
  function healthChart(metric: TrendMetric | undefined) {
    const rawSeries = metric?.series ?? [];
    const step = Math.max(1, Math.ceil(rawSeries.length / 365));
    const series = step === 1 ? rawSeries : rawSeries.filter((_, index) => index % step === 0 || index === rawSeries.length - 1);
    if (!series.length) return { points:'', chartPoints:[] as ChartPoint[], baselineY:null as number | null, minimum:0, maximum:0, lastX:0, lastY:0 };
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
    const chartPoints = series.map((point, index) => ({ ...point, x:x(index), y:y(point.value) }));
    return {
      points: chartPoints.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
      chartPoints,
      baselineY: typeof metric?.baseline === 'number' ? y(metric.baseline) : null,
      minimum,
      maximum,
      lastX: x(series.length - 1),
      lastY: y(series[series.length - 1].value)
    };
  }
  function healthChartAnchors() {
    const points = selectedHealthChart.chartPoints;
    if (points.length <= 7) return points;
    return Array.from({ length:6 }, (_, index) => points[Math.round(index * (points.length - 1) / 5)]);
  }
  function selectNearestHealthPoint(event: PointerEvent) {
    const points = selectedHealthChart.chartPoints;
    if (!points.length) return;
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const chartX = Math.max(14, Math.min(286, (event.clientX - bounds.left) / bounds.width * 300));
    selectedHealthPoint = points.reduce((nearest, point) =>
      Math.abs(point.x - chartX) < Math.abs(nearest.x - chartX) ? point : nearest
    );
  }
  function startHealthChartScrub(event: PointerEvent) {
    event.preventDefault();
    isScrubbingHealthChart = true;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    selectNearestHealthPoint(event);
  }
  function moveHealthChartScrub(event: PointerEvent) {
    if (!isScrubbingHealthChart) return;
    event.preventDefault();
    selectNearestHealthPoint(event);
  }
  function endHealthChartScrub() {
    isScrubbingHealthChart = false;
  }
  function healthMetricExplanation(key: TrendMetric['key']) {
    if (key === 'hrv') return 'HRV is the variation in time between heartbeats. Your own pattern matters more than a single value.';
    if (key === 'restingHeartRate') return 'Resting heart rate is your heart rate during quiet, inactive periods.';
    if (key === 'respiratoryRate') return 'Respiratory rate is the number of breaths per minute, often measured during sleep.';
    if (key === 'mindfulMinutes') return 'Time logged as mindful sessions in Apple Health.';
    if (key === 'sleepDuration') return 'Estimated time asleep, grouped by wake-up day.';
    return 'Nightly wrist temperature relative to the watch sensor. It can shift for many everyday reasons.';
  }
  async function selectHealthRange(range: HealthRange) {
    healthRange = range;
    selectedHealthPoint = null;
    detailHealthLoading = true;
    detailHealthTrends = await getHealthTrends(healthRanges.find(item => item.id === range)?.days ?? 30);
    detailHealthLoading = false;
  }
  function chartDay(day: string) {
    return new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric' }).format(new Date(`${day}T12:00:00`));
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
    if (event.key !== 'Escape') return;
    if (feelingDetailOpen) closeFeelingDetails();
    else if (selectedHealthKey) closeHealthMetric();
    else if (watchConnectionOpen) closeWatchConnection();
  }
  function healthValue(metric: TrendMetric | undefined) {
    if (!metric?.available || metric.latest === null) return '—';
    const maximumFractionDigits = metric.key === 'respiratoryRate' ? 1 : 0;
    return new Intl.NumberFormat(appLocale, { maximumFractionDigits }).format(metric.latest);
  }
  function healthDay(metric: TrendMetric | undefined) {
    if (!metric?.latestDay) return 'No recent reading';
    return new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric' }).format(new Date(`${metric.latestDay}T12:00:00`));
  }
  function healthDescription(key: TrendMetric['key']) {
    const metric = healthMetric(key);
    return metric?.available ? describeDeviation(metric) : 'No recent reading yet.';
  }
  function practiceSessions() {
    const digital = journals.map(journal => ({ mode:'digital' as const, completedAt:journal.created }));
    return [...guidedSessions, ...digital].sort((a, b) => b.completedAt - a.completedAt);
  }
  function sessionName(mode: GuidedSession['mode'] | 'digital') {
    return mode === 'digital' ? 'Digital Grounding' : mode === 'grounding' ? '5–4–3–2–1 Grounding' : mode[0].toUpperCase() + mode.slice(1);
  }
  function sessionWhen(timestamp: number) {
    const today = localDay(new Date());
    return `${localDay(timestamp) === today ? 'Today' : new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric' }).format(timestamp)} · ${new Intl.DateTimeFormat(appLocale, { hour:'numeric', minute:'2-digit' }).format(timestamp)}`;
  }
  function weeklySessionCounts() {
    const formatter = new Intl.DateTimeFormat(appLocale, { weekday:'narrow' });
    return Array.from({ length:7 }, (_, index) => {
      const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate() - (6 - index));
      const day = localDay(date);
      return { label:formatter.format(date), count:practiceSessions().filter(item => localDay(item.completedAt) === day).length };
    });
  }
  function healthUpdatedAt() {
    if (!healthTrends || healthTrends.generatedAt === new Date(0).toISOString()) return '';
    const date = new Date(healthTrends.generatedAt);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(appLocale, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
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
    if (healthPanelOpen) {
      watchConnectionOpen = false;
      revealHealthPanel();
    }
  }
  function openHealthSetup() {
    watchConnectionOpen = false;
    healthPanelOpen = true;
    selectTab('profile');
    revealHealthPanel(true);
  }
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(moodStorageKey) ?? 'null');
      if (saved?.day === localDay(new Date()) && moodOptions.some(option => option.id === saved.mood)) selectedMood = saved.mood;
      moodHistory = JSON.parse(localStorage.getItem(moodHistoryKey) || '[]');
      guidedSessions = JSON.parse(localStorage.getItem('grounding.guidedSessions') || '[]');
      watchCalibration = JSON.parse(localStorage.getItem(watchCalibrationKey) || 'null');
    } catch { /* Ignore an invalid local check-in. */ }
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
            acceptWatchSnapshot(snapshot);
            watchAvailability = {
              ...watchAvailability,
              available:true,
              activated:true,
              paired:true,
              watchAppInstalled:true,
              reachable:true
            };
          }),
          onWatchAvailabilityChanged(availability => watchAvailability = availability)
        ]);
        if (watchListenersDisposed) {
          handles.forEach(handle => void handle?.remove());
        } else {
          handles.forEach(handle => { if (handle) watchListenerHandles.push(handle); });
        }
        const [availability, latestSnapshot] = await Promise.all([
          getWatchAvailability(), getLatestWatchSignal()
        ]);
        watchAvailability = availability;
        acceptWatchSnapshot(latestSnapshot);
        if (watchSnapshot.kind === 'snapshot') {
          watchAvailability = { ...watchAvailability, paired:true, watchAppInstalled:true };
        }
      } catch {
        watchAvailability = { available:true, activated:false, paired:false, watchAppInstalled:false, reachable:false };
      }
    }
    void initializeWatch();
    const watchRefreshTimer = window.setInterval(async () => {
      if (!isWatchSignalNative() || watchRequestInFlight) return;
      watchRequestInFlight = true;
      try {
        const snapshot = await requestLatestWatchSignal();
        if (snapshot.kind === 'snapshot') acceptWatchSnapshot(snapshot);
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
        <header class="page-header">
          <div><p class="eyebrow">{todayLabel()}</p><h1>{greeting()}</h1></div>
          {#if isWatchSignalNative()}
            <button
              class:active={watchAvailability.reachable || watchSnapshot.isRunning}
              class="watch-connection-tab"
              aria-label={`Apple Watch settings. ${watchLiveLabel()}`}
              onclick={openWatchSettings}
            >
              <span class="watch-connection-icon" aria-hidden="true"><AppIcon name="watch" size={18}/><i></i></span>
              <span><small>Apple Watch</small><strong>{watchLiveLabel()}</strong></span>
            </button>
          {:else}
            <div class="avatar" aria-hidden="true"></div>
          {/if}
        </header>
        <section class:unavailable={homeContext.level === 'unavailable'} class:mild={homeContext.level === 'mild'} class:elevated={homeContext.level === 'elevated'} class="state-card" aria-labelledby="today-heading">
          <button class="state-card-trigger" aria-haspopup="dialog" aria-expanded={feelingDetailOpen} onclick={openFeelingDetails}>
            <p class="eyebrow">Today · {homeContext.source}</p>
            <h2 id="today-heading">{homeContext.label}</h2>
            <p>{homeContext.summary}</p>
            <span class="state-card-explain">See why <AppIcon name="chevron" size={14}/></span>
          </button>
        </section>
        <section class="mood-checkin" aria-labelledby="mood-checkin-heading">
          <div><p class="eyebrow">Check in</p><h2 id="mood-checkin-heading">How are you feeling?</h2><p>Your answer comes first.</p></div>
          <div class="mood-options" role="group" aria-label="How are you feeling today?">
            {#each moodOptions as mood}
              <button class:active={selectedMood === mood.id} aria-pressed={selectedMood === mood.id} onclick={() => selectMood(mood.id)}>{mood.label}</button>
            {/each}
          </div>
          {#if selectedMood}<button class="clear-checkin" onclick={() => { selectedMood = null; localStorage.removeItem(moodStorageKey); }}>Use body context instead</button>{/if}
        </section>
        <section class:prominent={homeContext.level === 'elevated'} class="focus-card">
          <div class="focus-copy">
            <p class="eyebrow">Suggested for today</p>
            <h2>{homeContext.type}</h2>
            <p>{selectedMood ? 'Based on your check-in.' : 'Based on your recent patterns.'}</p>
            <button class="primary" onclick={() => startRecommendedIntervention(homeContext.type)}>Start</button>
          </div>
          <div class="paper-motif" aria-hidden="true"><i></i><i></i><b></b></div>
        </section>
        {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      {:else if tab === 'history'}
        <header class="page-header"><div><p class="eyebrow">Your patterns</p><h1>History</h1></div></header>
        <section class="summary-card"><div><strong>{practiceSessions().length}</strong><span>practices</span></div><div><strong>{practiceSessions().filter(item => Date.now() - item.completedAt < 7 * 86400000).length}</strong><span>this week</span></div><div><strong>{journals.length}</strong><span>journal pages</span></div></section>
        <section class="health-card" aria-labelledby="recent-health-heading">
          <div class="health-card-header">
            <div class="health-title"><span class="health-icon" aria-hidden="true"><AppIcon name="heart"/></span><div><p class="eyebrow">Apple Health</p><h2 id="recent-health-heading">Health context</h2></div></div>
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
            <div class="health-card-footer"><p>Recent values are compared with your 14-day baseline.</p><span>{healthUpdatedAt() ? `Updated ${healthUpdatedAt()}` : ''}</span></div>
          {:else if healthState === 'empty'}
            <div class="health-empty"><strong>Access is set up, waiting for recent readings.</strong><p>Wear your watch as usual or add a mindful session. New data will appear here when Apple Health has it.</p></div>
          {:else if healthState === 'checking' || healthState === 'loading' || healthState === 'connecting'}
            <div class="health-empty loading"><span class="loading-dot" aria-hidden="true"></span><strong>{healthState === 'connecting' ? 'Waiting for your choice…' : 'Checking recent data…'}</strong><p>This usually takes only a moment.</p></div>
          {:else if healthState === 'unavailable'}
            <div class="health-empty"><strong>Recent health context is available in the iPhone app.</strong><p>Your check-ins and grounding history still work on this device.</p></div>
          {:else}
            <div class="health-empty"><strong>{healthState === 'ready' ? 'Connect Apple Health to add personal context.' : 'Recent data could not be loaded.'}</strong><p>Grounding only reads the signals you choose, and the app remains useful without them.</p></div>
          {/if}
          {#if healthState === 'connected' || healthState === 'empty'}
            <div class="ecg-summary" class:unavailable={!healthTrends?.ecg?.available}>
              <div>
                <strong>ECG recordings</strong>
                <span>{healthTrends?.ecg?.available ? `${healthTrends.ecg.count} available in Apple Health` : 'No readable recordings yet'}</span>
              </div>
              {#if healthTrends?.ecg?.available}
                <small>View-only · not used for today’s feeling</small>
              {:else}
                <button class="ecg-access" onclick={connectHealth}>Review ECG access</button>
              {/if}
            </div>
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
        <section class="trend-card practice-trend"><div class="section-title"><h2>Practice activity</h2><span>Last 7 days</span></div><div class="bars" aria-label="Practice sessions during the last seven days">{#each weeklySessionCounts() as day}<i style={`height:${Math.max(8, day.count * 24)}px`}><b>{day.count || ''}</b><span>{day.label}</span></i>{/each}</div><p>{practiceSessions().length ? `${practiceSessions().length} completed practice${practiceSessions().length === 1 ? '' : 's'} saved on this device.` : 'Completed practices will appear here.'}</p></section>
        <h2 class="list-heading">Recent practices</h2>
        {#if practiceSessions().length}<section class="session-list">{#each practiceSessions().slice(0, 8) as session}<article><span class={`method-dot ${session.mode}`}></span><div><strong>{sessionName(session.mode)}</strong><small>{sessionWhen(session.completedAt)}</small></div></article>{/each}</section>{:else}<p class="collection-empty">No completed practices yet.</p>{/if}
        <section class="watch-checkins" aria-labelledby="phone-checkins-heading">
          <div class="section-title"><div><p class="eyebrow">From your check-ins</p><h2 id="phone-checkins-heading">Feeling records</h2></div><span>{moodHistory.length}</span></div>
          {#if moodHistory.length}<div class="watch-checkin-list">{#each moodHistory.slice(0, 7) as entry}<article><strong>{moodOptions.find(item => item.id === entry.mood)?.label?.slice(0, 1)}</strong><div><span>{moodOptions.find(item => item.id === entry.mood)?.label}</span><small>{sessionWhen(entry.timestamp)}</small></div></article>{/each}</div>{:else}<p class="collection-empty">Your phone check-ins will appear here.</p>{/if}
        </section>
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
          <div class="collection-heading">
            <div><p class="eyebrow">Reusable visual pieces</p><h2>Sticker Collection</h2></div>
            <div class="collection-actions">
              <span>{stickers.length}</span>
              <label class="sticker-upload" class:disabled={isPreparingStickerPhoto}>
                {isPreparingStickerPhoto ? 'Preparing…' : 'Upload photo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload photo to make a sticker" onchange={makeStickerFromPhoto} disabled={isPreparingStickerPhoto}/>
              </label>
            </div>
          </div>
          {#if stickerImportMessage}<p class:error={stickerImportFailed} class="sticker-import-message" role={stickerImportFailed ? 'alert' : 'status'}>{stickerImportMessage}</p>{/if}
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
          {#if isWatchSignalNative()}
            <button class="settings-row" onclick={toggleWatchConnection} aria-expanded={watchConnectionOpen} aria-controls="watch-connection-panel">
              <AppIcon name="watch"/><div><strong>Apple Watch</strong><small>{watchLiveLabel()}{watchCalibration ? ` · calibrated ${sessionWhen(new Date(watchCalibration.completedAt).getTime())}` : ''}</small></div><span class="row-end">{#if watchAvailability.reachable || watchSnapshot.isRunning}<i class="status-dot" aria-hidden="true"></i>{/if}<AppIcon name="chevron"/></span>
            </button>
          {/if}
        </section>
        {#if healthPanelOpen}
          <section class="health-permission-card" id="health-permission-panel" aria-labelledby="health-permission-heading">
            <div class="permission-heading"><div><p class="eyebrow">Optional context</p><h2 id="health-permission-heading" tabindex="-1">Connect Apple Health</h2></div><button class="text-button" onclick={() => healthPanelOpen = false}>Close</button></div>
            <p>With your permission, Grounding can compare a few recent signals with your own baseline and make exercise suggestions feel more relevant.</p>
            <ul>
              <li>Heart-rate variability</li><li>Resting heart rate</li><li>Respiratory rate</li><li>Sleep duration</li><li>Wrist temperature</li><li>Mindful minutes</li><li>Existing ECG records</li>
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
        {#if watchConnectionOpen && isWatchSignalNative()}
          <section id="watch-connection-panel" class="watch-connection-panel watch-settings-panel" aria-labelledby="watch-connection-heading">
            <div class="watch-connection-copy">
              <div><p class="eyebrow">Apple Watch</p><h2 id="watch-connection-heading">Connection · {watchStatusLabel()}</h2></div>
              <button class="watch-connection-close" aria-label="Close Watch settings" onclick={closeWatchConnection}>×</button>
            </div>
            <p class:success={watchConnectionState === 'success'} class:error={watchConnectionState === 'error'} role="status" aria-live="polite">{watchConnectionMessage || watchStatusDescription()}</p>
            <button class="watch-test-button" disabled={watchConnectionState === 'testing'} onclick={testWatchConnection}>{watchConnectionState === 'testing' ? 'Testing…' : 'Test connection'}</button>

            <div class="calibration-card">
              <div><p class="eyebrow">Calibration session</p><h3>{watchCalibration ? `${Math.round(watchCalibration.baselineBPM)} bpm baseline` : 'Build a resting baseline'}</h3></div>
              <p>A short Watch reading gives Grounding a reference without starting an exercise first.</p>
              {#if watchCalibrationState === 'running'}
                <div class="calibration-reading"><strong>{typeof watchSnapshot.bpm === 'number' ? Math.round(watchSnapshot.bpm) : '—'}</strong><span>bpm · live from Watch</span></div>
                <div class="calibration-progress" aria-label={`${baselineSampleCount()} of ${baselineTarget()} calibration readings`}><i style={`width:${(baselineSampleCount() / baselineTarget()) * 100}%`}></i></div>
                <small>{baselineSampleCount()} of {baselineTarget()} still readings · keep still</small>
              {:else if watchCalibration}
                <small>Last calibrated {sessionWhen(new Date(watchCalibration.completedAt).getTime())}</small>
              {/if}
              {#if watchCalibrationMessage}<p class:error={watchCalibrationState === 'error'} class:success={watchCalibrationState === 'complete'} class="calibration-message" role="status" aria-live="polite">{watchCalibrationMessage}</p>{/if}
              {#if watchCalibrationState === 'starting' || watchCalibrationState === 'running'}
                <button class="watch-test-button" onclick={cancelWatchCalibration}>{watchCalibrationState === 'starting' ? 'Starting…' : 'Cancel calibration'}</button>
              {:else}
                <button class="primary calibration-action" onclick={startWatchCalibration}>{watchCalibration ? 'Calibrate again' : 'Start calibration'}</button>
              {/if}
            </div>
          </section>
        {/if}
        <h2 class="list-heading">App preferences</h2><section class="settings-list"><article><span class="setting-icon">Aa</span><div><strong>Text and accessibility</strong><small>System text size · reduced motion</small></div><AppIcon name="chevron"/></article><article><span class="setting-icon">↕</span><div><strong>Display orientation</strong><small>Portrait on phone · adaptive on iPad and web</small></div><span>Portrait</span></article></section>
      {/if}
    </div>
  </main>
  {#if feelingDetailOpen}
    <div class="health-detail-layer" role="presentation">
      <button class="health-detail-scrim" aria-label="Close today’s feeling details" onclick={closeFeelingDetails}></button>
      <div class="health-detail-sheet feeling-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="feeling-detail-heading" aria-describedby="feeling-detail-description">
        <div class="health-detail-handle" aria-hidden="true"></div>
        <header>
          <div><p class="eyebrow">Today’s feeling · Why this conclusion</p><h2 id="feeling-detail-heading" tabindex="-1">{homeContext.label}</h2></div>
          <button class="health-detail-close" onclick={closeFeelingDetails} aria-label="Close today’s feeling details"><span aria-hidden="true">×</span></button>
        </header>

        <div class="feeling-conclusion" class:mild={homeContext.level === 'mild'} class:elevated={homeContext.level === 'elevated'}>
          <span>Conclusion</span>
          <p id="feeling-detail-description">{homeContext.summary}</p>
          <small>{homeContext.source}</small>
        </div>

        <section class="feeling-method" aria-labelledby="feeling-method-heading">
          <h3 id="feeling-method-heading">How it works</h3>
          <p>{selectedMood ? 'Your check-in sets the result. Health data stays in the background.' : 'Recent HRV, resting heart rate, and breathing rate are compared with your own 14-day baseline. Sleep, wrist temperature, and mindful minutes are shown only as context.'}</p>
        </section>

        <section class="feeling-evidence" aria-labelledby="feeling-evidence-heading">
          <div class="feeling-section-heading"><h3 id="feeling-evidence-heading">Data considered</h3><span>{selectedMood ? 'Check-in first' : 'Health context'}</span></div>
          {#if selectedMood}
            <article class="primary-evidence">
              <div><strong>Your check-in</strong><span>Primary source</span></div>
              <p>{moodOptions.find(option => option.id === selectedMood)?.label}</p>
              <small>Selected today.</small>
            </article>
          {/if}
          {#if healthTrends && availableMetrics(healthTrends).length}
            {#each availableMetrics(healthTrends) as metric}
              <article>
                <div><strong>{healthMetricDetails.find(item => item.key === metric.key)?.label}</strong><span>{feelingMetricRole(metric)}</span></div>
                <p>{feelingMetricValue(metric)}</p>
                <small>{feelingMetricReason(metric)}</small>
              </article>
            {/each}
          {:else if !selectedMood}
            <div class="health-detail-empty"><strong>No usable body context yet</strong><p>Add a check-in or try again after Apple Health has more data.</p></div>
          {/if}
        </section>

        {#if healthUpdatedAt()}<p class="feeling-updated">Health context refreshed {healthUpdatedAt()}</p>{/if}
      </div>
    </div>
  {/if}
  {#if selectedHealthKey && selectedHealthDetails}
    <div class="health-detail-layer" role="presentation">
      <button class="health-detail-scrim" aria-label="Close health history" onclick={closeHealthMetric}></button>
      <div class="health-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="health-detail-heading">
        <div class="health-detail-handle" aria-hidden="true"></div>
        <header>
          <div><p class="eyebrow">Apple Health</p><h2 id="health-detail-heading" tabindex="-1">{selectedHealthDetails.label}</h2></div>
          <button class="health-detail-close" onclick={closeHealthMetric} aria-label="Close health history"><span aria-hidden="true">×</span></button>
        </header>
        <p class="health-intro">{healthMetricExplanation(selectedHealthKey)}</p>
        <div class="health-range" aria-label="History range">{#each healthRanges as range}<button class:active={healthRange === range.id} aria-pressed={healthRange === range.id} onclick={() => selectHealthRange(range.id)}>{range.label}</button>{/each}</div>
        {#if detailHealthLoading}
          <div class="health-detail-empty"><strong>Loading history…</strong></div>
        {:else if selectedHealthMetric?.available && selectedHealthMetric.series.length}
          <div class="health-detail-summary">
            <div><span>Latest</span><strong>{healthValue(selectedHealthMetric)}</strong><small>{selectedHealthDetails.unit}</small></div>
            <div><span>Personal baseline</span><strong>{selectedHealthMetric.baseline === null ? '—' : new Intl.NumberFormat(appLocale, { maximumFractionDigits:1 }).format(selectedHealthMetric.baseline)}</strong><small>{selectedHealthDetails.unit}</small></div>
          </div>
          <div class="health-line-chart">
            <div class="chart-scale"><span>{selectedHealthChart.maximum.toFixed(0)}</span><span>{selectedHealthChart.minimum.toFixed(0)}</span></div>
            <svg
              viewBox="0 0 300 128"
              role="img"
              aria-label={`${selectedHealthDetails.label} history. Slide across the chart to inspect the nearest reading. ${healthChartSummary(selectedHealthMetric)}`}
              onpointerdown={startHealthChartScrub}
              onpointermove={moveHealthChartScrub}
              onpointerup={endHealthChartScrub}
              onpointercancel={endHealthChartScrub}
              onlostpointercapture={endHealthChartScrub}
            >
              <path class="chart-grid" d="M14 12H286M14 64H286M14 116H286"/>
              {#if selectedHealthChart.baselineY !== null}<path class="chart-baseline" d={`M14 ${selectedHealthChart.baselineY}H286`}/>{/if}
              <polyline points={selectedHealthChart.points}/>
              {#each healthChartAnchors() as point}
                <circle class="chart-anchor" cx={point.x} cy={point.y} r="3"/>
              {/each}
              {#each selectedHealthChart.chartPoints.filter(point => point.day === selectedHealthPoint?.day) as point}
                <path class="chart-selection-line" d={`M${point.x} 12V116`}/>
                <circle class="selected" cx={point.x} cy={point.y} r="6"/>
              {/each}
            </svg>
            <div class="chart-dates"><span>{chartDay(selectedHealthMetric.series[0].day)}</span><span>{chartDay(selectedHealthMetric.series[selectedHealthMetric.series.length - 1].day)}</span></div>
          </div>
          {#if selectedHealthPoint}<p class="health-point-value"><strong>{chartDay(selectedHealthPoint.day)}</strong><span>{new Intl.NumberFormat(appLocale, { maximumFractionDigits:1 }).format(selectedHealthPoint.value)} {selectedHealthDetails.unit}</span></p>{/if}
          <p class="health-chart-summary">{healthChartSummary(selectedHealthMetric)} Slide across the chart to inspect each reading.</p>
        {:else}
          <div class="health-detail-empty">
            <strong>No recorded history yet</strong>
            <p>Apple Health did not return a reading for this range.</p>
          </div>
        {/if}
        {#if selectedHealthMetric?.series.length}
          <div class="health-reading-list" aria-label="Recent recorded values">
            <strong>Recent readings</strong>
            {#each selectedHealthMetric.series.slice(-7).reverse() as point}
              <button type="button" class:selected={selectedHealthPoint?.day === point.day} onclick={() => selectedHealthPoint = point}><span>{chartDay(point.day)}</span><span>{new Intl.NumberFormat(appLocale, { maximumFractionDigits:1 }).format(point.value)} {selectedHealthDetails.unit}</span></button>
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
  .app-shell{--bg:#f7f1e7;--surface:#fffdf9;--cream:#f1e7d6;--border:#ded6c9;--muted:#6f716b;--sun:#efb23e;--sun-soft:#fcecc6;--teal:#ddebe6;--coral:#efc5b5;min-height:100dvh;background:var(--bg);position:relative;overflow:hidden}.app-scroll{height:100dvh;overflow-y:auto;overscroll-behavior-y:contain;scrollbar-width:none;padding:0 max(env(safe-area-inset-right),0px) calc(100px + env(safe-area-inset-bottom)) max(env(safe-area-inset-left),0px)}.app-scroll::-webkit-scrollbar{display:none}.page{width:min(100%,680px);min-height:100%;margin:auto;padding:calc(22px + env(safe-area-inset-top)) 24px 34px}.page-header{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.page-header>div:first-child{min-width:0}.page-header h1{font-size:28px;line-height:1.2;margin:0;font-weight:750;letter-spacing:-.025em}.eyebrow{text-transform:uppercase;letter-spacing:.11em;font-size:10px;font-weight:650;color:#b26e54;margin:0 0 7px}.avatar{width:32px;height:32px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#fff8df 0 18%,transparent 19%),linear-gradient(145deg,#f0b33f 0 46%,#dcebe6 47%);border:1px solid #d6c8b6}.avatar.large{width:48px;height:48px}.watch-connection-tab{min-height:48px;flex:none;padding:6px 10px 6px 7px;border:1px solid var(--border);border-radius:17px;background:var(--surface);display:flex;align-items:center;gap:8px;text-align:left;color:#31332f;cursor:pointer;touch-action:manipulation}.watch-connection-tab:active{opacity:.72}.watch-connection-tab.active{border-color:#a9c7bd;background:var(--teal)}.watch-connection-icon{position:relative;width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:var(--cream)}.watch-connection-icon i{position:absolute;right:3px;bottom:3px;width:8px;height:8px;border:2px solid var(--surface);border-radius:50%;background:#aaa59d}.watch-connection-tab.active .watch-connection-icon{background:#f7fbf9}.watch-connection-tab.active .watch-connection-icon i{background:#3f9187}.watch-connection-tab>span:last-child{display:flex;flex-direction:column;gap:1px}.watch-connection-tab small{font-size:8px;line-height:1.2;color:var(--muted)}.watch-connection-tab strong{font-size:10px;line-height:1.25}.watch-connection-panel{margin:-6px 0 14px;padding:15px;border:1px solid var(--border);border-radius:19px;background:var(--surface);box-shadow:0 10px 30px #51473512}.watch-connection-copy{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.watch-connection-copy h2{font-size:15px}.watch-connection-close{width:44px;height:44px;margin:-10px -10px 0 0;border:0;background:transparent;border-radius:50%;font-size:24px;line-height:1;color:var(--muted);cursor:pointer}.watch-connection-panel>p{min-height:34px;margin:8px 0 11px;color:var(--muted);font-size:12px;line-height:1.45}.watch-connection-panel>p.success{color:#356c61}.watch-connection-panel>p.error{color:#a34b3b}.watch-test-button{min-height:44px;padding:0 16px;border:1px solid #9d9f98;border-radius:14px;background:transparent;color:#282b27;font-weight:700;cursor:pointer}.watch-test-button:disabled{opacity:.55;cursor:default}
  h2{margin:0}.state-card,.focus-card,.summary-card,.trend-card,.health-card,.profile-card,.settings-list,.session-list{border:1px solid var(--border);background:var(--surface);border-radius:22px}.state-card{padding:8px 10px 8px 13px;display:flex;align-items:center;gap:10px;justify-content:space-between;border-left:5px solid #7aa59d}.state-card-trigger{min-width:0;flex:1;min-height:132px;padding:10px 5px;border:0;border-radius:16px;background:transparent;text-align:left;cursor:pointer;touch-action:manipulation}.state-card-trigger:active{background:#f7f1e7}.state-card.unavailable{border-left-color:#bbb3a7}.state-card.mild{border-left-color:var(--sun)}.state-card.elevated{border-left-color:#c46f57}.state-card h2{font-size:19px;margin-bottom:7px}.state-card-trigger>p:last-of-type,.focus-card p,.trend-card p,.profile-card p,.archive-hero p{font-size:13px;line-height:1.55;color:var(--muted);margin:0}.state-card-explain{min-height:32px;margin-top:10px;display:inline-flex;align-items:center;gap:4px;color:#466b64;font-size:10px;font-weight:750}.state-card-explain :global(svg){transform:rotate(-90deg)}.focus-card{margin-top:14px;padding:21px;background:var(--coral);border:0;display:grid;grid-template-columns:1fr 110px;min-height:220px;overflow:hidden}.focus-card.prominent{box-shadow:inset 5px 0 0 #b65f49}.focus-copy{position:relative;z-index:2}.focus-card h2{font-size:23px;line-height:1.2;margin:5px 0 9px}.primary{min-height:52px;padding:0 20px;border:0;border-radius:16px;background:var(--sun);font-weight:700;cursor:pointer;touch-action:manipulation}.primary:active{opacity:.72}.primary:disabled{cursor:default;opacity:.55}.focus-card .primary{margin-top:17px}.policy-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}.policy-meta span{padding:6px 8px;border-radius:999px;background:#fffdf980;font-size:9px;font-weight:700;text-transform:capitalize;color:#655f58}.paper-motif{position:relative;min-height:130px}.paper-motif i,.paper-motif b{position:absolute;display:block;width:82px;height:72px;border-radius:18px;transform:rotate(8deg);background:var(--sun-soft);top:35px;left:0}.paper-motif i:nth-child(2){background:var(--teal);transform:rotate(-8deg);left:35px;top:20px}.paper-motif b{width:45px;height:45px;border-radius:50%;background:var(--sun);left:70px;top:63px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:26px 0 10px}.section-title h2,.list-heading{font-size:17px}.section-title button{border:0;background:none;color:var(--muted);font-size:12px}.task-list,.session-list,.settings-list{overflow:hidden}.task-list article,.session-list article,.settings-list article{min-height:67px;padding:12px 15px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}.task-list article:last-child,.session-list article:last-child,.settings-list article:last-child{border:0}.task-list div,.session-list div,.settings-list div{display:flex;flex:1;flex-direction:column;gap:3px}.task-list span,.session-list small,.settings-list small,.settings-list article>span{font-size:11px;color:var(--muted)}
  .mood-checkin{margin-top:12px;padding:18px;border:1px solid var(--border);border-radius:22px;background:var(--surface)}.mood-checkin h2{font-size:17px}.mood-checkin>div:first-child>p:last-child{margin:6px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}.mood-options{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.mood-options button{min-height:44px;padding:0 14px;border:1px solid var(--border);border-radius:14px;background:var(--cream);font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation}.mood-options button:active{opacity:.68}.mood-options button.active{border-color:#4f827b;background:var(--teal);color:#355f59;box-shadow:inset 0 0 0 1px #4f827b}.clear-checkin{min-height:44px;margin-top:8px;padding:0;border:0;background:transparent;color:#52645f;font-size:10px;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
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
  .collection-actions{display:flex;align-items:center;gap:8px}.collection-actions>span{min-width:30px;height:30px;border-radius:15px;background:var(--cream);display:grid;place-items:center;font-size:11px;font-weight:700}.sticker-upload{position:relative;min-height:44px;padding:0 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation}.sticker-upload:active{opacity:.66}.sticker-upload.disabled{cursor:default;opacity:.55}.sticker-upload input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.sticker-import-message{margin:10px 0 12px;padding:10px 12px;border-radius:13px;background:#e3efea;color:#355f59;font-size:11px;line-height:1.45}.sticker-import-message.error{background:#f7e2dc;color:#873e34}
  .health-detail-layer{position:fixed;z-index:90;inset:0;display:flex;align-items:flex-end;justify-content:center}.health-detail-scrim{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;background:rgba(42,38,34,.46);cursor:pointer}.health-detail-sheet{position:relative;width:min(100%,620px);max-height:min(88dvh,760px);padding:10px 22px calc(26px + env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:var(--surface);overflow-y:auto;box-shadow:0 -12px 40px rgba(45,40,35,.16)}.health-detail-handle{width:38px;height:4px;margin:0 auto 13px;border-radius:999px;background:#c9c1b6}.health-detail-sheet header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.health-detail-sheet header h2{font-size:23px;line-height:1.2}.health-detail-close{width:44px;height:44px;flex:none;padding:0;border:1px solid var(--border);border-radius:50%;background:var(--surface);font-size:26px;line-height:1;cursor:pointer}.health-detail-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.health-detail-summary>div{padding:14px;border-radius:17px;background:var(--cream)}.health-detail-summary span{display:block;font-size:10px;color:var(--muted)}.health-detail-summary strong{display:inline-block;margin-top:8px;font-size:25px;font-variant-numeric:tabular-nums}.health-detail-summary small{margin-left:5px;font-size:9px;color:var(--muted)}.health-line-chart{position:relative;margin-top:18px;padding:9px 8px 0 30px;border:1px solid var(--border);border-radius:18px;background:#faf7f1}.health-line-chart svg{display:block;width:100%;height:150px;overflow:visible;cursor:ew-resize;touch-action:none}.health-line-chart polyline{fill:none;stroke:#4f827b;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.health-line-chart circle{fill:var(--sun);stroke:#fffdf9;stroke-width:3;pointer-events:none}.health-line-chart .chart-grid{fill:none;stroke:#ded6c9;stroke-width:1;pointer-events:none}.health-line-chart .chart-baseline{fill:none;stroke:#b26e54;stroke-width:1.5;stroke-dasharray:5 5;pointer-events:none}.health-line-chart .chart-selection-line{fill:none;stroke:#6b6259;stroke-width:1.25;stroke-dasharray:4 4;pointer-events:none}.health-line-chart .chart-anchor{opacity:.72}.chart-scale{position:absolute;left:7px;top:19px;bottom:30px;display:flex;flex-direction:column;justify-content:space-between;font-size:8px;color:var(--muted)}.chart-dates{display:flex;justify-content:space-between;padding:0 4px 10px;font-size:9px;color:var(--muted)}.health-chart-summary{margin:9px 2px 0;font-size:11px;line-height:1.5;color:var(--muted)}.health-source-note{margin-top:17px;padding:14px;border-radius:17px;background:var(--teal)}.health-source-note strong,.health-reading-list>strong{font-size:12px}.health-source-note p{margin:5px 0 0;font-size:11px;line-height:1.5;color:#52645f}.health-reading-list{margin-top:17px}.health-reading-list>button{width:100%;min-height:44px;padding:0;border:0;border-bottom:1px solid var(--border);background:transparent;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;cursor:pointer}.health-reading-list>button.selected{padding-inline:9px;border-radius:10px;background:var(--sun-soft)}.health-reading-list>button span:last-child{font-weight:700;font-variant-numeric:tabular-nums}
  .feeling-detail-sheet{max-height:min(90dvh,820px)}.feeling-conclusion{margin-top:18px;padding:17px;border-left:4px solid #7aa59d;border-radius:17px;background:var(--teal)}.feeling-conclusion.mild{border-left-color:var(--sun);background:var(--sun-soft)}.feeling-conclusion.elevated{border-left-color:#c46f57;background:#f7e2dc}.feeling-conclusion>span{font-size:9px;font-weight:750;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}.feeling-conclusion p{margin:7px 0 8px;font-size:13px;line-height:1.55}.feeling-conclusion small{font-size:10px;color:var(--muted)}.feeling-method,.feeling-evidence{margin-top:22px}.feeling-method h3,.feeling-section-heading h3{margin:0;font-size:14px}.feeling-method ol{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:12px}.feeling-method li{display:grid;grid-template-columns:30px 1fr;gap:11px;align-items:start}.feeling-method li>span{width:30px;height:30px;border-radius:11px;display:grid;place-items:center;background:var(--cream);font-size:11px;font-weight:750}.feeling-method strong{font-size:12px}.feeling-method p{margin:4px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}.feeling-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.feeling-section-heading>span{padding:6px 9px;border-radius:999px;background:var(--cream);font-size:9px;font-weight:700;color:var(--muted)}.feeling-evidence article{padding:13px 0;border-bottom:1px solid var(--border)}.feeling-evidence article.primary-evidence{margin-bottom:3px;padding:14px;border:1px solid #c8ddd5;border-radius:16px;background:var(--teal)}.feeling-evidence article>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.feeling-evidence article strong{font-size:12px}.feeling-evidence article>div span{flex:none;font-size:9px;font-weight:700;color:#52645f}.feeling-evidence article>p{margin:7px 0 3px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}.feeling-evidence article>small{display:block;font-size:10px;line-height:1.45;color:var(--muted)}.feeling-not-used{margin-top:20px;padding:15px;border-radius:16px;background:var(--cream)}.feeling-not-used strong{font-size:12px}.feeling-not-used p{margin:6px 0 0;font-size:10px;line-height:1.5;color:var(--muted)}.feeling-updated{margin:13px 2px 0;font-size:9px;color:var(--muted);text-align:center}
  .bottom-nav{position:fixed;z-index:20;left:max(24px,env(safe-area-inset-left));right:max(24px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));max-width:640px;margin:auto;height:72px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-radius:24px;background:rgba(241,231,214,.96);box-shadow:0 8px 24px rgba(45,40,35,.1);backdrop-filter:blur(16px)}.bottom-nav button{width:58px;height:52px;border:0;border-radius:18px;background:none;color:#72766f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}.bottom-nav button.active{background:var(--sun-soft);color:#2f302d}.bottom-nav span{font-size:9px}.desktop-rail{display:none}
  .watch-settings-panel{margin:12px 0 20px}.calibration-card{margin-top:16px;padding-top:16px;border-top:1px solid var(--border)}.calibration-card h3{margin:0;font-size:16px}.calibration-card>p:not(.eyebrow){margin:7px 0 13px;font-size:11px;line-height:1.5;color:var(--muted)}.calibration-card>small{display:block;margin:7px 0 12px;font-size:9px;color:var(--muted)}.calibration-reading{display:flex;align-items:baseline;gap:6px;margin:4px 0 10px}.calibration-reading strong{font:30px/1 Georgia,serif}.calibration-reading span{font-size:9px;color:var(--muted)}.calibration-progress{height:6px;margin-top:13px;border-radius:999px;background:var(--cream);overflow:hidden}.calibration-progress i{display:block;height:100%;border-radius:inherit;background:#4f827b;transition:width .25s ease}.calibration-message{margin:8px 0 12px!important;min-height:0!important}.calibration-message.success{color:#356c61!important}.calibration-message.error{color:#a34b3b!important}.calibration-action{min-height:44px}
  @media(max-width:374px){.page{padding-inline:18px}.page-header h1{font-size:25px}.watch-connection-tab{padding-right:8px}.watch-connection-tab small{display:none}.focus-card{grid-template-columns:1fr 80px}.state-card{gap:10px}.method-grid{gap:12px}.method-grid button{min-height:145px}.summary-card span{font-size:9px}.bottom-nav{left:12px;right:12px}.bottom-nav button{width:52px}.artifact-grid,.journal-grid,.health-grid{grid-template-columns:1fr}.health-card-header{align-items:flex-start}.health-status{max-width:92px;text-align:center}.health-permission-card ul{grid-template-columns:1fr}.health-detail-sheet{padding-inline:18px}.health-detail-summary{grid-template-columns:1fr}}
  @media(min-width:900px){.app-shell{display:grid;grid-template-columns:230px 1fr}.desktop-rail{display:flex;height:100dvh;padding:calc(32px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom));flex-direction:column;gap:8px;border-right:1px solid var(--border);background:#f3ebde}.desktop-rail strong{font-size:18px;letter-spacing:.12em;margin:0 10px 30px}.desktop-rail strong span{color:#b9785f}.desktop-rail button{height:48px;border:0;border-radius:15px;background:none;display:flex;align-items:center;gap:12px;padding:0 15px;color:var(--muted)}.desktop-rail button.active{background:var(--sun-soft);color:#2f302d}.app-scroll{padding-bottom:24px}.page{width:min(100%,820px);padding:48px}.bottom-nav{display:none}.method-grid{grid-template-columns:repeat(4,1fr)}.health-grid{grid-template-columns:repeat(4,1fr)}.focus-card{grid-template-columns:1fr 220px}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
  .health-detail-empty{margin-top:18px;padding:20px;border-radius:18px;background:var(--cream)}
  .health-detail-empty strong{font-size:14px}
  .health-detail-empty p{margin:7px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}
  .practice-trend{margin-top:14px}.bars i{flex:1;max-width:38px;min-height:8px}.bars i b{position:absolute;top:-17px;width:100%;text-align:center;font:9px/1 Manrope}.method-dot{flex:none}.method-dot.mindfulness{background:#ddd6ee}.method-dot.grounding{background:#cfdfc0}
  .ecg-summary{margin-top:12px;padding:13px;border-radius:15px;background:var(--cream);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ecg-summary.unavailable{background:#f5f2ec}.ecg-summary>div{display:flex;flex-direction:column;gap:3px}.ecg-summary strong{font-size:12px}.ecg-summary span,.ecg-summary small{font-size:9px;line-height:1.45;color:var(--muted)}.ecg-summary small{max-width:180px;text-align:right}.ecg-access{min-height:44px;flex:none;padding:0 11px;border:1px solid var(--border);border-radius:13px;background:var(--surface);font-size:9px;font-weight:700;cursor:pointer}
  .health-intro{margin:15px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}.health-range{display:flex;gap:7px;margin-top:14px}.health-range button{min-height:44px;flex:1;border:1px solid var(--border);border-radius:14px;background:var(--surface);font-size:11px;font-weight:700;cursor:pointer}.health-range button.active{background:var(--teal);border-color:#7aa59d}.health-point-value{margin:10px 0 0;padding:10px 12px;border-radius:13px;background:var(--sun-soft);display:flex;justify-content:space-between;font-size:11px}.health-line-chart circle.selected{fill:#b26e54;stroke-width:4}.feeling-method>p{margin:9px 0 0;font-size:11px;line-height:1.55;color:var(--muted)}
</style>
