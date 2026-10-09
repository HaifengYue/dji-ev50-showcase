# SkyTrans integrated asset provenance

Imported from the published `Transwing` branch snapshot at `2ecb723d46b90fe509ae5c2ff7c1735a7b66b7b3`. Runtime and authored assets are kept separate: deployed GLBs live in `threejs/public/skytrans/models`, while native Blender sources, animation references, mechanical contract, rebuild/verification tools and the local Python bridge are preserved here.

Core TypeScript modules were copied into `threejs/src/aircraft/skytrans/core` with their mechanics and protocol unchanged. The React-only experience hook was removed, and static asset lookup now uses the host base path. The native adapter uses the main application’s Three.js 0.170 renderer and frame loop.

`nacelle-system-concept.glb` is an independent explanatory concept, not a claim about exact production internals. Model details and limits are reconstructed references rather than certified aircraft geometry or flight-control parameters. No historical deliverable archives are duplicated.

## Imported third-party notices

`THIRD_PARTY_NOTICES.txt` is preserved byte-for-byte from the imported Transwing source snapshot. It documents that source and its pipeline, including dependencies used by its former standalone application. The integrated native runtime does not use React, React Three Fiber, Drei or GSAP. This note does not amend the preserved notices or assert additional permissions.
