export type SoundFrame = { level: number; brightness: number; richness: number };
export type SoundRoll = { id: string; name: string; created: number; duration: number; frames: SoundFrame[]; trace?: number[]; audio: Blob };

export function analyseSound(wave: Uint8Array, spectrum: Uint8Array): SoundFrame {
  const rms = Math.sqrt(wave.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / wave.length);
  const energy = spectrum.reduce((sum, v) => sum + v, 0);
  const centroid = energy ? spectrum.reduce((sum, v, i) => sum + v * i, 0) / energy / spectrum.length : 0;
  const occupied = spectrum.filter(v => v > 70).length / spectrum.length;
  return { level: Math.min(1, Math.max(0, (20 * Math.log10(rms + 0.00001) + 65) / 55)), brightness: Math.min(1, centroid * 3), richness: Math.min(1, occupied * 4) };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function displayedFrames(frames: SoundFrame[], columns: number, active: boolean): SoundFrame[] {
  const sampled = Array.from({ length: columns }, (_, col) => {
    const index = active
      ? frames.length - 1 - col
      : Math.min(frames.length - 1, Math.floor(col / columns * frames.length));
    return frames[index] ?? { level: 0, brightness: .25, richness: 0 };
  });

  // A short weighted average removes microphone flicker while preserving audible events.
  return sampled.map((frame, index) => {
    let weight = 0;
    let level = 0;
    let brightness = 0;
    let richness = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const nearby = sampled[index + offset];
      if (!nearby) continue;
      const currentWeight = 3 - Math.abs(offset);
      weight += currentWeight;
      level += nearby.level * currentWeight;
      brightness += nearby.brightness * currentWeight;
      richness += nearby.richness * currentWeight;
    }
    return {
      level: clamp01(level / weight),
      brightness: clamp01(brightness / weight),
      richness: clamp01(richness / weight)
    };
  });
}

// One column is a moment in time. Loudness opens the whole dot column away from
// the centre, producing a readable silhouette instead of unrelated dot jitter.
export function tapeSvg(frames: SoundFrame[], width = 560, active = false): string {
  const columns = Math.max(8, Math.ceil(width / 15));
  const average = frames.length ? frames.reduce((n, f) => n + f.brightness, 0) / frames.length : 0.25;
  const averageRichness = frames.length ? frames.reduce((n, f) => n + f.richness, 0) / frames.length : 0;
  const shown = displayedFrames(frames, columns, active);
  // One continuous, explainable colour rule: lower/darker sounds lean toward
  // warm clay; brighter/higher sounds move toward sage. Richness only changes
  // saturation, so the tape never jumps unexpectedly into a new colour family.
  const baseHue = 28 + average * 112;
  const centre = 44;
  const xAt = (col: number) => 8 + col * 15;
  const spreadAt = (level: number) => 7 + Math.pow(level, .72) * 29;
  const top = shown.map((frame, col) => `${xAt(col).toFixed(1)},${(centre-spreadAt(frame.level)-4).toFixed(1)}`).join(' ');
  const bottom = shown.map((frame, col) => `${xAt(col).toFixed(1)},${(centre+spreadAt(frame.level)+4).toFixed(1)}`).reverse().join(' ');
  let dots = '';
  for (let col = 0; col < columns; col++) {
    const frame = shown[col];
    const spread = spreadAt(frame.level);
    for (let row = 0; row < 4; row++) {
      const x = xAt(col);
      const y = centre + ((row - 1.5) / 1.5) * spread;
      const hue = baseHue + (frame.brightness-average) * 28;
      const radius = 2.05 + frame.level * 1.25 + frame.richness * .3;
      dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="hsl(${hue.toFixed(1)} 46% 29%)" opacity="${(.66 + frame.level * .3).toFixed(2)}"/>`;
    }
  }
  const paperStops = [shown[0], shown[Math.floor(shown.length/2)], shown[shown.length-1]].map((frame, index) => {
    const hue = baseHue + (frame.brightness-average) * 22;
    const saturation = 34 + frame.richness * 18;
    const lightness = 84 - frame.richness * 8 - frame.level * 3;
    return `<stop offset="${index*50}%" stop-color="hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)"/>`;
  }).join('');
  const envelope = frames.length
    ? `<polygon points="${top} ${bottom}" fill="hsl(${baseHue} 42% 36%)" opacity=".1"/>`
    : '';
  const liveEdge = active
    ? `<rect x="0" width="32" height="88" fill="url(#live)"/><line x1="4" x2="4" y1="9" y2="79" stroke="#f7f1e7" stroke-width="1.5" stroke-linecap="round" opacity=".9"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="88" viewBox="0 0 ${width} 88"><defs><clipPath id="edge"><path d="M0 3 L${width} 0 L${width-3} 12 L${width} 23 L${width-3} 34 L${width} 45 L${width-3} 56 L${width} 67 L${width-3} 78 L${width} 86 L0 88Z"/></clipPath><linearGradient id="paper">${paperStops}</linearGradient><linearGradient id="live"><stop stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><g clip-path="url(#edge)"><rect width="${width}" height="88" fill="url(#paper)"/>${envelope}${dots}${liveEdge}</g></svg>`;
}
export const tapeImage = (frames: SoundFrame[], width = 560, active = false) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tapeSvg(frames, width, active));

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('grounding-sound', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rolls', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveRoll(roll: SoundRoll) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('rolls', 'readwrite');
    tx.objectStore('rolls').put(roll);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function deleteRoll(id: string) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('rolls', 'readwrite');
    tx.objectStore('rolls').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadRolls(): Promise<SoundRoll[]> {
  const db = await database();
  try { return await new Promise<SoundRoll[]>((resolve, reject) => {
    const request = db.transaction('rolls').objectStore('rolls').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: SoundRoll, b: SoundRoll) => b.created-a.created));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
