# Transwing native-source rebuild

## Source and scope

The current pipeline and authored assets come from the published Transwing
snapshot at commit `2ecb723`. The sole current full-airframe geometry input is
`assets/blender/xp4.blend`, pinned by
`scripts/data/current-model-contract.json` to SHA-256:

`4bb048190cd9fc5009f2b4090711cae157a4df37cd056b0e32d5a2a77fca07b3`

The committed browser model lives at
`../../threejs/public/transwing/models/xp4.glb`. Its imported SHA-256 is:

`380e44e92fa9790e2e7145bded8d15b2bcab3480a147776c8246486f9bb35c4d`

This is a rebake/export of the current editable native source. Historical
construction scripts, candidate assets and prior acceptance reports are not
required or copied. Historical filenames retained inside immutable lineage
metadata are provenance, not missing executable dependencies.

The original geometry, topology thresholds, animation and mechanics code is
preserved. Integration changes are path/dependency wiring: runtime checks import
the native core in `../../threejs/src/aircraft/transwing/core`, and the manifest
template is read from `../../threejs/public/transwing/models/manifest.json`.
The Three.js imports deliberately use the host's installed module and loaders,
so the checks and runtime rig share a single Three.js instance (currently 0.170).

## Install

Use Node.js 24, Python 3.12 and Blender 4.3.2, the source pipeline's documented
versions. Blender supplies `bpy`, `bmesh`, `mathutils` and NumPy for its checks;
the rebuild/verification launcher itself uses Python's standard library.

Run every command below from `models/transwing`:

```sh
# Install the host runtime dependencies if they are not already installed.
npm ci --prefix ../../threejs

# Install only the locked compression and TypeScript-loader tools here.
npm ci --prefix scripts --ignore-scripts
```

The scripts package pins glTF-Transform 4.5.1, meshoptimizer 1.3.0 and tsx 4.20.6.
`scripts/run-node.mjs` resolves that local tsx installation, so a global tsx
installation is unnecessary. Dependency installation does not run Blender.

## Lightweight checks

```sh
npm run check
npm test
```

The preflight checks the authored source and published runtime hashes, required
current files, Python syntax, JavaScript/TypeScript syntax and the local import
graph. The tests cover semantic material-owner assembly and loading the actual
published GLB through the host Three.js/native rig. They do not constitute a
fresh export or physical-motion acceptance.

## Rebuild and inspect generated output

```sh
npm run build:model

# Or choose Blender explicitly, including a path containing spaces:
python3 tools/rebuild_model.py --blender /path/to/blender

# Optional: additionally retain a large derived, animation-baked Blender file.
python3 tools/rebuild_model.py --save-baked-blend
```

The launcher checks the source hash, rebakes in memory, exports and compresses,
then checks source/runtime identity, baked animation, native rig compatibility,
semantic topology and the complete owner inventory. Output, command logs and
`REBUILD_RECEIPT.json` are written under ignored `build/model/`. The authored
`.blend` and the published browser assets are not replaced by this launcher.
Do not invoke the legacy `scripts/export-transition.py` entry point directly:
its standalone mode saves native assets; the safe rebuild wrapper imports its
helpers and directs all generated output into the build stage.

After a successful rebuild:

```sh
# Extra exact source/runtime animation and negative identity checks.
npm run test:pipeline

# Rerun generated-output gates without another Blender rebake or compression.
# Requires the complete current build/model output from an earlier rebuild.
python3 tools/rebuild_model.py --verify-only
```

The stage manifest is generated as `build/model/model-manifest.json`; promotion
to the host's `manifest.json` and GLB is a separate reviewed step. A rebuilt
candidate does not automatically authorize overwriting the published model.

## Physical verification

```sh
# Full finite-state suite; first requires a successful same-source rebuild.
npm run verify:model

# Optional control-only smoke check. This never reports full acceptance.
python3 tools/verify_model.py --quick

# An explicit Blender path works for either mode.
python3 tools/verify_model.py --blender /path/to/blender
```

Full verification checks the current-source topology receipt before running the
wing, folding/rotor, local and combined controls, internal-drive, same-owner
self-intersection, identity/aperture, support/thread and slot-clearance checks.
Reports and logs are written under ignored `build/verification/`; inspect
`PHYSICAL_RECEIPT.json` or the separate `SMOKE_RECEIPT.json` for actual completion.
The finite samples are not proof of continuous collision freedom, strength,
manufacturability or airworthiness.

## Integration verification status

For this integration, the source/runtime hashes and required paths were checked;
20 Python files parsed, 27 JavaScript/TypeScript modules parsed, and the host
runtime/rig smoke check plus three semantic-owner tests passed. The installed
host Three.js version was 0.170.0.

The Blender rebake/export, staged source/runtime acceptance and full physical
verification suite have **not been re-run for this integration**. Existing
published model metadata must not be presented as a new same-run receipt.
No generated acceptance receipts or historical evidence were copied into this
checkout.

## Native host mechanics regression

From `models/transwing`, run `npm run test:core` (about 35 seconds on this host).
It runs the 16 preserved pure/core/model test files, currently 109 tests,
against the host's current native core, actual deployed GLB and Three.js 0.170.
No external Transwing checkout is required. The fixture test sources are under
`qa/core`; run them through the provided command, which recreates their original
relative layout in a temporary directory and always removes it in `finally`.

Only the synthetic camera event harness is adapted from three-stdlib to native
OrbitControls: `_dollyIn`/`_dollyOut` plus explicit update, `domElement`/`connect`,
canvas pointer listeners and root-node/pointer-capture doubles. Mechanical
assertions and tolerances are unchanged. React-only component tests are not
included. This Node suite is not browser rendering, GPU/shader verification,
Blender rebake or proof of continuous collision freedom.
