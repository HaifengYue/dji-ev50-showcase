# Native aircraft hangar integration verification

Verification date: 2026-10-08. Integration branch: `main-copy-transwing`.

The deployment remains the single Vite application in `threejs/`. EV50 and Transwing
share its renderer, scene, canvas, animation loop, and outer navigation. Transwing is
loaded as a native adapter, not as an iframe or second React/rendering application.

## Source boundary

- EV50 base: `3b1887e23465824d3452eb4052e793e1f55b3469`.
- Transwing source: `2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3`.
- Transwing's mechanism/runtime modules live under
  `threejs/src/aircraft/transwing/core/`; its native host, camera, panel, presentation,
  and cleanup code surround that core.
- `threejs/src/aircraft/selection.ts` owns asynchronous selection and disposal.
- EV50 telemetry/API operations remain EV50-specific. Selecting Transwing makes
  the EV50 gateway report not-ready and prevents its commands reaching an airframe.

## Verified locally

The following checks ran against the integrated sources, including the fixes found
during this review:

```sh
npm run ci
npm --prefix models/transwing run check
npm --prefix models/transwing test
```

- **Root aggregate CI: passed**, including formatting, TypeScript/Vite build, all EV50 API/telemetry/presentation/flight/model/airframe checks, 109 Transwing mechanics tests, and 30 Python bridge/protocol tests. EV50 GLB validation reports zero errors and 36 existing warnings.
- **Hangar suite: 47 passing checks**: 19 selection-lifecycle cases and 28 integration
  contract cases.
- **TypeScript + Vite production build: passed.** Vite reports the existing class of
  bundle-size advisory for the shared Three.js chunk (approximately 532 kB
  minified). This is a warning, not a failed build.

The hangar tests transpile the real TypeScript modules and run them in Node using
real Three.js math, cameras, scene graphs, materials, and disposal events. They use
explicit DOM/event-target, fetch, timer, canvas, and encoder doubles where needed.
They do **not** run a browser, create a WebGL context, measure actual GPU memory,
encode a PNG/video, or establish visual correctness.

### Supplemental original Transwing mechanics tests

The committed runner `npm --prefix models/transwing run test:core` preserves 16 original Transwing test files and passes **109 tests, zero failed/skipped** against integrated Three.js 0.170 and the actual deployed GLB. It creates a temporary native-module harness and removes it in a finally block. The source fixtures and runner are included in this branch, and this command now runs in the root CI aggregate.

Coverage included flight/experience/tilt, actual model and rig geometry, rotor
folding/interlocks/clearance, exposure presentation, shadows, and camera math with
synthetic pointer input. Mechanical assertions were unchanged. The camera harness
was adapted from `three-stdlib` to native Three.js `OrbitControls` entry points,
private dolly helpers, and DOM event-target/capture doubles. React-only UI/source
tests were excluded. This supplementary run does not establish browser rendering
or GPU behavior, and runs separately from `test:hangar`. The five lightweight pipeline/presentation tests also pass; their hatch test sweeps 222 actual-GLB hatch/wing endpoint poses and maintains minimum Y=-0.6 above the -0.63 floor. Source/hash/path preflight passes. A fresh Blender rebake and exhaustive physical suite were not run because source geometry is unchanged; those remain separately documented commands.

### Selection lifecycle (19 cases)

- Initial, pending, ready, failed, and disposed state.
- Repeated pending selection shares one promise and one load; ready same-ID
  selection is a no-op.
- Active aircraft is detached from controller state and disposed before replacement
  callbacks/load run.
- Latest selection wins even when old loaders ignore abort or resolve out of order.
- Superseded selection promises settle immediately; a loader cannot leave its caller
  waiting indefinitely by ignoring abort.
- Late results are disposed once; stale failures do not notify or overwrite state.
- Failure followed by retry, synchronous loader exceptions, and terminal/idempotent
  teardown.
- Reentrant pending, ready, error, abort, loader, and dispose callbacks.
- Throwing consumer callbacks and dispose hooks cannot produce unhandled promise
  rejections or strand controller ownership.
- A 100-switch alternating stress case leaves only the newest instance active and
  disposes all 100 instances exactly once after teardown.

### API, async work, and state isolation

- Registry IDs, query-string selection, invalid-ID fallback, and separate capability
  declarations.
- EV50 gateway refuses all flight, settings, and visual/telemetry operations while
  another aircraft is selected.
- Stopping the HTTP bridge aborts its request and ignores a late command response.
- A late final results POST cannot erase re-entry quarantine. The command cursor
  survives selection changes; the first resumed batch receives `STALE_SELECTION`,
  and subsequent new commands execute normally.
- Failed result acknowledgments stay in a per-bridge outbox. They retry the original
  command ID, sequence, and response before another command poll, without repeating
  its side effects. Pending acknowledgments survive aircraft switches; a late old
  callback cannot erase the new selection's quarantine.
- A delayed acknowledgment preserves the first resumed batch's sequence cutoff.
  Remaining stale commands are rejected, duplicate sequences are ignored, and newer
  commands are accepted instead of being swept into an expanding stale batch.
- EV50 reset clears replay, recording, current frame, pause state, and transport.
  An already-queued old WebSocket callback cannot reactivate the previous session.
- Switching away cancels ULog fetches and invalidates uncancelable `file.text()`
  completions. Repeated imports are latest-wins, including stale errors.
- Entering Transwing motor control neutralizes active detail actuators without
  resetting the chosen camera. Independent surface input preserves other surface
  and hatch values. Separate runtimes do not share mutable state.

### Camera, resource, and capture ownership

- Shared geometry, material, and texture identities are disposed once, including
  replaced original materials no longer present in a scene graph.
- Transwing resource owners do not dispose another aircraft's resources.
- Failure while constructing Transwing presentation removes the partially installed
  scene group.
- Perspective/orthographic framing, interruption by a newer frame request, reduced
  motion, portrait resize preserving orientation/zoom, and event-listener teardown.
- External movement during a camera transition retains the entire world-space
  displacement instead of losing the portion received during interpolation.
- Pending screenshot and video outputs are canceled when aircraft selection changes.
  Late callbacks cannot publish into or overwrite the replacement aircraft's status.
  Video tracks are released; new captures work after the switch.

Capture switch semantics are deliberate: completed downloads remain available;
outputs still being generated/finalized when switching aircraft are discarded. This
also applies to an explicitly stopped video that has not finished encoding yet.
Save or finish a recording before switching if the output must be retained.

## Browser verification limit

A real Chromium launch was attempted in this execution environment, including a
writable `/tmp` user-data directory. It terminated before opening a page:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

No security/sandbox bypass was attempted. Therefore browser/WebGL results must not
be inferred from the Node results above. No actual screenshots, rendered-frame
comparison, measured GPU-resource plateau, visual picking, mobile interaction, or
real video-encoding acceptance has been established by this verification pass.

The repository includes a separate Playwright acceptance suite and a loopback
production preview under a nested `/hangar/` deployment path. In an environment
with its configured browser installed and permitted to launch, run:

```sh
npm --prefix threejs run build
npm --prefix threejs run test:browser
```

Record that result separately. A test file's existence or successful test discovery
is not evidence of successful execution.

## Remaining browser acceptance checklist

1. Open `/hangar/`, `?aircraft=ev50`, `?aircraft=transwing`, and an invalid aircraft
   query. Check direct-link reload, title/labels, native controls, and all asset paths.
2. Exercise each model, then switch EV50 → Transwing → EV50 repeatedly. Confirm a
   single primary scene canvas, one active animation loop, and no duplicate panels,
   input listeners, lights, model roots, or network streams.
3. Throttle model loading, switch repeatedly before completion, and let all requests
   finish. Only the final selection may appear. Simulate one failed load, then retry
   the same aircraft and switch to the other aircraft.
4. Use Back/Forward during loading and during active playback. Verify selected URL,
   active model, panel, camera, and public diagnostics remain consistent. Same-page
   history navigation uses selection updates. A full-page Back/Forward Cache restore
   uses `pageshow.persisted` to create a fresh selection and aircraft resource set
   inside the retained renderer/host listeners. A lost WebGL context falls back to
   reload. It never resumes a disposed selection controller. The browser test records
   whether a genuine persisted return occurred and also invokes the persisted-event
   handler deterministically; those evidence types remain distinct.
5. Check EV50 demo routes, 8+3 rotors, MAVLink/ULog replay, sensor cameras, annotations,
   and scene controls. They must not affect Transwing; switching back starts a clean
   EV50 session without replaying queued bridge commands.
6. Check Transwing wing tilt through the full range, left/right joint views, four
   independent motor sequences, six independent surfaces, cargo hatch, internal
   drive view, concept-system load/error, wireframe, and exploded display.
7. Verify mode/slider/motor/detail actions preserve the intended user camera. Check
   rapid camera changes, external tracking, reduced-motion preference, portrait and
   landscape resize, close zoom, and orthographic-to-perspective transitions.
8. While importing recordings or loading concept geometry, switch aircraft or close
   the panel. Late success/error callbacks must not resurrect stale content.
9. Start a PNG/video capture, switch aircraft before completion, and verify canceled
   output cannot overwrite the new selection. Then capture the new model and inspect
   the actual PNG/video and its filename.
10. Compare `window.hangarDiagnostics` after warm-up across many completed round
    trips. Geometry/texture counts should settle around each aircraft's repeatable
    baseline rather than grow monotonically. Also inspect browser network and event
    listeners; counts alone are not a leak proof.
11. Check Low/Medium/High quality, context loss/recovery guidance, keyboard Escape and
    Space behavior, touch/orbit/zoom, and narrow-screen panel accessibility.

For complete non-browser repository validation, run `npm run ci` at the repository
root after all edits. Keep that aggregate result distinct from these focused checks
and from browser acceptance.
