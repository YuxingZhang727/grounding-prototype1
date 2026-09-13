# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## Current flow

1. Take a photo or choose one from the device.
2. Draw a loose frame around an object.
3. Separate the object locally with a lightweight Segment Anything model.
4. Transform the cutout into a rubber-stamp collage piece with MAI-Image-2.6.
5. Keep collecting or tap **Done** whenever the collage feels ready.
6. Arrange the collected cutouts into a collage.

The prototype uses SvelteKit and runs image segmentation in the browser with Transformers.js and SlimSAM. The selected cutout is sent through the server to OpenRouter for the artistic transformation.

## Development

```sh
npm install
cp .env.example .env
npm run dev
```

Add an OpenRouter key to `.env` before starting the server:

```sh
OPENROUTER_API_KEY=your_openrouter_api_key
```

Open the local URL shown by Vite. Camera access requires `localhost` during development or HTTPS when deployed.

## Checks

```sh
npm run check
npm run build
```

The first segmentation downloads the model files and can take longer. Later runs use the browser cache where available.
