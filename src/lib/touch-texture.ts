export type TouchTextureOptions = {
  textures: string[];
  temperature: number;
  intensity: number;
};

type TextureKind = 'soft' | 'rough' | 'smooth' | 'bumpy' | 'fuzzy' | 'sticky' | 'firm' | 'slippery';

const textureAliases: Record<TextureKind, string[]> = {
  soft: ['soft', 'gentle', 'plush', 'cushion', 'tender'],
  rough: ['rough', 'grain', 'grainy', 'gritty', 'sandy', 'coarse', 'scratchy'],
  smooth: ['smooth', 'silky', 'polished', 'glassy', 'sleek'],
  bumpy: ['bumpy', 'raised', 'knobbly', 'lumpy', 'uneven'],
  fuzzy: ['fuzzy', 'furry', 'fluffy', 'woolly', 'velvety'],
  sticky: ['sticky', 'tacky', 'gummy', 'rubbery', 'damp'],
  firm: ['firm', 'hard', 'solid', 'dense', 'stiff'],
  slippery: ['slippery', 'slick', 'oily', 'wet', 'slippy']
};

function textureKind(value: string): TextureKind {
  const normalized = value.toLowerCase();
  for (const [kind, aliases] of Object.entries(textureAliases) as [TextureKind, string[]][]) {
    if (aliases.some((alias) => normalized.includes(alias))) return kind;
  }
  return 'soft';
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function organicPath(
  context: CanvasRenderingContext2D,
  random: () => number,
  x: number,
  y: number,
  radius: number,
  points = 9
) {
  const vertices = Array.from({ length: points }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    const localRadius = radius * (0.66 + random() * 0.48);
    return { x: x + Math.cos(angle) * localRadius, y: y + Math.sin(angle) * localRadius };
  });
  context.beginPath();
  vertices.forEach((point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
    if (index === 0) context.moveTo(midpoint.x, midpoint.y);
    context.quadraticCurveTo(next.x, next.y, (next.x + vertices[(index + 2) % vertices.length].x) / 2, (next.y + vertices[(index + 2) % vertices.length].y) / 2);
  });
  context.closePath();
}

export function generateTouchTexture({ textures, temperature, intensity }: TouchTextureOptions) {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const width = canvas.width;
  const height = canvas.height;
  const warmth = Math.max(0, Math.min(1, (temperature + 100) / 200));
  const strength = Math.max(0.2, Math.min(1, intensity / 5));
  const kinds = [...new Set(textures.map(textureKind))];
  const random = mulberry32(hashString(`${textures.join('|')}|${Math.round(temperature)}|${intensity}`));

  // Paper body: broad pulp variation first, then low-resolution tooth.
  context.fillStyle = '#f0ebdf';
  context.fillRect(0, 0, width, height);
  for (let index = 0; index < 24; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 90 + random() * 250;
    const wash = context.createRadialGradient(x, y, 0, x, y, radius);
    const light = random() > 0.48;
    wash.addColorStop(0, light ? 'rgba(255,253,246,.09)' : 'rgba(107,91,62,.045)');
    wash.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = wash;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const tooth = document.createElement('canvas');
  tooth.width = 180;
  tooth.height = 240;
  const toothContext = tooth.getContext('2d');
  if (toothContext) {
    const image = toothContext.createImageData(tooth.width, tooth.height);
    for (let pixel = 0; pixel < image.data.length; pixel += 4) {
      const grain = Math.round(116 + (random() - 0.5) * 86);
      image.data[pixel] = grain;
      image.data[pixel + 1] = grain - 3;
      image.data[pixel + 2] = grain - 9;
      image.data[pixel + 3] = Math.round(18 + random() * 28);
    }
    toothContext.putImageData(image, 0, 0);
    context.save();
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = 0.34;
    context.imageSmoothingEnabled = true;
    context.drawImage(tooth, 0, 0, width, height);
    context.restore();
  }

  // Paper fibres remain quiet enough for collage objects and text to stay legible.
  context.save();
  context.lineCap = 'round';
  for (let index = 0; index < 780; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 5 + random() * 30;
    const drift = (random() - 0.5) * 7;
    context.strokeStyle = random() > 0.5 ? 'rgba(91,76,54,.055)' : 'rgba(255,255,252,.16)';
    context.lineWidth = 0.28 + random() * 0.58;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(x + length * 0.5, y + drift, x + length, y + drift * 0.35);
    context.stroke();
  }
  context.restore();

  for (const kind of kinds) {
    context.save();
    context.globalCompositeOperation = 'multiply';

    if (kind === 'soft') {
      const count = Math.round(65 + 170 * strength);
      context.filter = `blur(${1.2 + warmth * 3.8}px)`;
      context.lineCap = 'round';
      for (let index = 0; index < count; index += 1) {
        const x = random() * width;
        const y = random() * height;
        const length = 24 + random() * (42 + warmth * 54);
        const wave = (random() - 0.5) * (25 + warmth * 25);
        context.strokeStyle = `rgba(107,98,82,${0.025 + strength * 0.055})`;
        context.lineWidth = 1.1 + warmth * 2.1;
        context.beginPath();
        context.moveTo(x, y);
        context.bezierCurveTo(x + length * 0.3, y + wave, x + length * 0.72, y - wave * 0.45, x + length, y + wave * 0.12);
        context.stroke();
      }
    }

    if (kind === 'fuzzy') {
      const count = Math.round(260 + 700 * strength);
      context.lineCap = 'round';
      for (let index = 0; index < count; index += 1) {
        const x = random() * width;
        const y = random() * height;
        const length = 5 + random() * (10 + warmth * 16);
        const angle = -0.25 + (random() - 0.5) * 1.35;
        context.strokeStyle = `rgba(77,73,65,${0.035 + strength * 0.065})`;
        context.lineWidth = 0.35 + warmth * 0.65;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        context.stroke();
      }
    }

    if (kind === 'rough') {
      const count = Math.round(410 + 1120 * strength);
      for (let index = 0; index < count; index += 1) {
        const size = 0.45 + random() * (1.8 + (1 - warmth) * 2.9);
        const x = random() * width;
        const y = random() * height;
        context.fillStyle = `rgba(73,68,58,${0.045 + strength * 0.1})`;
        context.fillRect(x, y, size * (0.5 + random()), size);
        if (index % 13 === 0) {
          context.strokeStyle = `rgba(255,255,250,${0.11 + strength * 0.08})`;
          context.lineWidth = 0.45;
          context.beginPath();
          context.moveTo(x - 1, y - 1);
          context.lineTo(x + size * 2, y - 1);
          context.stroke();
        }
      }
    }

    if (kind === 'smooth') {
      context.globalCompositeOperation = 'screen';
      context.translate(width / 2, height / 2);
      context.rotate(-0.3 + warmth * 0.14);
      for (let band = -3; band <= 3; band += 1) {
        const gradient = context.createLinearGradient(-width * 0.7, 0, width * 0.7, 0);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.48, `rgba(255,255,255,${0.04 + strength * 0.095})`);
        gradient.addColorStop(0.54, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(-width, band * 135 - 38, width * 2, 76 + warmth * 34);
      }
    }

    if (kind === 'bumpy') {
      const count = Math.round(38 + 115 * strength);
      context.globalCompositeOperation = 'source-over';
      for (let index = 0; index < count; index += 1) {
        const radius = 4 + random() * (7 + warmth * 12);
        const x = radius + random() * (width - radius * 2);
        const y = radius + random() * (height - radius * 2);
        const relief = context.createRadialGradient(x - radius * 0.35, y - radius * 0.42, radius * 0.08, x, y, radius);
        relief.addColorStop(0, `rgba(255,255,251,${0.14 + strength * 0.18})`);
        relief.addColorStop(0.53, 'rgba(194,184,164,.025)');
        relief.addColorStop(0.82, `rgba(84,75,61,${0.035 + strength * 0.085})`);
        relief.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = relief;
        context.beginPath();
        context.ellipse(x, y, radius, radius * (0.55 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
        context.fill();
      }
    }

    if (kind === 'sticky') {
      const count = Math.round(12 + 34 * strength);
      context.globalCompositeOperation = 'multiply';
      for (let index = 0; index < count; index += 1) {
        const x = random() * width;
        const y = random() * height;
        const radius = 12 + random() * (24 + warmth * 35);
        organicPath(context, random, x, y, radius);
        context.fillStyle = `rgba(112,96,68,${0.025 + strength * 0.055})`;
        context.shadowColor = `rgba(82,72,57,${0.05 + strength * 0.06})`;
        context.shadowBlur = 5 + warmth * 8;
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = `rgba(255,255,248,${0.12 + strength * 0.12})`;
        context.lineWidth = 1.1 + warmth;
        context.stroke();
      }
    }

    if (kind === 'firm') {
      const spacing = 10 + (1 - strength) * 17;
      context.lineCap = 'square';
      context.lineWidth = 0.7 + strength * 0.75;
      for (let y = 12; y < height; y += spacing) {
        const offset = (random() - 0.5) * 5;
        context.strokeStyle = `rgba(75,71,63,${0.035 + strength * 0.08})`;
        context.beginPath();
        context.moveTo(20 + offset, y);
        context.lineTo(width - 20, y + offset * 0.3);
        context.stroke();
        context.strokeStyle = `rgba(255,255,252,${0.11 + strength * 0.08})`;
        context.beginPath();
        context.moveTo(20 + offset, y - 1.2);
        context.lineTo(width - 20, y + offset * 0.3 - 1.2);
        context.stroke();
      }
    }

    if (kind === 'slippery') {
      const count = Math.round(16 + 40 * strength);
      context.globalCompositeOperation = 'screen';
      context.filter = `blur(${0.5 + warmth * 2.1}px)`;
      context.lineCap = 'round';
      for (let index = 0; index < count; index += 1) {
        const x = -80 + random() * width;
        const y = random() * height;
        const length = 120 + random() * 280;
        context.strokeStyle = `rgba(255,255,255,${0.045 + strength * 0.13})`;
        context.lineWidth = 1 + random() * (2 + warmth * 3.4);
        context.beginPath();
        context.moveTo(x, y);
        context.bezierCurveTo(x + length * 0.3, y - 25, x + length * 0.68, y + 22, x + length, y - 4);
        context.stroke();
      }
    }
    context.restore();
  }

  // Subtle deckled edges make the exported surface read as a physical journal page.
  context.save();
  const edge = Math.round(12 + strength * 9);
  const top = context.createLinearGradient(0, 0, 0, edge);
  top.addColorStop(0, 'rgba(86,72,51,.105)');
  top.addColorStop(1, 'rgba(86,72,51,0)');
  context.fillStyle = top;
  context.fillRect(0, 0, width, edge);
  const bottom = context.createLinearGradient(0, height, 0, height - edge);
  bottom.addColorStop(0, 'rgba(86,72,51,.08)');
  bottom.addColorStop(1, 'rgba(86,72,51,0)');
  context.fillStyle = bottom;
  context.fillRect(0, height - edge, width, edge);
  const side = context.createLinearGradient(0, 0, edge, 0);
  side.addColorStop(0, 'rgba(86,72,51,.075)');
  side.addColorStop(1, 'rgba(86,72,51,0)');
  context.fillStyle = side;
  context.fillRect(0, 0, edge, height);
  context.translate(width, 0);
  context.scale(-1, 1);
  context.fillRect(0, 0, edge, height);
  context.restore();

  return canvas.toDataURL('image/jpeg', 0.91);
}
