# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## Current flow

1. Take a photo or choose one from the device.
2. Tap one or more parts of an object to test local SAM segmentation, or drag a frame to test direct AI detection.
3. Review either the SAM cutout or the high-resolution AI input crop beside the original photo.
4. Transform the cutout into a rubber-stamp collage piece with an AI image-editing model.
5. Keep collecting or tap **Done** whenever the collage feels ready.
6. Arrange the collected cutouts into a collage.

The prototype uses SvelteKit and runs image segmentation in the browser with Transformers.js and SlimSAM. The selected cutout is sent through the server to AI PRO API for the artistic transformation.

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
