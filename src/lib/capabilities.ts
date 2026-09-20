/**
 * Platform capability query.
 *
 * Every place that branches on platform should read from here instead of
 * calling `Capacitor.getPlatform()` directly. Keeping the branches in one
 * file means adding a platform later (or a new signal source) does not mean
 * hunting through `.svelte` files for scattered `if` statements.
 */

import { Capacitor } from '@capacitor/core';

const isIOS = Capacitor.getPlatform() === 'ios';

export type SegmentationCapabilities = {
  /** Tap a single point to select an object. */
  point: boolean;
  /** Positive / negative brush strokes that refine a selection. */
  stroke: boolean;
  /** Drag a rectangle to bound the selection. */
  box: boolean;
  /** A live confidence mask rendered over the photo while the user paints. */
  liveMask: boolean;
};

export type HealthCapabilities = {
  /** HealthKit trend reading (HRV, resting HR, respiratory rate, mindful minutes). */
  trends: boolean;
  /** Live heart-rate stream from a paired watch during an active workout. */
  liveHeartRate: boolean;
};

export type AppCapabilities = {
  platform: 'web' | 'ios' | 'android';
  segmentation: SegmentationCapabilities;
  health: HealthCapabilities;
};

export const capabilities: AppCapabilities = {
  platform: isIOS ? 'ios' : Capacitor.getPlatform() === 'android' ? 'android' : 'web',

  // Apple Vision foreground-instance masks accept tapped points only. MediaPipe's
  // interactive segmenter is what provides strokes, lasso, and the live mask,
  // and it has no iOS counterpart.
  segmentation: isIOS
    ? { point: true, stroke: false, box: false, liveMask: false }
    : { point: true, stroke: true, box: true, liveMask: true },

  // HealthKit only exists on iOS. The web build reads the same event shape from
  // a local bridge server instead (see detection-heartrate-p1).
  health: isIOS
    ? { trends: true, liveHeartRate: true }
    : { trends: false, liveHeartRate: false }
};

/** True when the app should show any signal-derived UI at all. */
export function hasAnyHealthSignal(): boolean {
  return capabilities.health.trends || capabilities.health.liveHeartRate;
}
