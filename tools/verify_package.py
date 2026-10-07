"""Verify the files recorded in this development package's own manifest."""
from pathlib import Path, PurePosixPath
import hashlib
import json


def main():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "DEVELOPMENT_MANIFEST.json").read_text())
    assert manifest["schema"] == "transwing.light-development-manifest.v1"
    seen = set()
    for row in manifest["files"]:
        relative = PurePosixPath(row["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        assert row["path"] not in seen
        seen.add(row["path"])
        file = root / relative
        assert file.is_file() and not file.is_symlink(), row["path"]
        assert file.resolve().is_relative_to(root), row["path"]
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        assert file.stat().st_size == row["bytes"], row["path"]
        assert digest.hexdigest() == row["sha256"], row["path"]
    print(json.dumps({"verifiedFiles": len(seen), "passed": True,
                      "scope": "Manifest file identity; no physical acceptance claim"}))


if __name__ == "__main__":
    main()
