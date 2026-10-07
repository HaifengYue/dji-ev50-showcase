# V27 integrated-b full reconstruction

The B geometry is constructed from the unchanged V24 native baseline, through the locked V25/M recipes, current inset layout and I swept skin, then the flat rear, bridge ribs, bores and drive-phase changes. The distributed B Blend, source GLB and runtime GLB are outputs, never primitive construction inputs.

## Normal distributed-package command

Run from the complete unpacked `transwing-studio` package, with Blender and both existing dependency directories available:

```sh
python3 tools/rebuild_inset_revision.py --output ../rebuilt-v27-b --run --deps-from . --hardlink-inputs
```

`../rebuilt-v27-b/transwing-studio` must not already exist and cannot be inside the source project. The default label is `candidate-inset-integrated-b-regenerated`. No npm installation, publishing, upload or writes to the original application outputs occur.

The wrapper performs these steps:

1. Hash-check all 171 construction, pipeline and verification inputs, including the inherited 136 rows without modification
2. Run `tools/verify_package.py` as a separate process in the complete source distribution
3. Create a thin fresh project, copying application sources and the three V27 templates; only the two existing `node_modules` directories are symlinked
4. Clear inherited `TRANSWING_*`, model-path and expected-author-SHA overrides; explicitly set the fresh working directory and absolute Blender script paths
5. Reconstruct the complete native candidate with no I-stage shortcut and compare all 285 meshes and 352 nodes with the frozen B reference
6. Pin the newly generated Blend SHA and freshly bake/compress the candidate, followed by complete source/runtime identity, native identity, actual animation, runtime compatibility, owner inventory, historical inventory, semantic and negative checks
7. Generate the V27 manifest/cache helper, map only these new outputs into the fresh application and run the 176 development tests, QA tests, TypeScript/Vite build, formatting and 26 Python tests
8. Re-check both source and target construction-input identities and retain a detailed execution receipt/logs in `qa/revision-20261007-inset/rebuild-checks`

The thin reconstruction directory is not a complete distribution. Its files must not be checked against a copied full-package `DEVELOPMENT_MANIFEST.json`; the package verification in step 2 deliberately runs before preparation, in the full source directory.

## Other modes

- `--dry-run`: validate inputs and the source distribution and show the command plan without creating the output
- Omit `--run`: actually create and validate the fresh input project without constructing models
- `--run --native-only`: run the complete default native construction and full geometry-reference comparison only
- `--skip-package-check`: development worktree use only; skip the full-distribution manifest check while still checking every locked construction input. This does not claim package verification
- `--blender /path/to/blender`: choose the Blender executable
- `--deps-from /existing/transwing-studio`: reuse that project's root and scripts dependencies without installing anything
- `--hardlink-inputs`: share large immutable frozen input bytes when the filesystem allows it; otherwise copy. Never edit these input hardlinks. Application sources remain independent copies

Large freshly generated native/source outputs may be hardlinked between the new tree's own QA stage and app asset directories to avoid duplicating them. Those links never point to the original B outputs. The wrapper does not overwrite an existing output tree or resume an interrupted run.

## Inputs and evidence boundaries

`REVISION_INSET_CONSTRUCTION_INPUTS.json` preserves the original 82/103/136 chain. The V25 runtime in `assets/baseline-v25-20261007/xp4-runtime.glb` and its separate lock are verification-only historical inventory evidence. They are not consumed by native construction, baking or compression. `V27_PIPELINE_POLICY_INPUTS.json` freezes the already approved 3,800,000-byte development budget; it is not a user hard limit or permission to reduce geometry precision.

The geometry reference is verification-only. It covers complete Float32 vertex inventories, oriented polygons/material association, named parents, local bases and parent inverses. Blend container bytes and labels need not reproduce bit-for-bit, so the fresh actual SHA is pinned after geometry equality. The demonstrated environment is Blender 4.3.2 with NumPy/SciPy and the package's existing Node/Python dependencies. A different environment must still pass the exact reference check.

## Actual validation performed for this delivery

A genuinely new project outside the source tree was built through the full default native chain, with no current B model supplied as an input. Its complete B geometry comparison passed: 285 meshes, 352 nodes and zero differences. That new candidate's actual SHA was then used for fresh baking and downstream pipeline checks. All actual component commands and any repaired setup failure are retained in the delivery's `baked-integrated-b/rebuild-checks` evidence.

The wrapper's preparation path, override sanitization, absolute script routing, copied-input hashes, template mapping and same-length input-tamper rejection were separately executed. The complete native/pipeline/development process was executed component by component. A single uninterrupted `--run` wrapper invocation is not claimed for this delivery.

Neither reproducibility nor development/pipeline checks alone grant whole-machine continuous physical, manufacturing, strength or user-appearance acceptance. No publication was performed.
