# Posture Coach — betterhood

A real-time posture coach that runs entirely in the browser. It watches your webcam, learns *your* upright posture as a personal baseline, and gently flags it the moment you drift from it — no account, no upload, no server.

**Live app:** https://vivekgwork-cmd.github.io/betterhood-posture-detector/

## Why calibration instead of "ideal posture" detection

Everyone's neutral sitting position differs (camera angle, chair height, neck length, desk setup), so this tool doesn't try to judge posture against a generic ideal from a single frame — an earlier single-photo approach (judging an unknown photo's posture from absolute geometry) proved far noisier and harder to get right than expected. Instead it follows the same approach used by real commercial posture trackers (SitCoach, SitSense, Slouch Sniper): calibrate to the *same person's* own upright pose, then measure drift from that baseline. This sidesteps needing to define "correct" posture in the abstract.

## How it works

1. **Start the camera** — `getUserMedia` requests webcam access; nothing is recorded or transmitted.
2. **Set your reference** — a 3-2-1 countdown captures ~15 frames of your own upright pose and averages them into a baseline, stored only in `localStorage` on your device.
3. **Continuous tracking** — [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) (`pose_landmarker_lite`, `VIDEO` running mode) detects your pose several times a second. Each frame is compared against your baseline using three scale-invariant signals:
   - **Neck compression** — nose-to-shoulder distance shrinking relative to shoulder width (head sinking/craning down)
   - **Zoom-in** — shoulder width growing relative to baseline (leaning in closer to the screen)
   - **Tilt drift** — shoulder-line angle deviating from baseline (leaning to one side)
4. A weighted deviation score is compared against hysteresis thresholds, requiring several consecutive confirming frames before flipping the status pill — this avoids flicker on normal fidgeting.

All inference runs on-device via WASM/WebGL (GPU delegate with automatic CPU fallback). No frame, landmark, or measurement ever leaves the browser tab.

## Tech stack

- Single static `index.html` — no build step, no framework, no dependencies to install
- [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) loaded from CDN (jsdelivr) as an ES module
- Branding assets (`bh-logo.svg`, `bh-favicon.webp`) pulled from the live [betterhood.in](https://betterhood.in) site

## Running locally

No build step — just serve the directory and open it:

```bash
npx serve .
# or
python -m http.server 8080
```

Open the served URL in a browser. `getUserMedia` requires a secure context; `localhost` and `file://` both qualify in Chrome.

## Key tunables

If live testing shows the sensitivity feels off, these live in the `<script>` block of `index.html`:

| Constant | Location | Purpose |
|---|---|---|
| `BAD_THRESHOLD` / `GOOD_THRESHOLD` | `deviationScore()` caller | Hysteresis band for flipping Upright ↔ Slouching |
| `HOLD_FRAMES` | top of script | Consecutive confirming frames needed before a state flip (flicker guard) |
| Weights in `deviationScore()` | `compression*3.4 + zoomExcess*1.7 + (tiltDelta/90)*1.2` | Relative contribution of each drift signal |
| `DETECT_EVERY_N_FRAMES` | top of script | Throttles detection rate to save CPU/battery |
| `modelAssetPath` | `initPose()` | Currently `pose_landmarker_lite`; swap to `_full` or `_heavy` for more accuracy at the cost of load time and per-frame latency |

These constants were reasoned from first principles, not tuned against a large real-world dataset — expect to adjust them based on real usage feedback.

## Future upgrade possibilities

Roughly ordered by expected impact vs. effort:

- **Exposed sensitivity control** — surface `BAD_THRESHOLD`/`GOOD_THRESHOLD` (or a single "sensitivity" slider that derives both) in the UI instead of requiring a code edit.
- **Audio / desktop notifications** — use the [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API) or a subtle sound so slouch alerts work even when the tab isn't focused.
- **Multi-day history** — opt-in persistence (IndexedDB) of daily upright/slouch time, so users can see trends instead of only the current session's counters.
- **Multiple calibration profiles** — e.g. "desk chair" vs. "standing desk" vs. "laptop on the couch", switchable without re-running the countdown each time.
- **Model tier toggle** — let users opt into `pose_landmarker_full` (or `_heavy`) for more precise tracking on capable hardware, falling back to `_lite` automatically on slower devices.
- **Break reminders** — combine posture tracking with a Pomodoro-style stand-up/stretch nudge, since sustained good posture in a static position is still not great ergonomics.
- **Wrist/elbow tracking** — extend `frameMetrics()` to watch wrist and elbow landmarks for typing-related RSI cues, not just neck/shoulder/trunk posture.
- **PWA / offline support** — a service worker caching the MediaPipe WASM + model files would let this work offline after first load and be installable.
- **WebGPU delegate** — MediaPipe Tasks Vision supports a WebGPU delegate on newer browsers; worth benchmarking against the current WebGL/CPU path once support is broader.
- **Accessibility pass** — announce status-pill changes via `aria-live`, add captions/text alternative to the countdown overlay, verify full keyboard operability.
- **Automated regression testing** — a headless Puppeteer harness (used during development to validate the scoring math against sample photos) could be checked in and run in CI to catch scoring regressions when tuning constants.
- **Integration with betterhood's Care Tools** — shared progress/account across betterhood's broader wellness tool suite, if/when that becomes a product priority.

## Privacy

No camera frame, landmark, or measurement is ever sent to a server. The only thing persisted is the calibration reference (a handful of numbers), saved to `localStorage` on the user's own device. Closing the tab discards the live session; clearing browser data or clicking "Recalibrate" discards the saved reference.
