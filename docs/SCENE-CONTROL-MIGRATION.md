# Shared scene and control migration

Baseline: integrated branch `main-copy-transwing`, verified commit `ec6852a4e145258c429888c10b1609079b07eef6`. The accepted private preview remains version 1 until the next verified build is explicitly published. The original EV50 and standalone Transwing sources and assets are unchanged.

## Architecture and boundaries

1. The host owns the single scene, renderer, postprocessing, lighting, environment map, exposure, product background, terrain, route map, trail, wind display, visibility and capture. An aircraft adapter cannot replace those shared resources. Product view uses the existing dark EV50 stage; flight view uses the existing landscape and shared route data. Transwing does not create a second warehouse, grid, floor, lights or environment map.
2. Aircraft adapters own their model resources, native mechanisms and camera choices. Transwing's immutable source rig retains independent wing pivots, rods, folding props and surfaces. A parent world transform is separate from those local mechanisms. Shared flight data supplies a visual route, altitude and speed. It is a visual demonstration, not a physical aircraft or flight controller simulation. An explicit Product → Flight selection starts playback and selects the follow camera; repeated Flight clicks while playing are idempotent. Transwing’s paused flight resumes at its existing time and observer view. Returning to Product restores free observation. Mechanism controls never initialize a camera, and occupied external/replay control cannot be seized by these mode buttons.
3. The versioned hangar controller owns validated configuration, explicit aircraft capabilities, control leases, command identity, state normalization and applied acknowledgements. Adapters translate common pose and transport commands to the selected model. Actuators remain explicit, aircraft-specific namespaces; EV50's eleven rotor channels cannot become Transwing's four motor commands.

## Compatibility and authority

- The existing EV50 browser/HTTP and Transwing Python/JSON APIs remain available. Their historical units, replay frames and external step clock remain meaningful; compatibility conversion happens at the adapter boundary.
- Active legacy telemetry/Python/replay ownership blocks a competing unified external lease. A unified external owner blocks local mechanism and route writes. A release, expiry, disconnect or aircraft change ends ownership and cancels unrendered work.
- Accepted does not mean applied. New control commands acknowledge application only after an animation frame applies and renders them. Retrying a command identity returns its stored outcome, without applying a second time.
- Shared world axes are right-handed: +X east, +Y up and +Z south. Distances are metres, time seconds, velocity m/s and quaternion order XYZW. Both source GLBs point their nose toward +Z and have left at -X; no mirror or scale transform is necessary. Each adapter documents its asset origin and any ground datum offset separately.
- Asset hashes and underlying geometry stay unchanged. New controls and clock handling must not loosen the existing mechanical, rotor stop, Python ACK, asynchronous cancellation, outbox or resource-release tests.

## Acceptance gates

Run all repository checks, plus new normalized control/lease/deduplication tests and Transwing terrain/route/coordinate tests. Browser acceptance must demonstrate shared product and flight scenes, explicit camera changes, mechanisms preserving free-camera framing, external clock authority, rejected mismatched actuator commands, late loading cancellation and stable resources across repeated airframe changes. The exact pushed SHA must pass both normal CI and Chromium CI before the preview is considered eligible for update.
