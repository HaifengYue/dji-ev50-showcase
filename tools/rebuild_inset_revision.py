"""Rebuild integrated-b in a new project from frozen inputs, never from the final B assets.

Run verify_package.py in the complete distributed source package before copying.
The thin reconstruction tree is deliberately not a complete distribution and must
not be checked against the distribution's DEVELOPMENT_MANIFEST.json.
"""
from pathlib import Path, PurePosixPath
import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parents[1]
LOCK = "REVISION_INSET_CONSTRUCTION_INPUTS.json"
LABEL = "candidate-inset-integrated-b-regenerated"
STAGE = "qa/revision-20261007-inset/baked-integrated-b-regenerated"
CHECKS = "qa/revision-20261007-inset/rebuild-checks"
INSET = "scripts/revision_20261007_inset/"
TEMPLATES = "qa/revision-20261007-inset/development-templates/src"


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def verify_inputs(root):
    manifest = json.loads((root / LOCK).read_text())
    seen = set()
    for row in manifest["files"]:
        relative = PurePosixPath(row["path"])
        if relative.is_absolute() or ".." in relative.parts or row["path"] in seen:
            raise RuntimeError("Invalid or duplicate input path: " + row["path"])
        seen.add(row["path"])
        path = root / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root):
            raise RuntimeError("Missing or indirect construction input: " + row["path"])
        if path.stat().st_size != row["bytes"] or sha(path) != row["sha256"]:
            raise RuntimeError("Construction input identity mismatch: " + row["path"])
    # Retaining every inherited row prevents silent rewriting of the 82/103/136 chain.
    inherited = json.loads((root / "REVISION_DETAIL_CONSTRUCTION_INPUTS.json").read_text())
    current = {row["path"]: row for row in manifest["files"]}
    for row in inherited["files"]:
        if current.get(row["path"]) != row:
            raise RuntimeError("Inherited 136-input row changed: " + row["path"])
    forbidden = {"public/models/xp4.glb", "assets/blender/xp4.blend", "assets/blender/xp4-source.glb"}
    if forbidden.intersection(seen) or any(p.startswith("qa/revision-20261007/") and p.endswith(".blend") for p in seen):
        raise RuntimeError("Current final candidate/output must not be a construction input")
    return manifest, seen


def clean_environment():
    env = dict(os.environ)
    # An inherited shortcut or reference-writing flag must never silently turn
    # default full construction into stage reuse or overwrite the frozen reference.
    for key in list(env):
        if key.startswith("TRANSWING_") or key in {"QA_MODEL", "QA_MANIFEST", "QA_SOURCE_MODEL", "QA_EXPECTED_SOURCE_CANDIDATE_SHA256"}:
            env.pop(key, None)
    env.update(TRANSWING_INTEGRATED_LABEL=LABEL,
               TRANSWING_INTEGRATED_STAGE=STAGE,
               PYTHONDONTWRITEBYTECODE="1")
    return env


def commands(blender, root=None):
    def native(script, threads=2):
        return [blender, "-b", "-t", str(threads), "--python-exit-code", "1", "--python", str(root / INSET / script) if root is not None else INSET + script]
    def node(script):
        return ["node", "--import", "tsx", INSET + script]
    return [
        ("native-default", native("build_integrated_flat_candidate.py", 4)),
        ("native-geometry-reference", native("verify_integrated_geometry_rebuild.py")),
        ("fresh-bake", native("bake_integrated_candidate.py", 4)),
        ("compress", ["node", INSET + "compress-integrated-model.mjs"]),
        ("source-runtime", ["node", INSET + "integrated_verify_source_runtime.mjs"]),
        ("baked-native-geometry", native("integrated_verify_baked_geometry.py")),
        ("baked-animation", node("verify_integrated_baked_animation.mts")),
        ("runtime-compatibility", node("verify_integrated_runtime_compatibility.mts")),
        ("owner-topology", node("integrated_verify_owner_topology.mts")),
        ("all-owner-inventory", node("integrated_verify_all_owner_inventory.mts")),
        ("legacy-inventory-identity", node("integrated_verify_legacy_inventory_identity.mts")),
        ("semantic-unit", ["node", "--import", "tsx", "--test", INSET + "integrated_semantic_geometry.test.mts"]),
        ("identity-negative", ["node", INSET + "integrated_identity_regression.mjs"]),
        ("write-manifest", ["python3", INSET + "write_integrated_manifest.py"]),
    ]


def prepare(target, inputs, hardlink_inputs):
    files = set(inputs) | {LOCK}
    # App/test sources are independently locked by the complete distribution
    # manifest, not by inheriting the old root model.test.ts as a B primitive.
    for folder in ["src", "python", "examples", "public/examples", "docs", "qa/lib"]:
        for path in (SOURCE / folder).rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"}:
                files.add(path.relative_to(SOURCE).as_posix())
    for relative in ["index.html", "vite.config.ts", "tsconfig.json", "THIRD_PARTY_NOTICES.txt", "qa/glb-loader-check.mjs", "qa/flight-regression.test.ts"]:
        files.add(relative)
    target.mkdir(parents=True)
    for folder in ["qa/revision-20261007", "qa/revision-20261007-detail", CHECKS, STAGE]:
        (target / folder).mkdir(parents=True, exist_ok=True)
    linked = []
    for relative in sorted(files):
        src, dst = SOURCE / relative, target / relative
        dst.parent.mkdir(parents=True, exist_ok=True)
        # Only immutable baseline/construction inputs may share an inode. No
        # output or app source is hardlinked and no chmod changes source inodes.
        if hardlink_inputs and relative in inputs and src.stat().st_size > 5_000_000:
            try:
                os.link(src, dst)
                linked.append(relative)
            except OSError as error:
                if error.errno != errno.EXDEV:
                    raise
                shutil.copy2(src, dst)
        else:
            shutil.copy2(src, dst)
    for src in (SOURCE / TEMPLATES).glob("*"):
        if src.is_file():
            shutil.copy2(src, target / "src" / src.name)
    policy = json.loads((target / "V27_PIPELINE_POLICY_INPUTS.json").read_text())
    write_json(target / STAGE / "BUDGET_APPROVAL.json", policy["budgetApproval"])
    verify_inputs(target)
    return linked


def promote(target):
    stage = target / STAGE
    mapping = [("xp4.blend", "assets/blender/xp4.blend"),
               ("xp4-source.glb", "assets/blender/xp4-source.glb"),
               ("xp4.glb", "public/models/xp4.glb"),
               ("model-manifest.json", "public/models/manifest.json"),
               ("model-validation.json", "assets/model-validation.json"),
               ("modelAssetRevision.ts", "src/modelAssetRevision.ts")]
    mapping += [("annotated-mechanism.json", folder + "/annotated-mechanism.json")
                for folder in ["assets/build", "assets/blender", "public/models"]]
    for src, dst in mapping:
        destination = target / dst
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Large generated assets share only this fresh tree's immutable stage,
        # never the distributed/source package. Tests and build only read these.
        if (stage / src).stat().st_size > 5_000_000:
            os.link(stage / src, destination)
        else:
            shutil.copy2(stage / src, destination)
    for src in (stage / "assets/animation").glob("*.json"):
        destination = target / "assets/animation" / src.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path,
                        help="New parent directory; its transwing-studio child must not exist")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--run", action="store_true", help="Construct, bake, validate and build; otherwise prepare only")
    parser.add_argument("--native-only", action="store_true", help="With --run, stop after complete native reference comparison")
    parser.add_argument("--skip-package-check", action="store_true",
                        help="Development worktree only: skip distribution verification; construction hashes are still mandatory")
    parser.add_argument("--hardlink-inputs", action="store_true", help="Read-only sharing of large frozen inputs; never modify linked input files")
    parser.add_argument("--deps-from", type=Path, default=SOURCE,
                        help="Existing root and scripts node_modules; only these two dependency directories are symlinked; no installation")
    parser.add_argument("--blender", default="blender")
    args = parser.parse_args()
    target = args.output.resolve() / "transwing-studio"
    if target.exists() or target == SOURCE or SOURCE in target.parents:
        parser.error("Refusing existing output or construction inside the source project")
    manifest, inputs = verify_inputs(SOURCE)
    env = clean_environment()
    env["PYTHONPATH"] = str(target / "python")
    env["PWD"] = str(target)
    # This verification belongs to the full input distribution, not the thin
    # fresh project, and is a real separate process rather than a listed command.
    package_checked = False
    if not args.skip_package_check:
        subprocess.run([sys.executable, "tools/verify_package.py"], cwd=SOURCE, env=env, check=True)
        package_checked = True
    sequence = commands(args.blender, target)
    if args.dry_run:
        print(json.dumps({"verifiedInputCount": len(inputs), "packageVerified": package_checked,
                          "target": str(target), "candidateLabel": LABEL, "stage": STAGE,
                          "currentFinalModelIsNotAnInput": True, "commands": sequence,
                          "fullWrapperInFreshDirectoryClaimedExecuted": False}, ensure_ascii=False, indent=2))
        return
    if args.run and not args.native_only:
        for folder in ["node_modules", "scripts/node_modules"]:
            if not (args.deps_from.resolve() / folder).is_dir():
                parser.error("Missing existing dependencies: " + str(args.deps_from / folder))
    linked = prepare(target, inputs, args.hardlink_inputs)
    receipt = {"schema": "transwing.v27-fresh-rebuild-receipt.v1", "target": str(target),
               "constructionInputCount": len(inputs), "constructionInputLockSha256": sha(SOURCE / LOCK),
               "sourcePackageVerifiedSeparately": package_checked,
               "currentFinalModelUsedAsConstructionInput": False,
               "defaultNativeChain": "frozen V24 -> V25 -> M -> compact layout -> I skin -> flat/rib/bore/phase B",
               "clearedInheritedStageAndReferenceOverrides": True,
               "frozenInputHardlinksReadOnly": linked, "commands": [], "passed": False,
               "publicationPerformed": False, "fullPhysicalOrAppearanceAcceptanceClaimed": False}
    receipt_path = target / CHECKS / "FULL_REBUILD_RECEIPT.json"
    write_json(receipt_path, receipt)
    if not args.run:
        print("Prepared verified fresh inputs: " + str(target))
        return
    if not args.native_only:
        for folder in ["node_modules", "scripts/node_modules"]:
            (target / folder).symlink_to(args.deps_from.resolve() / folder, target_is_directory=True)

    def run(name, command):
        log = target / CHECKS / (str(len(receipt["commands"]) + 1).zfill(2) + "-" + name + ".log")
        start = time.time()
        print("RUN " + name, flush=True)
        with log.open("w") as stream:
            result = subprocess.run(command, cwd=target, env=env, stdout=stream, stderr=subprocess.STDOUT)
        receipt["commands"].append({"name": name, "command": command, "exitCode": result.returncode,
                                   "seconds": round(time.time() - start, 3), "log": log.relative_to(target).as_posix()})
        write_json(receipt_path, receipt)
        if result.returncode:
            raise RuntimeError("Failed " + name + "; inspect " + str(log))
        if name == "development-176":
            text = log.read_text()
            for field, expected in [("tests", 176), ("pass", 176), ("fail", 0), ("skipped", 0), ("todo", 0)]:
                if not re.search(r"(?m)^[#ℹ] " + field + " " + str(expected) + r"\s*$", text):
                    raise RuntimeError("Unexpected development test count: " + field)
        if name == "python-26" and not re.search(r"Ran 26 tests?", log.read_text()):
            raise RuntimeError("Unexpected Python test count")

    for name, command in sequence[:2]:
        run(name, command)
    report = json.loads((target / "qa/revision-20261007-inset/REVISION_INSET_REBUILD_COMPARISON.json").read_text())
    assert report["passed"] and report["completeMeshCount"] == 285 and report["completeNodeCount"] == 352
    assert report["differences"] == []
    candidate = target / "qa/revision-20261007" / (LABEL + ".blend")
    current_sha = sha(candidate)
    assert current_sha == report["candidateSha256"]
    receipt["nativeGeometryComparison"] = report
    # Pin the freshly generated bytes only after complete geometry/reference
    # equality. Blend container identity is not expected to repeat bit-for-bit.
    env["TRANSWING_INTEGRATED_EXPECTED_SHA"] = current_sha
    env["QA_EXPECTED_SOURCE_CANDIDATE_SHA256"] = current_sha
    if not args.native_only:
        for name, command in sequence[2:]:
            run(name, command)
        promote(target)
        run("format-generated-cache-helper", ["node_modules/.bin/prettier", "--write", "src/modelAssetRevision.ts"])
        for name, command in [
            ("development-176", ["npm", "test"]),
            ("qa-regression", ["npm", "run", "test:qa"]),
            ("typescript-vite", ["npm", "run", "build"]),
            ("format", ["npm", "run", "format:check"]),
            ("python-26", ["python3", "-m", "unittest", "discover", "-s", "python/tests"]),
        ]:
            run(name, command)
    verify_inputs(SOURCE)
    verify_inputs(target)
    receipt.update(passed=True, fullWrapperInFreshDirectoryExecuted=True,
                   fullPipelineAndDevelopmentExecuted=not args.native_only,
                   sourceAndTargetConstructionHashesUnchanged=True)
    write_json(receipt_path, receipt)
    print("V27 fresh rebuild verified: " + str(target) + "; unpublished, no appearance or physical certification implied")


if __name__ == "__main__":
    main()
