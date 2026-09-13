# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## Current flow

1. Describe a remembered touch and generate the journal background.
2. Continue into SEE and take a photo or choose one from the device.
3. Tap one or more parts of an object to test local SAM segmentation, or drag a frame to test direct AI detection.
4. Review either the SAM cutout or the high-resolution AI input crop beside the original photo.
5. Transform the cutout into a rubber-stamp collage piece with an AI image-editing model.
6. Arrange the collected pieces over the generated tactile background.

The prototype uses SvelteKit and runs image segmentation in the browser with Transformers.js and SlimSAM. The selected cutout is sent through the server to AI PRO API for the artistic transformation.

## TOUCH flow

The `/touch` route is the first stage of the connected grounding flow. It translates one or two tactile words, a cold-to-warm value, and a 1–5 intensity into a procedural journal background. Temperature changes the texture structure rather than applying a blue-to-red color gradient. The background is carried into SEE and used as the final collage surface.

## Development

```sh
npm install
cp .env.example .env
npm run dev
```

Add an AI PRO API key to `.env` before starting the server:

```sh
AIPRO_API_KEY=your_aipro_api_key
AIPRO_IMAGE_MODEL=gpt-image-2
```

Open the local URL shown by Vite. Camera access requires `localhost` during development or HTTPS when deployed.

## Checks

```sh
npm run check
npm run build
```

The first segmentation downloads the model files and can take longer. Later runs use the browser cache where available.
