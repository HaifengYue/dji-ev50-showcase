#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${QA_DIR:-qa/current/host-protection-supplement}"; export QA_DIR="$OUT"
unset QA_MODEL_ROOT QA_EXACT_NEAR_DIAGNOSTICS QA_OUT QA_MODEL QA_MODEL_KIND QA_SOURCE_MODEL QA_RUNTIME_MODEL QA_SOURCE QA_ENCODING QA_PASS QA_PREFLIGHT QA_BASELINE_ONLY QA_ALLOW_OPEN_DIAGNOSTIC QA_STEPS QA_WING_ONLY
node qa/current/verify-host-hardening-supplement.mjs freeze
export QA_INPUT_LOCK="$OUT/input-lock.json"
run(){ local name="$1"; shift; echo "START $name $(date -u +%FT%TZ)"; set +e; "$@" > "$OUT/$name.log" 2>&1; local result=$?; set -e; echo "$name $result" | tee -a "$OUT/status.log"; [[ "$result" == 0 ]] || exit "$result"; }
run powertrain-identity-selftest env QA_OUT="$OUT/powertrain-identity-selftest-report.json" node --import tsx --test qa/nacelle/powertrain-identity.selftest.mts
run nacelle-placement env QA_OUT="$OUT/nacelle-placement-report.json" node --import tsx qa/nacelle/verify-nacelle-placement.mts
run indexed-host-material env QA_OUT="$OUT/indexed-host-material-report.json" node --import tsx qa/nacelle/audit-host-indexed-exactness.mts
run unused-points-regression env QA_OUT="$OUT/unused-points-regression-report.json" node --import tsx qa/nacelle/host-unused-points-regression.mts
sha256sum -c "$OUT/input-sha256.txt" > "$OUT/input-stability.log" 2>&1
echo 'input-stability 0' | tee -a "$OUT/status.log"
node qa/current/verify-host-hardening-supplement.mjs summarize
