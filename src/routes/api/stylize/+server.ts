import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

type Payload = { image?: string; detectObject?: boolean };

const corsHeaders = {
  'Access-Control-Allow-Origin': env.AIPRO_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function responseJson(body: Record<string, unknown>, status = 200) {
  return json(body, { status, headers: corsHeaders });
}

const COLLAGE_PROMPT = `
Transform the primary object in the uploaded image into one standalone rubber-stamp collage sticker.

Preserve the exact identity, silhouette, proportions, orientation, recognizable features, spatial relationships, and essential original colors of the object. Do not replace, stretch, distort, move, or invent the subject. Simplify it to the minimum visual information needed for immediate recognition; remove tiny clutter, repetitive detail, visual noise, and irrelevant remnants from the source background.

If the object is unmistakably incomplete because the segmentation mask accidentally cut away part of it, naturally reconstruct only the clearly missing portion by continuing the visible shape, structure, and material. Make the object feel whole, but do not redesign it, add new features, or guess beyond what the visible evidence strongly supports.

Render the object as a small, art-publication-quality, multicolor hand-carved rubber stamp: authentic relief-print texture, irregular hand-cut engraving marks, slightly uneven ink coverage, restrained registration offsets, matte paper grain, and extremely subtle fine film noise. Extract 2–4 muted spot-ink colors from the source. Prefer carbon black, deep green, brick red, ochre, slate blue, or taupe only when they suit the source; retain one small area of its most distinctive color.

Add a continuous, clean, warm-white die-cut border around the entire outer silhouette. The border should feel approximately 1 cm wide on a physical sticker, visually about 8–10% of the object's shorter dimension. Keep the border clearly visible and consistent around every edge and internal opening.

Output only this single sticker, centered and fully visible on a transparent background with generous empty padding. No scene, no poster, no split layout, no frame, no typography, no logo, no extra objects, and no multi-image collage. Do not crop any part of the sticker.
`.trim();

const DETECT_OBJECT_PROMPT = `
The uploaded image is a user-selected crop from a larger photograph, not a pre-segmented cutout. First identify the single main object intentionally enclosed by the crop. Separate that object completely from the room, landscape, furniture, people, shadows, and all other background content. If the crop contains connected parts that clearly belong to the same object, retain them together. Do not preserve the crop's rectangular boundary. Then follow the sticker instructions below.

${COLLAGE_PROMPT}
`.trim();

function parseBase64DataUrl(input: string) {
  const match = input.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function generateByAiPro(imageData: string, detectObject: boolean) {
  const parsed = parseBase64DataUrl(imageData);
  if (!parsed) return { ok: false, status: 400, message: 'Invalid image format' };

  const key = env.AIPRO_API_KEY;
  if (!key) return { ok: false, status: 503, message: 'Server missing AIPRO_API_KEY.' };

  const body = new FormData();
  body.append('model', env.AIPRO_IMAGE_MODEL || 'gpt-image-2');
  body.append('prompt', detectObject ? DETECT_OBJECT_PROMPT : COLLAGE_PROMPT);
  body.append('size', '1024x1024');
  body.append('quality', 'high');
  body.append('background', 'transparent');
  body.append('output_format', 'png');
  body.append('n', '1');
  body.append(
    'image',
    new Blob([Buffer.from(parsed.data, 'base64')], { type: parsed.mimeType }),
    'object.png'
  );

  const response = await fetch('https://proaiapi.vip/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    return { ok: false, status: response.status, message: message || 'AI PRO image API failed.' };
  }

  const result = await response.json();
  const first = result?.data?.[0];
  if (!first?.b64_json && !first?.url) {
    return { ok: false, status: 502, message: 'OpenAI response did not include an image.' };
  }

  const image = first.b64_json ? `data:image/png;base64,${first.b64_json}` : first.url;
  return { ok: true, image, status: 200 };
}

export async function POST({ request }: { request: Request }) {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return responseJson({ success: false, error: 'Invalid JSON payload.' }, 400);
  }

  if (!payload.image) {
    return responseJson({ success: false, error: 'Missing image data.' }, 400);
  }

  const result = await generateByAiPro(payload.image, Boolean(payload.detectObject));
  if (!result.ok || !result.image) {
    return responseJson({ success: false, error: result.message || 'Transformation failed.' }, result.status || 500);
  }

  return responseJson({ success: true, image: result.image, source: 'aipro-image-edit' });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
