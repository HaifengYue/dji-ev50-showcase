#!/usr/bin/env bash
# 生成、物理检查及 EGL 渲染串行使用重型窗口；每次运行创建独立输出目录。
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${QA_DIR:-qa/current/results}"; export QA_DIR="$OUT"
mkdir -p "$OUT"
if [[ -e "$OUT/status.log" ]]; then echo "Refuse overwrite $OUT"; exit 2; fi
[[ -f "$OUT/input-sha256.txt" ]] || { echo 'Frozen final inputs required'; exit 2; }
# 正式入口清理诊断覆盖；输出目录 QA_DIR 保留，模型/采样网格不可由继承环境缩减。
unset QA_MODEL_ROOT QA_EXACT_NEAR_DIAGNOSTICS QA_OUT QA_MODEL QA_MODEL_KIND QA_SOURCE_MODEL QA_RUNTIME_MODEL QA_SOURCE QA_ENCODING QA_PASS QA_PREFLIGHT QA_BASELINE_ONLY QA_ALLOW_OPEN_DIAGNOSTIC QA_STEPS QA_WING_ONLY
export QA_CONTACTS=qa/contracts/drive-contact-contracts.json
export QA_DRIVE_CONTRACT=qa/contracts/drive-motion.json
export QA_REFINEMENTS=qa/contracts/model-refinement.json
export QA_SUPPORT_CONTRACT=qa/contracts/supports.json
run(){ local name="$1"; shift; echo "START $name $(date -u +%FT%TZ)"; "$@" > "$OUT/$name.log" 2>&1; local status=$?; echo "$name $status" | tee -a "$OUT/status.log"; if [[ $status -ne 0 ]]; then echo "STOP failed $name"; exit "$status"; fi; }
run nacelle-review env QA_OUT="$OUT/nacelle-review-report.json" node qa/nacelle/verify-nacelle-review.mjs
run reviewed-contract env QA_OUT="$OUT/reviewed-contract-report.json" node qa/current/verify-reviewed-contract.mjs
run support-coordinate-selftest env QA_OUT="$OUT/support-coordinate-selftest-report.json" node qa/current/support-coordinate-review.selftest.mjs
run mesh-precision env QA_OUT="$OUT/mesh-precision-report.json" node qa/nacelle/verify-mesh-precision.mjs
run regenerated-contract env QA_OUT="$OUT/regenerated-contract-report.json" node qa/current/verify-regenerated-contract.mjs
run preservation env QA_OUT="$OUT/preservation-report.json" node --import tsx qa/current/verify-preservation.mts
run runtime-preservation env QA_ENCODING=runtime QA_OUT="$OUT/runtime-preservation-report.json" node --import tsx qa/current/verify-preservation.mts
run powertrain-identity-selftest env QA_OUT="$OUT/powertrain-identity-selftest-report.json" node --import tsx --test qa/nacelle/powertrain-identity.selftest.mts
run nacelle-placement env QA_OUT="$OUT/nacelle-placement-report.json" node --import tsx qa/nacelle/verify-nacelle-placement.mts
run layered-scope env QA_OUT="$OUT/layered-scope-report.json" node --import tsx qa/current/verify-layered-scope.mts
run hinge-identity-selftest env QA_OUT="$OUT/hinge-identity-selftest-report.json" node --import tsx --test qa/current/hinge-identity.selftest.mts
run hinge-identity env QA_OUT="$OUT/hinge-identity-report.json" node --import tsx qa/current/verify-hinge-identity.mts
run fairing-role-selftest env QA_OUT="$OUT/fairing-role-selftest-report.json" node qa/current/fairing-support-roles.selftest.mjs
run fairing-clearance-selftest env QA_OUT="$OUT/fairing-clearance-selftest-report.json" node --import tsx qa/current/fairing-clearance.selftest.mts
run fairing-clearance env QA_OUT="$OUT/fairing-clearance-report.json" node --import tsx qa/current/verify-fairing-clearance.mts
run layered-sections-selftest env QA_OUT="$OUT/layered-sections-selftest-report.json" node --import tsx qa/current/layered-sections.selftest.mts
run exact-self-selftest env QA_OUT="$OUT/exact-self-selftest-report.json" node --test qa/nacelle/exact-self-geometry.selftest.mjs
run exact-self-contact env QA_OUT="$OUT/exact-self-contact-report.json" node --import tsx qa/nacelle/exact-self-verify.mts
run wing-shape-selftest env QA_OUT="$OUT/wing-shape-selftest-report.json" node --import tsx --test qa/nacelle/wing-shape.selftest.mts
run fuselage-scope env QA_OUT="$OUT/fuselage-scope-report.json" node --import tsx qa/nacelle/verify-fuselage-scope.mts
run wing-shape env QA_OUT="$OUT/wing-shape-report.json" node --import tsx qa/nacelle/verify-wing-shape.mts
run layered-geometry env QA_OUT="$OUT/layered-geometry-report.json" node --import tsx qa/current/verify-layered-geometry.mts
run motion-reference-selftest env QA_OUT="$OUT/motion-reference-selftest-report.json" node --import tsx qa/current/motion-reference.selftest.mts
run motion-identity node --import tsx qa/current/motion-reference-cli.mts compare --scope qa/contracts/model-refinement.json --out "$OUT/motion-identity-report.json"
run layered-motion-impact env QA_OUT="$OUT/layered-motion-impact-report.json" node --import tsx qa/current/verify-layered-motion-impact.mts
run nacelle-motion-impact env QA_OUT="$OUT/nacelle-motion-impact-report.json" node --import tsx qa/nacelle/verify-nacelle-motion-impact.mts
run inheritance env QA_OUT="$OUT/inheritance-report.json" node qa/current/verify-inheritance.mjs
run affected-scope-selftest env QA_OUT="$OUT/affected-scope-selftest-report.json" node --import tsx qa/current/affected-scope.selftest.mts
run patch-coverage-selftest env QA_OUT="$OUT/patch-coverage-selftest-report.json" node --import tsx qa/current/patch-coverage.selftest.mts
run local-scope env QA_OUT="$OUT/local-scope-report.json" node --import tsx qa/current/verify-local-scope.mts
run slot-section-selftest env QA_OUT="$OUT/slot-section-selftest-report.json" node --import tsx qa/current/slot-section.selftest.mts
run slot-boundary-vertices-selftest env QA_OUT="$OUT/slot-boundary-vertices-selftest-report.json" node --import tsx qa/current/slot-boundary-vertices.selftest.mts
run slot-geometry env QA_OUT="$OUT/slot-geometry-report.json" node --import tsx qa/current/measure-slot.mts
run straight-output-selftest env QA_OUT="$OUT/straight-output-selftest-report.json" node --import tsx qa/current/straight-output-geometry.selftest.mts
run straight-output-geometry env QA_OUT="$OUT/straight-output-geometry-report.json" node --import tsx qa/current/verify-straight-output.mts
run snapshot-topology-selftest env QA_OUT="$OUT/snapshot-topology-selftest-report.json" node --import tsx qa/lib/snapshot-audit.selftest.mts
run decoration-topology-selftest env QA_OUT="$OUT/decoration-topology-selftest-report.json" node --import tsx qa/current/decoration-topology.selftest.mts
run solids env QA_OUT="$OUT/solids-report.json" node --import tsx qa/current/verify-solids.mts
run support-selftest node --import tsx qa/lib/support-geometry.selftest.mts
run support env QA_OUT="$OUT/support-report.json" node --import tsx qa/current/verify-support.mts
run inspection env QA_OUT="$OUT/inspection-report.json" node --import tsx qa/lib/verify-inspection.mts
run linkage env QA_OUT="$OUT/linkage-report.json" node --import tsx qa/lib/verify-linkage.mts
run baked-winding env QA_OUT="$OUT/baked-winding-report.json" node --import tsx qa/lib/verify-baked-winding.mts
run drive-motion env QA_OUT="$OUT/drive-motion-report.json" node --import tsx qa/lib/verify-drive-motion.mts
run local-parity env QA_OUT="$OUT/local-parity-report.json" node --import tsx qa/lib/verify-local-parity.mts
run triangle-selftest node --test qa/lib/triangle-contact.selftest.mjs
run solid-selftest node qa/lib/solid-contact.selftest.mjs
run broadphase-selftest env QA_OUT="$OUT/broadphase-selftest-report.json" node --import tsx qa/current/broadphase.selftest.mts
run exact-pair-cache-selftest env QA_OUT="$OUT/exact-pair-cache-selftest-report.json" node --import tsx qa/current/exact-pair-cache.selftest.mts
run rotor-impact-selftest env QA_OUT="$OUT/rotor-impact-selftest-report.json" node --import tsx qa/current/rotor-impact.selftest.mts
for encoding in source runtime; do
 if [[ "$encoding" == source ]]; then export QA_MODEL=assets/blender/xp4-source.glb; else export QA_MODEL=public/models/xp4.glb; fi
 for pass in fast wing spin details; do run "$pass-$encoding" env QA_PASS="$pass" QA_OUT="$OUT/$pass-$encoding-report.json" node --import tsx qa/current/verify-relative-motion.mts; done
 run "local-motion-$encoding" env QA_OUT="$OUT/local-motion-$encoding-report.json" node --import tsx qa/current/verify-local-motion.mts
 run "rotor-envelope-$encoding" env QA_OUT="$OUT/rotor-envelope-$encoding-report.json" node --import tsx qa/current/verify-rotor-envelope.mts
 unset QA_MODEL
done
run exported-motor-clip env QA_OUT="$OUT/exported-motor-clip-report.json" node --import tsx qa/lib/verify-exported-motor-clip.mts
run python-render env QA_OUT="$OUT/python-render-report.json" node --import tsx qa/lib/verify-python-render.mts
sha256sum -c "$OUT/input-sha256.txt" > "$OUT/input-stability.log" 2>&1; echo "input-stability $?" | tee -a "$OUT/status.log"
awk '$2!=0{bad=1}END{exit bad}' "$OUT/status.log"
