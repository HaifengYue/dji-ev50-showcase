# Portable contour QA

Run these scripts with Blender 4.3.2 and its Python NumPy, `bpy`, `bmesh`, and `mathutils`. They use the original project modules under `scripts/`, especially `kinematics.py`, `mesh_precision.py`, `wing_surfaces.py`, `annotated_root_interface.py`, and `revision_20261007_inset/rebuild_rear_corner_flat.py` plus those modules' existing dependencies. No web access or installation is used.

Example invocation:

    blender -b -t 2 --python portable_qa/check_walls.py -- --project-root /path/to/transwing-studio --candidate /path/to/native-candidate.blend --output-dir /path/to/qa

Scripts requiring a pristine native B baseline additionally need `--baseline /path/to/native-b.blend`. `check_determinism.py` also imports the contour helper; by default it looks one directory above `portable_qa`. Override with `--helper-dir /path/to/helper` and, if renamed, `--helper-module edge_contours`.

- `check_walls.py`: finite actual lower-face normal rays and vertical fixed-root gaps. Reports, rather than hides, near-end minimum distances separately from the explicitly bounded interior sample set
- `check_columns.py`: current-candidate and baseline vertical entry/exit sequences, retaining initial face orientations. Requires `--baseline`
- `check_boundary_columns.py`: +/- neighboring columns for the two known exact-X end-wall grazing cases. It is diagnostic, not a relaxed acceptance threshold
- `check_coarse.py`: actual 35-pose 0..120-degree cross-rigid-body triangle material and closed-component containment screen; this is not the full 661-pose final acceptance
- `check_determinism.py`: two fresh baseline runs, exact Float32 vertices/directed polygon materials/world transforms/hierarchy comparison and changed-owner inventory. Requires `--baseline`
- `render.py`: same two 1200x1000 workbench inspection cameras as the parent baseline; does not modify or save the candidate

All paths are explicit CLI arguments after Blender's `--`. The scripts only read input Blend files and write their reports or requested PNGs to `--output-dir`. The contour helper itself does not save a Blend. `qa_context.py` is the shared local argument/path loader. All scripts compile; the portable `check_walls.py` was also actually run with explicit arguments on final source SHA613e3bb3. Original in-task scripts and their reports remain beside this folder as execution evidence.

Precise self-intersection classification is also included here, copied from the independent reviewer without classifier changes: `check_precise_self.py` imports `intersections.py`, which performs Float64 plane sections, strict crossing margin tests, and coplanar overlap area classification. Preserve both files together. The final authoritative review is `self-precise-613e3bb3.json` from that review folder.

The portable `check_precise_self.py` path handling is adapted to the same explicit CLI, requires `--baseline`, and its companion `intersections.py` is byte-identical to the independently used classifier. Numeric tolerances are unchanged.
