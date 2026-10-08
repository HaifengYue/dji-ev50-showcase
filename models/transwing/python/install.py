"""跨平台建立本工程专属 .venv，无网络下载及全局安装。"""
from pathlib import Path
import json
import os
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".venv"
if sys.version_info < (3, 10):
    raise SystemExit("需要 Python 3.10 或更高版本")
if not (ENV / "pyvenv.cfg").exists():
    venv.EnvBuilder(with_pip=False, symlinks=(os.name != "nt")).create(ENV)
interpreter = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
site_dir = subprocess.check_output([str(interpreter), "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], text=True).strip()
Path(site_dir, "transwing_project.pth").write_text(str(ROOT / "python") + "\n", encoding="utf-8")
print(json.dumps({"python": str(interpreter), "package": str(ROOT / "python"), "dependencies": []}, ensure_ascii=False, indent=2))
print("启动：" + str(interpreter) + " -m transwing_sim.server")
