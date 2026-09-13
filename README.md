# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice five things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## Current flow

1. Take a photo or choose one from the device.
2. Draw a loose frame around an object.
3. Separate the object locally with a lightweight Segment Anything model.
4. Notice its color, shape, or texture.
5. Arrange five collected cutouts into a collage.

The prototype uses SvelteKit and runs image segmentation in the browser with Transformers.js and SlimSAM. Photos are processed locally rather than uploaded to an application server.

## Development

```sh
npm install
npm run dev
```

Open the local URL shown by Vite. Camera access requires `localhost` during development or HTTPS when deployed.

## Checks

```sh
npm run check
npm run build
```

The first segmentation downloads the model files and can take longer. Later runs use the browser cache where available.
