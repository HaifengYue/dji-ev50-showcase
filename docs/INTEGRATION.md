# EV50 / Transwing native hangar

## Architecture and branch boundary

This integration starts from main commit `3b1887e23465824d3452eb4052e793e1f55b3469` and imports the published Transwing source at `2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3`. The source branches have independent history, so the work is a structured migration on `main-copy-transwing`, not a whole-tree replacement. Neither source branch nor the standalone Transwing site is updated.

The Vite app remains `threejs/`. One WebGL renderer, canvas, scene, render pass and animation loop serve the selected aircraft. The registry lists capabilities and cameras. The selection controller aborts previous work, disposes the old instance, and accepts only the newest completion. A GLTF parse cannot itself be aborted; late parsed resources are disposed before mounting.

EV50 uses its original flight/telemetry/airframe logic. Transwing has a lazy-loaded native adapter with reusable kinematics, motors, runtime, camera-framing and rotor-exposure modules. It uses the same host product stage and dynamic landscape; its former private hangar, grid, floor and lighting are not constructed. A 180-second shared FlightController mission drives world pose while its adapter translates route phases into model-specific mechanisms. It does not mount React, another Canvas, an iframe or a second app. Models are exclusively instance-owned and unloaded on switching; the browser HTTP cache may reuse downloaded bytes. Shared terrain and EV50 environment belong to the host.

## Usage

The top hangar selector supports EV50 and TRANSWING P4. Direct URLs use `?aircraft=ev50` or `?aircraft=transwing`; other query parameters are retained. Unknown aircraft values fall back to EV50. Same-page Back and Forward select the matching airframe. After a full-page BFCache return, the existing renderer/listeners are retained while the disposed selection and aircraft resources are rebuilt; a lost WebGL context uses a full reload fallback. A failed model can be retried locally or replaced by selecting the other aircraft.

Shared navigation provides product/flight modes, playback, seek, speed/loop, quality and image/video capture. Transwing mechanism progress is shown as percent, flight/Python time as seconds, and JSON playback as frames. Replay transport remains usable with 0.1×/1× speeds while mode/loop are locked; Python locks transport until explicit release. Transwing's scoped rail contains its mechanism, view, surfaces, motors, system concept and Python/replay controls. On small screens, use “展示设置”. Model and example URLs resolve relative to the deployment path, including a nested path rather than requiring the domain root.

Switching stops the previous airframe, clears imported/replayed state, closes its transport, invalidates pending callbacks and releases its model resources. Re-entering an aircraft starts with fresh state. Pending screenshot/video output is canceled on a switch; finish a capture first to keep it.

## API isolation

The recommended common entry point is `window.hangarAPI.request`, with normalized state, validated configuration, selection generations, exclusive control leases and post-render applied acknowledgements. The companion `control:hangar` service supplies one loopback-only origin for both aircraft. See [the complete unified contract and compatibility map](UNIFIED_CONTROL.md).

`window.hangarAPI.list()` returns supported aircraft and capabilities. `state()` reports selected/current/pending/ready state and the active descriptor. `select('ev50' | 'transwing')` performs the same validated transition as the UI. `window.hangarDiagnostics` exposes read-only diagnostic snapshots for acceptance tests.

The existing `window.ev50API` and `ev50-command` interface remain EV50-specific. While Transwing is selected, the EV50 gateway reports `NOT_READY`; its 11-rotor telemetry is never reinterpreted as a four-motor command. EV50 subscriber registrations are cleared when leaving that aircraft.

The optional EV50 HTTP bridge aborts requests on switching. It retains the command cursor and an immutable original-result outbox. Failed result POSTs are retried before polling without executing the command again, even across aircraft changes. It quarantines the first resumed batch as `STALE_SELECTION`; issue fresh commands after EV50 reconnects. This prevents queued prior-selection commands from acting on the new instance.

Transwing keeps its independent `transwing.sim.v1` protocol through the optional same-origin loopback Python bridge. Its authoritative external clock, pose-before-ACK rule, replay cancellation and local ownership lockouts are retained. The static hosted page does not probe localhost. See [Python instructions](../models/transwing/PYTHON.md).

## Source fidelity and limits

The runtime GLB and native Blender model hashes are unchanged from the published Transwing commit. Mechanism code retains the continuous wing joints, rods, folded blades, independent surfaces, and rotor exposure layer. The host renderer version remains Three.js 0.170; no framework dependency upgrade was needed.

These are reconstructed visual studies, not manufacturing geometry, a dynamics solver, a flight controller or an airworthiness assessment. Concept systems are separately labeled. Unit/geometry checks are distinct from browser rendering and real GPU/performance measurements; consult [the verification record](INTEGRATION-VERIFICATION.md) for actual passed, pending and blocked stages.
