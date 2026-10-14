/**
 * HealthKit trend reader.
 *
 * All four methods degrade gracefully on web: `isAvailable()` reports false and
 * `getTrends()` returns an empty, well-formed payload so recommendation code
 * never has to branch on platform.
 *
 * Only aggregated trend data crosses the bridge. Nothing here is a live stream
 * — continuous heart-rate handling belongs on the native side.
 */

import { registerPlugin } from '@capacitor/core';
import { capabilities } from './capabilities';

export type TrendPoint = {
  day: string;
  value: number;
};

export type TrendMetric = {
  key: 'hrv' | 'restingHeartRate' | 'respiratoryRate' | 'mindfulMinutes' | 'sleepDuration' | 'wristTemperature';
  /** False when the metric has no samples at all, or is not authorized. */
  available: boolean;
  /** Most recent daily value, or null. */
  latest: number | null;
  latestDay?: string;
  /** Median of the personal baseline window, excluding the latest day. */
  baseline: number | null;
  /**
   * `(latest - baseline) / baseline`. This is the only field worth comparing
   * between sessions: absolute HRV is not comparable between people.
   * Null when there is no baseline yet.
   */
  deviation: number | null;
  sampleDays: number;
  baselineSamples?: number;
  unit: string;
  series: TrendPoint[];
};

export type TrendsPayload = {
  hrv?: TrendMetric;
  restingHeartRate?: TrendMetric;
  respiratoryRate?: TrendMetric;
  mindfulMinutes?: TrendMetric;
  sleepDuration?: TrendMetric;
  wristTemperature?: TrendMetric;
  ecg?: {
    available: boolean;
    count: number;
    latestAt?: string;
  };
  generatedAt: string;
  trendDays: number;
  baselineDays: number;
  /** Present only when the native read failed or the plugin is unavailable. */
  unavailable?: boolean;
};

type NativeHealthTrend = {
  isAvailable(): Promise<{ available: boolean; entitled: boolean }>;
  requestAuthorization(): Promise<{ granted: boolean }>;
  getTrends(options?: { days?: number }): Promise<TrendsPayload>;
  submitDummySamples(options?: { days?: number }): Promise<{ saved: number; success: boolean }>;
};

export const HEALTH_TREND_METRICS: TrendMetric['key'][] = [
  'hrv',
  'restingHeartRate',
  'respiratoryRate',
  'mindfulMinutes',
  'sleepDuration',
  'wristTemperature'
];

const nativeHealthTrend = registerPlugin<NativeHealthTrend>('HealthTrend');

const EMPTY_PAYLOAD: TrendsPayload = {
  generatedAt: new Date(0).toISOString(),
  trendDays: 0,
  baselineDays: 0,
  unavailable: true
};

let cachedAvailability: { available: boolean; entitled: boolean } | null = null;

/** True when this build can read HealthKit trends at all. */
export async function healthTrendsAvailable(): Promise<boolean> {
  if (!capabilities.health.trends) return false;
  if (!cachedAvailability) {
    try {
      cachedAvailability = await nativeHealthTrend.isAvailable();
    } catch {
      cachedAvailability = { available: false, entitled: false };
    }
  }
  return cachedAvailability.available && cachedAvailability.entitled;
}

/**
 * Asks for read access. HealthKit shows its own sheet; a `false` result means
 * the sheet was dismissed, not that specific metrics were denied. HealthKit
 * never reveals per-type read denials, so callers must treat a missing metric
 * as "no data" rather than "denied".
 */
export async function requestHealthAuthorization(): Promise<boolean> {
  if (!(await healthTrendsAvailable())) return false;
  try {
    const result = await nativeHealthTrend.requestAuthorization();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

/** Reads the trend payload. Always resolves; falls back to an empty payload. */
export async function getHealthTrends(days = 30): Promise<TrendsPayload> {
  if (!(await healthTrendsAvailable())) return { ...EMPTY_PAYLOAD };
  try {
    return await nativeHealthTrend.getTrends({ days });
  } catch (error) {
    console.warn('HealthKit trend read failed.', error);
    return { ...EMPTY_PAYLOAD };
  }
}

/**
 * Writes synthetic trends for development. Debug builds only — the native side
 * rejects this call in release builds.
 */
export async function submitDummyHealthSamples(days = 30): Promise<boolean> {
  if (!(await healthTrendsAvailable())) return false;
  try {
    const result = await nativeHealthTrend.submitDummySamples({ days });
    return Boolean(result.success);
  } catch (error) {
    console.warn('Could not write dummy health samples.', error);
    return false;
  }
}

/** Metrics that actually have data, for the recommendation layer. */
export function availableMetrics(payload: TrendsPayload): TrendMetric[] {
  return HEALTH_TREND_METRICS
    .map((key) => payload[key])
    .filter((metric): metric is TrendMetric => Boolean(metric?.available));
}

/**
 * Describes a deviation in plain, non-clinical language.
 *
 * The thresholds are deliberately wide. Day-to-day within-person variation in
 * HRV is large, and the design brief forbids diagnostic phrasing — this
 * returns "a little lower than usual", never "your HRV indicates stress".
 */
export function describeDeviation(metric: TrendMetric): string {
  if (!metric.available) return 'No reading available yet.';
  if (metric.deviation === null) return 'Still building your personal baseline.';

  const magnitude = Math.abs(metric.deviation);
  // Under 10% is inside normal day-to-day noise; do not report it as a change.
  if (magnitude < 0.1) return 'About the same as usual.';

  const direction = metric.deviation > 0 ? 'higher' : 'lower';
  if (magnitude < 0.25) return `A little ${direction} than usual.`;
  return `Noticeably ${direction} than usual.`;
}
