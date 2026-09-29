import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type WatchAvailability = {
  available: boolean;
  activated?: boolean;
  paired: boolean;
  watchAppInstalled: boolean;
  reachable: boolean;
};

export type WatchSignalSnapshot = {
  available?: boolean;
  kind?: 'snapshot';
  provider?: 'apple_watch';
  bpm?: number;
  baselineBPM?: number;
  motionIntensity?: number;
  elapsedTime?: number;
  isRunning?: boolean;
  status?: string;
  timestamp?: string;
};

export type WatchCheckIn = {
  kind: 'checkIn';
  id: string;
  rating: number;
  bpm?: number;
  motionIntensity: number;
  timestamp: string;
};

type WatchSignalNative = {
  isAvailable(): Promise<WatchAvailability>;
  getLatest(): Promise<WatchSignalSnapshot>;
  getCheckIns(): Promise<{ entries: WatchCheckIn[] }>;
  addListener(
    eventName: 'signalUpdate',
    listener: (snapshot: WatchSignalSnapshot) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'checkIn',
    listener: (entry: WatchCheckIn) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'availabilityChanged',
    listener: (availability: WatchAvailability) => void
  ): Promise<PluginListenerHandle>;
};

const nativeWatchSignal = registerPlugin<WatchSignalNative>('WatchSignal');

export function isWatchSignalNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export async function getWatchAvailability(): Promise<WatchAvailability> {
  if (!isWatchSignalNative()) {
    return { available: false, activated: false, paired: false, watchAppInstalled: false, reachable: false };
  }
  return nativeWatchSignal.isAvailable();
}

export async function getLatestWatchSignal(): Promise<WatchSignalSnapshot> {
  if (!isWatchSignalNative()) return { available: false };
  return nativeWatchSignal.getLatest();
}

export async function getWatchCheckIns(): Promise<WatchCheckIn[]> {
  if (!isWatchSignalNative()) return [];
  const result = await nativeWatchSignal.getCheckIns();
  return result.entries;
}

export async function onWatchSignal(
  listener: (snapshot: WatchSignalSnapshot) => void
): Promise<PluginListenerHandle | null> {
  if (!isWatchSignalNative()) return null;
  return nativeWatchSignal.addListener('signalUpdate', listener);
}

export async function onWatchCheckIn(
  listener: (entry: WatchCheckIn) => void
): Promise<PluginListenerHandle | null> {
  if (!isWatchSignalNative()) return null;
  return nativeWatchSignal.addListener('checkIn', listener);
}

export async function onWatchAvailabilityChanged(
  listener: (availability: WatchAvailability) => void
): Promise<PluginListenerHandle | null> {
  if (!isWatchSignalNative()) return null;
  return nativeWatchSignal.addListener('availabilityChanged', listener);
}
