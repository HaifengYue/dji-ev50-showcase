# V27 integrated-b identity and owner checks

All requested identity checks completed against B with its explicit stage and source SHA. This is a pipeline identity/topology result only. Appearance remains pending joint geometry and user review; no wall-thickness, clearance, collision, manufacturing, budget or integration acceptance is granted. A was not rewritten.

## Pinned artifacts

- `candidate-inset-integrated-b.blend`: 21,298,772 bytes; SHA-256 `742ef52939de40f5d2eb46b87d38c8e85f99bffafc270c302afd59b9ea398adf`
- `xp4.blend`: 37,484,592 bytes; SHA-256 `e7baf0cf5e4d5fb0a0fda79199d24c12ac6867ad21aae067a0393dc2d5bb1973`
- `xp4-source.glb`: 10,158,984 bytes; SHA-256 `e065b47171b799251b5e1eb7764b1d0e7d75e336edd1615979b69edf52c65a42`
- `xp4.glb`: 3,696,884 bytes; SHA-256 `352b1b6fd28026e5c9b50e981e1fb30aa4d5fad805084d7186ca2e9c7c375b16`

## Results

- Complete current inventory: 285 mesh-owning raw nodes, 352 raw nodes, 287 rendered material primitives; source reference and bake receipt agree
- Source/runtime exact-critical identity: 177 owners cover 179 material primitives. Float32 oriented triangles and serialized TRS are exact; maximum owner local-matrix error is 0. All inherited critical owners remain, with no new mesh-owner names relative to the frozen M reference
- Full hierarchy and all material definitions/primitive bindings are preserved. The two WingLowerClosure EMPTY anchors and five drive rest transforms remain exact. Both animations retain 18/26 track identities, interpolation and complete decoded typed time/value arrays byte for byte
- Native geometry: the pinned B candidate and fresh bake were both reopened independently; 285 complete mesh identities and 352 named parent identities match with zero differences. The geometry signature includes unused vertices, oriented polygons, element counts and material slots
- Both complete Composite material owners pass source/runtime strict topology: single connected closed raw and original-SAT snapshots, zero boundary or nonmanifold edges, zero skipped triangles. Left/right have 39,416 / 39,424 triangles. Minimum local triangle area on each is 2.7755575615628914e-17; the unchanged strict lower bound remains 1e-18
- Exhaustive all-owner inventory: 330,404 rendered triangles; source 263/285 raw-closed, runtime 254/285. All open/nonmanifold and filtering evidence remains visible, with no global closure claim
- Legacy comparison: all 9 current SAT-filtering owners exactly match protected V25 decoded local position inventories, oriented triangles, materials, own local matrices and parent identities. The sensor has 24 filtered triangles; each of eight blade hinge arms has 8. Protected V25 runtime SHA `7d8f17becf588b7dbebcd95201f89e18bcd95db4eca238451c6e64e85de9e902` was verified before and after the read-only comparison. Sensor ancestor frames match; the blade-arm Prop/WingPivot ancestor rest frames changed and are explicitly reported. This is historical local-defect provenance, not world-space identity or a new exemption
- Group aggregation unit tests: 3/3 passed
- Mutation tests: all 5 cases were rejected for the expected reason: material drift, critical-owner TRS drift, EMPTY alias TRS drift, animation interpolation drift, and removal of an inherited critical exception. Current B runtime bytes stayed unchanged; deliberately invalid model copies were removed, while rejection logs remain
- Runtime size is 3,696,884 bytes. V27 budget decision remains pending; size does not relax geometric precision

The nine reused script files remain byte-identical to their previously verified A receipts. A's six receipted identity/inventory reports also remain byte-identical. All new reports and logs are inside B's stage.

## Reproduction

From the project root:

```sh
export TRANSWING_INTEGRATED_STAGE=qa/revision-20261007-inset/baked-integrated-b
export TRANSWING_INTEGRATED_EXPECTED_SHA=742ef52939de40f5d2eb46b87d38c8e85f99bffafc270c302afd59b9ea398adf
node scripts/revision_20261007_inset/integrated_verify_source_runtime.mjs
blender -b -t 2 --python-exit-code 1 --python scripts/revision_20261007_inset/integrated_verify_baked_geometry.py
node --import tsx scripts/revision_20261007_inset/integrated_verify_owner_topology.mts
node --import tsx scripts/revision_20261007_inset/integrated_verify_all_owner_inventory.mts
node --import tsx scripts/revision_20261007_inset/integrated_verify_legacy_inventory_identity.mts
node --import tsx --test scripts/revision_20261007_inset/integrated_semantic_geometry.test.mts
node scripts/revision_20261007_inset/integrated_identity_regression.mjs
```

## Evidence

Six complete reports: SOURCE_RUNTIME_IDENTITY.json, BAKE_GEOMETRY_IDENTITY.json, SEMANTIC_OWNER_TOPOLOGY_CHECK.json, ALL_OWNER_TOPOLOGY_INVENTORY.json, LEGACY_QUANTIZATION_INVENTORY_IDENTITY.json and IDENTITY_NEGATIVE_TESTS.json.

Logs: identity-source-runtime.log, identity-native-geometry.log, identity-owner-topology.log, identity-all-owner-inventory.log, identity-legacy-inventory.log, identity-semantic-unit-tests.log and identity-negative-tests.log. IDENTITY_RUN_EXIT_CODES.json records the five post-compression checks and their zero exit codes. IDENTITY_CHECK_DELIVERABLES.json records artifact, script and report hashes.

Actual AnimationMixer playback and production rig tests are separate evidence owned by the other pipeline worker. No failure was observed in this identity task, but global material/clearance/appearance acceptance remains unresolved.

## 可移植性补正

旧量化身份比较已改为读取包内 assets/baseline-v25-20261007/xp4-runtime.glb，受 V27_BASELINE_VERIFICATION_INPUTS.json 和冻结V25 manifest双重SHA校验。B已按此新入口实际重跑9/9通过；不依赖当前主public输出。此前逐项复用A方法的原收据保存在 IDENTITY_CHECK_DELIVERABLES.before-frozen-v25-runtime.json；新输入路径不放宽几何身份门。
