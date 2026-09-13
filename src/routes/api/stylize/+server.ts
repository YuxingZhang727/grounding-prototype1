import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

type Payload = { image?: string };

const COLLAGE_PROMPT = `
Transform the uploaded isolated object into one standalone rubber-stamp collage sticker.

Preserve the exact identity, silhouette, proportions, orientation, recognizable features, spatial relationships, and essential original colors of the object. Do not replace, stretch, distort, move, or invent the subject. Simplify it to the minimum visual information needed for immediate recognition; remove tiny clutter, repetitive detail, visual noise, and irrelevant remnants from the source background.

Render the object as a small, art-publication-quality, multicolor hand-carved rubber stamp: authentic relief-print texture, irregular hand-cut engraving marks, slightly uneven ink coverage, restrained registration offsets, matte paper grain, and extremely subtle fine film noise. Extract 2–4 muted spot-ink colors from the source. Prefer carbon black, deep green, brick red, ochre, slate blue, or taupe only when they suit the source; retain one small area of its most distinctive color.

Add a continuous, clean, warm-white die-cut border around the entire outer silhouette. The border should feel approximately 1 cm wide on a physical sticker, visually about 8–10% of the object's shorter dimension. Keep the border clearly visible and consistent around every edge and internal opening.

Output only this single sticker, centered and fully visible on a transparent background with generous empty padding. No scene, no poster, no split layout, no frame, no typography, no logo, no extra objects, and no multi-image collage. Do not crop any part of the sticker.
`.trim();

function isImageDataUrl(input: string) {
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/.test(input);
}

async function generateByOpenRouter(imageData: string) {
  if (!isImageDataUrl(imageData)) return { ok: false, status: 400, message: 'Invalid image format' };

  const key = env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, status: 503, message: 'Server missing OPENROUTER_API_KEY.' };

  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/YuxingZhang727/grounding-prototype1',
      'X-Title': 'Grounding Prototype 1'
    },
    body: JSON.stringify({
      model: 'microsoft/mai-image-2.6',
      prompt: COLLAGE_PROMPT,
      input_references: [
        {
          type: 'image_url',
          image_url: { url: imageData }
        }
      ],
      aspect_ratio: '1:1',
      n: 1
    })
  });

  if (!response.ok) {
    const message = await response.text();
    return { ok: false, status: response.status, message: message || 'OpenRouter image API failed.' };
  }

  const result = await response.json();
  const first = result?.data?.[0];
  if (!first?.b64_json && !first?.url) {
    return { ok: false, status: 502, message: 'OpenAI response did not include an image.' };
  }

  const image = first.b64_json
    ? `data:${first.media_type || 'image/png'};base64,${first.b64_json}`
    : first.url;
  return { ok: true, image, status: 200 };
}

export async function POST({ request }: { request: Request }) {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  if (!payload.image) {
    return json({ success: false, error: 'Missing image data.' }, { status: 400 });
  }

  const result = await generateByOpenRouter(payload.image);
  if (!result.ok || !result.image) {
    return json({ success: false, error: result.message || 'Transformation failed.' }, { status: result.status || 500 });
  }

  return json({ success: true, image: result.image, source: 'openrouter-mai-image-2.6' });
}
