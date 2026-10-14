import { Capacitor, registerPlugin } from '@capacitor/core';

type HapticTexturePlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  begin(options: { materials: string[] }): Promise<void>;
  update(options: { materials: string[]; speed: number; distance: number }): void;
  end(): Promise<void>;
  preview(options: { materials: string[] }): Promise<void>;
};

const NativeTextureHaptics = registerPlugin<HapticTexturePlugin>('TextureHaptics');

const fallbackSpacing: Record<string, number> = {
  soft: 34,
  rough: 10,
  smooth: Number.POSITIVE_INFINITY,
  bumpy: 28,
  fuzzy: 20,
  sticky: 38,
  firm: 22,
  slippery: 100
};

function normalizedMaterial(value: string) {
  const name = value.toLowerCase();
  if (/rough|grain|grit|sand|coarse|scratch|cement|concrete/.test(name)) return 'rough';
  if (/smooth|silk|polish|glass|sleek/.test(name)) return 'smooth';
  if (/bump|raised|knob|lump|uneven/.test(name)) return 'bumpy';
  if (/fuzz|fur|fluff|wool|velvet|fabric/.test(name)) return 'fuzzy';
  if (/stick|tack|gum|rubber|damp/.test(name)) return 'sticky';
  if (/firm|hard|solid|dense|stiff|metal|wood/.test(name)) return 'firm';
  if (/slip|slick|oil|wet/.test(name)) return 'slippery';
  return 'soft';
}

function meanSpacing(materials: string[]) {
  const values = materials.map((material) => fallbackSpacing[normalizedMaterial(material)]);
  if (values.some((value) => !Number.isFinite(value))) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? Math.max(24, finite.reduce((sum, value) => sum + value, 0) / finite.length) : Number.POSITIVE_INFINITY;
  }
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

/**
 * Turns pointer movement into distance-based texture samples. Native iOS uses
 * Core Haptics; other surfaces receive a deliberately modest vibration fallback.
 */
export class TextureHapticsController {
  available = false;
  private native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  private active = false;
  private lastPoint: { x: number; y: number; time: number } | null = null;
  private pendingDistance = 0;
  private fallbackDistance = 0;
  private lastNativeUpdate = 0;
  private smoothedSpeed = 0;

  async prepare() {
    if (this.native) {
      try {
        this.available = (await NativeTextureHaptics.isAvailable()).available;
      } catch {
        this.available = false;
      }
    } else {
      this.available = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    }
    return this.available;
  }

  async begin(materials: string[], event: PointerEvent) {
    if (!this.available) return;
    this.active = true;
    this.lastPoint = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    this.pendingDistance = 0;
    this.fallbackDistance = 0;
    this.smoothedSpeed = 0;
    if (this.native) await NativeTextureHaptics.begin({ materials }).catch(() => undefined);
  }

  move(materials: string[], event: PointerEvent) {
    if (!this.available || !this.active || !this.lastPoint) return;
    const distance = Math.hypot(event.clientX - this.lastPoint.x, event.clientY - this.lastPoint.y);
    const elapsed = Math.max(1, event.timeStamp - this.lastPoint.time);
    const speed = (distance / elapsed) * 1000;
    this.smoothedSpeed = this.smoothedSpeed * 0.68 + speed * 0.32;
    this.lastPoint = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    this.pendingDistance += distance;

    if (this.native) {
      // Twenty updates per second is responsive enough for the Taptic Engine and
      // avoids flooding the Capacitor bridge with pointer-rate messages.
      if (event.timeStamp - this.lastNativeUpdate < 50) return;
      const updateDistance = this.pendingDistance;
      this.pendingDistance = 0;
      this.lastNativeUpdate = event.timeStamp;
      NativeTextureHaptics.update({
        materials,
        speed: this.smoothedSpeed,
        distance: updateDistance
      });
      return;
    }

    const spacing = meanSpacing(materials);
    this.fallbackDistance += distance;
    if (this.fallbackDistance >= spacing) {
      this.fallbackDistance %= spacing;
      navigator.vibrate(Math.min(8, 3 + Math.round(this.smoothedSpeed / 240)));
    }
  }

  async end() {
    if (!this.active) return;
    this.active = false;
    this.lastPoint = null;
    if (this.native) await NativeTextureHaptics.end().catch(() => undefined);
    else navigator.vibrate?.(0);
  }

  async preview(materials: string[]) {
    if (!this.available) return;
    if (this.native) {
      await NativeTextureHaptics.preview({ materials }).catch(() => undefined);
      return;
    }
    const spacing = meanSpacing(materials);
    if (!Number.isFinite(spacing)) return;
    const pulse = spacing < 12 ? 8 : spacing < 25 ? 14 : 20;
    navigator.vibrate?.([pulse, Math.max(22, spacing * 2), pulse, Math.max(22, spacing * 2), pulse]);
  }
}
