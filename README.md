# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## Current flow

1. Describe a remembered touch and generate the journal background.
2. Continue into SEE and take a photo or choose one from the device.
3. Tap one or more parts of an object to test local SAM segmentation, or drag a frame to test direct AI detection.
4. Review either the SAM cutout or the high-resolution AI input crop beside the original photo.
5. Transform the cutout into a rubber-stamp collage piece with an AI image-editing model.
6. Arrange the collected pieces over the generated tactile background.

The prototype uses SvelteKit and Capacitor, and runs image segmentation locally with Transformers.js and SlimSAM. Both the fp16 WebGPU weights and quantized WASM fallback weights are bundled with the app, so segmentation does not download a model from Hugging Face at runtime. Browser builds can use WebGPU; native shells use single-threaded q8 WASM and resize high-resolution camera input before segmentation to stay within mobile WebView memory limits. The selected cutout is sent through the server to AI PRO API for the artistic transformation. Capacitor packages the same interface for iOS and Android and uses the native camera on devices.

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

## iOS and Android

Capacitor 8 requires Node.js 22 or newer.

Keep `AIPRO_API_KEY` on the deployed server. Before building the native app, set the public URL of that server route:

```sh
VITE_STYLIZE_API_URL=https://your-domain.example/api/stylize
```

Then build and sync the web assets into both native projects:

```sh
npm run cap:sync
```

Open a platform project with:

```sh
npm run cap:ios
npm run cap:android
```

The iOS command requires Xcode; the Android command requires Android Studio. Whenever the web code changes, run `npm run cap:sync` before building the native app again.

## Checks

```sh
npm run check
npm run build
```

The first segmentation can still take a moment while the device initializes WebGPU or WASM, but the model files are read from the app bundle and do not require a network download.
