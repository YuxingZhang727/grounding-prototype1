import type { TrendsPayload } from './health';
import type { WatchSignalSnapshot } from './watch-signal';

export type ArousalLevel = 'unavailable' | 'settled' | 'mild' | 'elevated';
export type EstimateConfidence = 'low' | 'medium' | 'high';
export type InterventionType =
  | 'Breathing'
  | 'Mindfulness'
  | 'Standard Grounding'
  | 'Creative Digital Grounding';

export type ArousalFactor = {
  key: 'liveHeartRate' | 'restingHeartRate' | 'hrv' | 'respiratoryRate' | 'motion';
  label: string;
  contribution: number;
  direction: 'supporting' | 'neutral' | 'confounded';
};

export type InterventionPolicy = {
  type: InterventionType;
  intensity: 'optional' | 'gentle' | 'focused';
  prominence: 'low' | 'medium' | 'high';
  repeatAfterMinutes: number;
  reason: string;
};

export type ArousalEstimate = {
  level: ArousalLevel;
  score: number | null;
  confidence: EstimateConfidence;
  label: string;
  summary: string;
  factors: ArousalFactor[];
  policy: InterventionPolicy;
  updatedAt?: string;
};

const unavailablePolicy: InterventionPolicy = {
  type: 'Creative Digital Grounding',
  intensity: 'optional',
  prominence: 'low',
  repeatAfterMinutes: 30,
  reason: 'Available whenever a grounding break would feel useful.'
};

function boundedContribution(value: number | null | undefined, bands: [number, number, number]): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  if (value >= bands[2]) return 20;
  if (value >= bands[1]) return 12;
  if (value >= bands[0]) return 6;
  return 0;
}

/**
 * A deliberately conservative, explainable prototype estimator.
 *
 * It estimates physiological arousal, not anxiety. Thresholds are product
 * heuristics and have not been clinically validated. Current heart rate is
 * compared with an in-session personal baseline; historical metrics are used
 * only as within-person context. Motion discounts the live-HR contribution.
 */
export function estimateArousal(
  live: WatchSignalSnapshot,
  trends: TrendsPayload | null,
  now = Date.now()
): ArousalEstimate {
  const timestamp = live.timestamp ? new Date(live.timestamp).getTime() : Number.NaN;
  const isFresh = Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp < 15_000;
  const hasLiveHR = live.isRunning === true && isFresh && typeof live.bpm === 'number';

  if (!hasLiveHR) {
    return {
      level: 'unavailable',
      score: null,
      confidence: 'low',
      label: 'Waiting for a current reading',
      summary: 'Start a Watch monitoring session to estimate current physiological arousal.',
      factors: [],
      policy: unavailablePolicy,
      updatedAt: live.timestamp
    };
  }

  const factors: ArousalFactor[] = [];
  const moving = (live.motionIntensity ?? 0) >= 0.16;
  let score = 0;
  let evidenceCount = 0;

  if (typeof live.baselineBPM === 'number') {
    const delta = live.bpm! - live.baselineBPM;
    let contribution = delta >= 20 ? 45 : delta >= 10 ? 30 : delta >= 5 ? 15 : 0;
    if (moving) contribution = Math.round(contribution * 0.25);
    score += contribution;
    evidenceCount += 1;
    factors.push({
      key: 'liveHeartRate',
      label: delta >= 20
        ? `Smoothed live heart rate is at least 20 BPM above this session's baseline.`
        : delta >= 10
          ? `Smoothed live heart rate is 10–19 BPM above this session's baseline.`
          : delta >= 5
            ? `Smoothed live heart rate is 5–9 BPM above this session's baseline.`
        : delta <= -5
          ? `Smoothed live heart rate is at least 5 BPM below this session's baseline, so it adds no elevated-arousal score.`
          : 'Smoothed live heart rate is within 5 BPM of this session’s baseline.',
      contribution,
      direction: moving ? 'confounded' : contribution ? 'supporting' : 'neutral'
    });
  }

  const restingDeviation = trends?.restingHeartRate?.deviation;
  if (restingDeviation !== null && restingDeviation !== undefined) {
    const contribution = boundedContribution(restingDeviation, [0.08, 0.15, 0.25]);
    score += contribution;
    evidenceCount += 1;
    factors.push({
      key: 'restingHeartRate',
      label: contribution
        ? `Recent resting heart rate is ${Math.round(restingDeviation * 100)}% above the personal baseline.`
        : 'Recent resting heart rate is less than 8% above the personal baseline.',
      contribution,
      direction: contribution ? 'supporting' : 'neutral'
    });
  }

  const hrvDeviation = trends?.hrv?.deviation;
  if (hrvDeviation !== null && hrvDeviation !== undefined) {
    const decrease = -hrvDeviation;
    const contribution = boundedContribution(decrease, [0.1, 0.2, 0.35]);
    score += contribution;
    evidenceCount += 1;
    factors.push({
      key: 'hrv',
      label: contribution
        ? `Recent HRV is ${Math.round(decrease * 100)}% below the personal baseline.`
        : 'Recent HRV is less than 10% below the personal baseline.',
      contribution,
      direction: contribution ? 'supporting' : 'neutral'
    });
  }

  const respiratoryDeviation = trends?.respiratoryRate?.deviation;
  if (respiratoryDeviation !== null && respiratoryDeviation !== undefined) {
    const contribution = Math.round(boundedContribution(respiratoryDeviation, [0.08, 0.15, 0.25]) * 0.75);
    score += contribution;
    evidenceCount += 1;
    factors.push({
      key: 'respiratoryRate',
      label: contribution
        ? `Recent respiratory rate is ${Math.round(respiratoryDeviation * 100)}% above the personal baseline.`
        : 'Recent respiratory rate is less than 8% above the personal baseline.',
      contribution,
      direction: contribution ? 'supporting' : 'neutral'
    });
  }

  if (moving) {
    factors.push({
      key: 'motion',
      label: 'Movement can explain part of the current heart-rate change.',
      contribution: 0,
      direction: 'confounded'
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: ArousalLevel = score >= 50 ? 'elevated' : score >= 25 ? 'mild' : 'settled';
  const confidence: EstimateConfidence = moving
    ? 'low'
    : evidenceCount >= 3 && typeof live.baselineBPM === 'number'
      ? 'high'
      : evidenceCount >= 1
        ? 'medium'
        : 'low';

  return {
    level,
    score,
    confidence,
    label: level === 'elevated'
      ? 'Higher physiological activation than usual'
      : level === 'mild'
        ? 'Slightly more activated than usual'
        : 'Body signals are near your usual range',
    summary: moving
      ? 'The signal is being interpreted cautiously because movement can raise heart rate.'
      : level === 'elevated'
        ? 'Several current or recent signals are away from your personal baseline.'
        : level === 'mild'
          ? 'A small shift from your personal baseline is visible.'
          : 'Available signals are currently close to your personal baseline.',
    factors,
    policy: chooseIntervention(level, factors, moving),
    updatedAt: live.timestamp
  };
}

function chooseIntervention(
  level: ArousalLevel,
  factors: ArousalFactor[],
  moving: boolean
): InterventionPolicy {
  if (level === 'settled') {
    return {
      type: 'Creative Digital Grounding',
      intensity: 'optional',
      prominence: 'low',
      repeatAfterMinutes: 30,
      reason: 'A light creative check-in can help maintain the current state.'
    };
  }

  if (moving) {
    return {
      type: 'Standard Grounding',
      intensity: 'gentle',
      prominence: 'medium',
      repeatAfterMinutes: 15,
      reason: 'A sensory grounding step is less dependent on interpreting an activity-raised heart rate.'
    };
  }

  const respiratorySignal = factors.find((factor) => factor.key === 'respiratoryRate' && factor.contribution > 0);
  if (level === 'elevated' || respiratorySignal) {
    return {
      type: 'Breathing',
      intensity: level === 'elevated' ? 'focused' : 'gentle',
      prominence: level === 'elevated' ? 'high' : 'medium',
      repeatAfterMinutes: level === 'elevated' ? 5 : 15,
      reason: 'A short paced-breathing exercise is the most direct low-demand option for elevated bodily arousal.'
    };
  }

  const lowerHRV = factors.find((factor) => factor.key === 'hrv' && factor.contribution > 0);
  if (lowerHRV) {
    return {
      type: 'Mindfulness',
      intensity: 'gentle',
      prominence: 'medium',
      repeatAfterMinutes: 15,
      reason: 'A brief attention practice fits a mild, longer-horizon autonomic shift.'
    };
  }

  return {
    type: 'Standard Grounding',
    intensity: 'gentle',
    prominence: 'medium',
    repeatAfterMinutes: 15,
    reason: 'A short sensory orientation exercise matches a mild change without assuming its cause.'
  };
}
