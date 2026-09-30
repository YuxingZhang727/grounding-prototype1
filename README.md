# SEE — Grounding Collage Prototype

A mobile-first visual grounding exercise that helps people notice things around them, separate those objects from a photo, and arrange the resulting cutouts into a personal collage.

## App framework

The default launch now opens `/app`, a portrait-first application shell based on the existing Figma direction. Its top-level destinations are Home, History, Exercises, Archive, and Profile. The mobile version keeps these destinations in a safe-area-aware bottom bar; widths from 900 px use a sidebar. Each destination has a working framework, while Digital Grounding remains the implemented exercise.

Digital Grounding opens as a focused flow without the global tab bar. A persistent step control lets people move among TOUCH, SEE, and HEAR or leave for Exercises. Step changes create navigation history, so browser and native back gestures remain meaningful. On mobile, each TOUCH question is composed as one app screen instead of stacking the preview and controls into a long page.

The web viewport uses `viewport-fit=cover`, and custom controls apply `env(safe-area-inset-*)` independently on all four edges. Backgrounds remain full bleed. Foreground text, buttons, step controls, and navigation stay inset. The iPhone and Android builds are portrait-only; iPad keeps portrait and landscape support, and the normal web build remains responsive.

## Current flow

1. Describe a remembered touch and generate the journal background.
2. Continue into SEE and take a photo or choose one from the device.
3. Paint positive or negative brush strokes directly over the object using MediaPipe's native stroke interaction.
4. Review the live mask on the source photo, confirm it, then inspect the enlarged cutout in a fixed-size preview.
5. Continue to “Make sticker” and transform the cutout with an AI image-editing model.
6. Arrange the collected pieces over the generated tactile background.
7. Continue to HEAR, record a sound tape, pull out a chosen length, and drag down to tear it into a focused audio preview.
8. Save the tape to the listening library if desired, then add it to today's journal to complete TOUCH → SEE → HEAR.

## HEAR sound tape

Open `/?start=sound` to preview HEAR directly, or choose “Continue to HEAR” after SEE. Hold to record and release to stop, or use the hands-free start/stop buttons. Each recording is capped at 30 seconds. Four aligned rows of dots respond to loudness through spacing and size. A continuous spectral-brightness mapping moves the tape from warm clay toward sage without abrupt palette changes; richness only adjusts saturation. These are descriptive audio features, not pitch recognition or sound classification. Quiet audio keeps the pattern close to its regular grid.

Recordings are saved only when the user chooses “Save this tape.” IndexedDB stores the audio Blob, feature frames, waveform trace, name, and duration in `grounding-sound/rolls`; clearing app/site data removes them. Dragging down at the machine opens a focused preview with a tape-shaped player. “Add to today’s collage” places the chosen strip on the final journal page.

Finished SEE cutouts are stored as reusable stickers in `grounding-artifacts/stickers`. The collage editor shows saved stickers and sound tapes in a reusable materials tray. Deleting a saved item removes it from future trays and Archive while leaving any copy already placed on the current journal page intact.

`src/lib/SoundTape.svelte` owns microphone lifecycle and controls; `src/lib/sound-tape.ts` owns feature analysis, SVG generation, and roll storage. Capture uses `getUserMedia`, Web Audio and MediaRecorder with runtime MIME detection (MP4 preferred when supported). Nothing is uploaded. Backgrounding or leaving HEAR stops the microphone. iOS has `NSMicrophoneUsageDescription`; real-device permission, interruption and playback checks are still required after installing the Capacitor build.

The prototype uses SvelteKit and Capacitor. Web and native-shell builds use the bundled MediaPipe Interactive Segmenter v2 stroke API. MediaPipe runs in a Worker, renders the live mask on top of the source photo, and generates the transparent preview separately. High-resolution camera input is resized before segmentation. The selected cutout is sent through the server to AI PRO API for the artistic transformation. Capacitor packages the same interface for iOS and Android and uses the native camera on devices.

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

### Apple Watch

The Apple Watch app is part of the existing Capacitor iOS project, not a second standalone iPhone app:

```text
ios/App/App.xcodeproj
├── App                    # Capacitor iPhone/iPad target
└── Grounding Watch App    # Native SwiftUI watchOS target
```

The Watch sources live in `ios/App/WatchApp`. They collect live heart rate during a user-started Mind & Body session, estimate wrist-motion intensity, and record a 0–10 momentary anxiety check-in. The Watch target is embedded in the Capacitor `App` target and uses the companion bundle identifier `com.yuxingzhang.grounding`.

`WatchSignalPlugin.swift` receives WatchConnectivity messages in the iPhone target. The web layer subscribes through `src/lib/watch-signal.ts`: Home shows the current BPM, session baseline difference, wrist motion, elapsed time, and connection state; History shows the momentary anxiety check-ins recorded on Watch.

The Watch interface is intentionally a compact instrument rather than a separate content app. Its main screen stays on live collection. “记录焦虑” opens a temporary Crown-controlled 0–10 input sheet; saving or cancelling returns directly to the live signal screen. While a measurement is active, Watch sends a fresh snapshot to iPhone once per second.

The first arousal-estimation prototype lives in `src/lib/arousal-estimator.ts`. It combines fresh Watch heart rate with the in-session heart-rate baseline and, when available, the user's 14-day HealthKit baselines for resting heart rate, HRV, and respiratory rate. Wrist movement discounts the live-heart-rate contribution because activity can raise BPM independently of anxiety. The output is an explainable 0–100 prototype index with a confidence label, never a diagnosis or a claim that anxiety was detected.

The intervention policy maps that estimate to one of four choices: Breathing, Mindfulness, Standard Grounding, or Creative Digital Grounding. It also returns an intensity, card prominence, and a suggested time before checking again. These thresholds are intentionally conservative product heuristics for testing the technical pipeline; they are not clinically validated and should be calibrated with user research and appropriate clinical review before any health-facing release.

`npm run cap:sync` updates Capacitor web assets and packages but does not remove the custom Watch target. Use the `App` scheme with a paired physical iPhone and Apple Watch to test HealthKit, wrist-down collection, and WatchConnectivity.

## Checks

```sh
npm run check
npm run build
```

The first segmentation can still take a moment while the device initializes MediaPipe WebAssembly/WebGL, but the model and runtime files are read from the app bundle and do not require a network download.
