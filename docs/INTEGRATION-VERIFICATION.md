> Historical integration record (not a current acceptance report): Transwing is now named SkyTrans in the current application. Historical names, commits and measurements below are retained as evidence. See [brand migration](BRAND-MIGRATION.md) for the current contract.

# Native aircraft hangar integration verification — historical record

Verification date: 2026-10-08, with later notes dated in their sections. Integration branch: `main-copy-transwing`.

Commands, paths, durations, counts and pending items below describe those revisions, including pre-brand `models/transwing` commands and the former 57-second demonstration. For current commands use [CONTRIBUTING](../CONTRIBUTING.md); for current architecture and 316-second SkyTrans behavior use [INTEGRATION](INTEGRATION.md). Do not rerun historical commands blindly or treat an old “remaining” item as a current failure.

The deployment remains the single Vite application in `threejs/`. EV50 and Transwing
share its renderer, scene, canvas, animation loop, and outer navigation. Transwing is
loaded as a native adapter, not as an iframe or second React/rendering application.

## Source boundary

- EV50 base: `3b1887e23465824d3452eb4052e793e1f55b3469`.
- Transwing source: `2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3`.
- Transwing's mechanism/runtime modules live under
  `threejs/src/aircraft/skytrans/core/`; its native host, camera, panel, presentation,
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
- **Hangar suite: 53 passing checks**: 19 selection-lifecycle cases and 34 integration
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

## Real-browser CI, first pass and corrections

Commit `fb2852ec9710f1b4563c3e178d2516ef0bfd90a3` completed its normal GitHub CI successfully. The separate Chromium run [37787658539](https://github.com/HaifengYue/sky-captain/actions/runs/37787658539) executed real WebGL and passed five of seven browser cases. It produced actual EV50, Transwing and narrow-screen screenshots; these were inspected.

The failed-load retry exposed a genuine UI defect: the button inherited the original headline's pointer-transparent style. It is now explicitly pointer-enabled and remains tested with a normal click, not a forced click. Screenshot review also showed low-contrast HUD/footer text over Transwing's light background; scoped dark backdrops now preserve readability.

The four-round, high-quality resource test reached its 90-second whole-test deadline during the fourth Transwing load on software rendering. Three earlier rounds completed and the last error snapshot showed the model ready. Its total budget is now 240 seconds; the per-load 30-second expectation and all geometry/texture/state assertions remain unchanged. This is not evidence of a passed resource plateau until the rerun completes.

The suite now also exercises the native motor/surface/hatch/concept/JSON controls. Mobile testing uses touch emulation, checks the collapse button is in the viewport and tappable, checks a touch drag changes the camera after collapsing, and saves a separate aircraft-visible screenshot.

The genuine full-page return in the first pass did not use BFCache (`observedPersistedReturn=false`). Ordinary Back restored correctly, and the separate deterministic persisted-event handler test passed. These are distinct claims; this does not establish that Chromium actually chose BFCache caching.

## Second browser pass and final verification gates

Commit `107ca9514cb2b365fc607ca2a7d75f37c6704ebe` passed normal CI and [all eight Chromium cases](https://github.com/HaifengYue/sky-captain/actions/runs/37790606031). Retry now receives a real click; touch collapse/drag, independent motor and surface input, cargo hatch, systems concept and bundled JSON playback passed. Screenshot review confirmed improved HUD/footer contrast.

Inspection of the resource attachment showed some EV50 counts were captured before its first full rendered frame. The final acceptance gate is stronger: it ties render completion to the current selection revision, waits at least two more completed frames, requires nonempty GPU geometry, and compares every same-aircraft sample across four rounds. The previous eight-pass result alone is not treated as sufficient resource-plateau evidence.

The final shared timeline/transport matrix is:

- Local mechanism: 0–100% shape progress, actual 0.25–2× tilt rate and actual repeat flag; play/pause, seek, restart and mode changes enabled.
- Local flight demonstration: simulation seconds over the 57-second sequence, actual 0.25–4× rate and loop; all local transport enabled.
- JSON replay: one-based frame readout with zero-based seek index, actual 0.1×/1× replay rate; play/pause, seek and restart enabled; mode changes and loop disabled.
- Python ownership: live simulation seconds with no invented duration; mode, playback, seek, restart, rate and loop disabled; observation cameras remain usable. Explicit release restores local controls and percent units.

Pure snapshot/HUD tests cover all four modes and return-to-local lock removal. Production seek/rate/loop method tests cover percentage round-trip, frame clamps, supported replay rates and external no-ops. A real loopback Python server is included in the final browser suite to verify external time remains unadvanced by RAF, commands receive applied acknowledgments only after the viewer applies them, and release restores all shared controls. That additional browser result must be read from the final CI, not inferred from its test source.

## Third browser pass: stricter resource and external-clock evidence

Commit `50dc1b7a7967e568d3f0101dffbcbf54c2088ff3` passed normal CI; its [third browser run](https://github.com/HaifengYue/sky-captain/actions/runs/37793804458) passed seven of nine cases. The stricter, rendered-revision-gated four-round samples were identical per aircraft: Transwing 241 geometries/16 textures/7 scene children; EV50 120/17/5. These are Three.js resource counts, not measured physical VRAM bytes or a hardware performance benchmark.

The real loopback Python case passed: same-origin viewing, external clock ownership, applied acknowledgments after model updates, and release restoring all controls. The remaining failures were measured software-renderer wall timing: the multi-view case reached its whole-test 90-second limit on the final EV50 return; the motor test reached 30 wall seconds while its simulation had advanced only from 1.1 to 2.9595 seconds and was still progressing from indexing to folding.

The final test instrumentation avoids continuous trace screenshots, which repeatedly read back the software-rendered canvas. DOM/network traces, explicit acceptance PNGs and failure PNGs remain. The multi-view whole-test budget is 180 seconds. Motor shutdown retains the exact folded/rpm0/fold1 terminal assertions and has two independent failure bounds: 90 wall seconds, and the modeled worst-case deceleration + full-turn indexing + folding duration with 0.2 simulation-second margin. A running simulation that exceeds that modeled bound without folding fails immediately. No product simulation time, geometry, dynamics or per-load/resource gate was relaxed.

## Dependency audit

The first CI install reported an inherited transitive `source-map-js` 1.2.1 advisory. The [reviewed advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) concerns denial of service while consuming specially crafted indexed source maps. Only the lockfile resolution for this package was patched to 1.2.2; Three, Vite and other dependency versions were retained. The subsequent `npm audit --prefix threejs` reports zero known advisories. This is a dependency audit, not a repository-wide security assessment or evidence of exploitation.

## Browser verification limit

A real Chromium launch was attempted in this execution environment, including a
writable `/tmp` user-data directory. It terminated before opening a page:

```text
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

No security/sandbox bypass was attempted. Therefore local browser/WebGL results must not be inferred from the Node results. The separate GitHub-hosted pass above did produce real screenshots and partial browser evidence. The local environment itself has not rendered those pages; GPU plateau and final full-suite acceptance depend on the subsequent CI run. Real video encoding remains distinct from the PNG test.

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

## Transwing demo-rate regression and browser timing (2026-10-09)

The demo-rate patch adds a 316-second local Transwing profile (3 m/s climb, 2 m/s descent, four-second velocity ramps, six-second shutdown). These are visual-demo choices, not aircraft performance claims. Node coverage checks the actual adapter derivative, acceleration, phase continuity, rate-independent motor samples, seek/pause behavior and ownership isolation. The new Chromium regression exercises every exposed playback rate, reads actual position/time derivatives and rotor phases, checks rear-motor conversion and complete shutdown, and captures the aircraft while playing.

At `c585086`, that new browser regression passed twice. The two runs exposed pre-existing whole-test budget assumptions: the EV50 cold-load/screenshot/export case and the three-readiness history-return case exhausted 90 seconds. The captured trace includes a 35.1-second screenshot, a 41.6-second navigation to the simple away page, and 3–11-second diagnostic reads. Their overall budgets are now 180 seconds; per-readiness assertions and all behavior, geometry, download and resource checks remain unchanged. This is not a claim of real-time GPU performance.

The shared-terrain test also read the follow-camera offset before its intentional 1.05-second transition completed. It now waits for the actual transition state before applying the same `<15 m` offset assertion; no camera behavior or distance threshold is changed. Failed runs and artifacts are retained in Actions rather than hidden by automatic retries. Final acceptance requires a complete successful run for the final commit.

The mechanism/multi-camera/API-isolation case explicitly selects Low rendering quality after the normal initial-load readiness gate. It still loads the real GLB, checks native camera switching and the rendered joint view, checks unchanged camera/rig/API behavior and retains the 30-second transition deadline. This avoids making software-GPU postprocessing speed an implicit requirement of an ownership/interaction test. High-quality rendering remains explicitly exercised by the shared-terrain case, including the High readout, new rendered frames and a live-flight screenshot; the new rate test is also a Low-quality functional check. This suite does not establish real-time performance at High quality.
