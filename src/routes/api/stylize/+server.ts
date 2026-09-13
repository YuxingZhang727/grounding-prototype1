import { json } from '@sveltejs/kit';

type TransformStyle = 'line-drawing' | 'paper-stamp' | 'watercolor' | 'ink-plaque';

type Payload = {
  image?: string;
  style?: TransformStyle;
};

const stylePrompts: Record<TransformStyle, string> = {
  'line-drawing': 'Create a delicate line drawing of the object, soft handmade paper collage style, with clean outlines and gentle shading. Keep transparent background and keep object composition obvious.',
  'paper-stamp': 'Transform the object into a tactile paper-stamp collage style, like hand-cut layered paper and soft pastel ink, with subtle texture and no real-world context.',
  watercolor: 'Convert to a soft watercolor collage illustration while keeping the object's shape and silhouette. Use muted calming tones and painterly brush textures.',
  'ink-plaque': 'Turn into an ink-plate style graphic, with thick and thin ink strokes, high contrast and visible layered paper grain. Keep composition readable.'
};

const allowedStyles: TransformStyle[] = ['line-drawing', 'paper-stamp', 'watercolor', 'ink-plaque'];

function parseBase64DataUrl(input: string) {
  const match = input.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function generateByOpenAI(imageData: string, style: TransformStyle) {
  const parsed = parseBase64DataUrl(imageData);
  if (!parsed) {
    return { ok: false, status: 400, message: 'Invalid image format' };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, status: 503, message: 'Server missing OPENAI_API_KEY.' };
  }

  const body = new FormData();
  body.append('model', 'gpt-image-1');
  body.append('prompt', stylePrompts[style]);
  body.append('size', '1024x1024');
  body.append('n', '1');
  body.append('response_format', 'b64_json');
  body.append('image', new Blob([Buffer.from(parsed.data, 'base64')], { type: parsed.mimeType }), 'object.png');

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    return { ok: false, status: response.status, message: message || 'OpenAI image API failed.' };
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
    return json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const style = payload.style;
  if (!payload.image) {
    return json({ success: false, error: 'Missing image data.' }, { status: 400 });
  }
  if (!style || !allowedStyles.includes(style)) {
    return json({ success: false, error: 'Unsupported transform style.' }, { status: 400 });
  }

  const result = await generateByOpenAI(payload.image, style);
  if (!result.ok || !result.image) {
    return json({ success: false, error: result.message || 'Transformation failed.' }, { status: result.status || 500 });
  }

  return json({ success: true, image: result.image, source: 'openai-image-edit', style });
}
