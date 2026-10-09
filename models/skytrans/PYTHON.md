# SkyTrans 本机 Python 接口

The bridge is optional. The integrated website, mechanism controls and JSON replay work without Python. Python owns deterministic simulation time only after an explicit same-origin connection. This is a visual simulation interface, not a connection to a real flight controller.

From the repository root:

```sh
cd threejs
npm run build -- --base=/
cd ..
python3 models/skytrans/python/run_server.py
```

Open the printed `http://127.0.0.1:8765/?aircraft=skytrans` URL and choose “连接本机 Python 桥”. The launcher defaults to this repository's `threejs/dist`. The explicit equivalent is `python3 models/skytrans/python/run_server.py --dist threejs/dist --port 8765`. Build with `/` as the Vite base for loopback; the normal Pages build may use a repository prefix.

The server binds only 127.0.0.1. It accepts the existing `transwing.sim.v1` protocol on `/api/v1/*`, never starts an automatic simulation clock, and checks same-origin HTTP requests. Remote static pages cannot probe localhost or initiate a cross-origin bridge. Switching aircraft closes its event stream, aborts imports/requests, unregisters its viewer and attempts to release its session. Release failures are reported and the lease remains the server's final safety boundary.

Run the preserved bridge tests:

```sh
PYTHONPATH=models/skytrans/python python3 -m unittest discover -s models/skytrans/python/tests -v
```

Examples:

```sh
PYTHONPATH=models/skytrans/python python3 models/skytrans/examples/python/full_flow.py
PYTHONPATH=models/skytrans/python python3 models/skytrans/examples/python/independent_motors.py
```

The browser “播放公开 Python 示例” reads the bundled, bounded JSON recording under `skytrans/examples/python-full-flow.json`; it does not execute Python. You can also import a JSON recording of at most 1 MiB. Invalid records are rejected atomically before ownership changes.

The current frame applies model pose, motor pose and surface/hatch pose before acknowledging a revision. Rotor shutter exposure is presentation-only and does not advance the externally owned clock.

The local general hatch slider uses the same measured visual clearance lift as cargo inspection whenever the hatch is open. Closing the hatch (including motor-control detail neutralization) removes that lift. This does not move the camera or rewrite `positionM`; externally supplied Python/JSON positions keep their protocol semantics.

## 名称兼容

规范包名为 `skytrans_sim`；旧 `transwing_sim` 是相同实现的薄别名。两个包都继续使用 `transwing.sim.v1` 与 `/api/v1`，新包不发送 `skytrans.sim.v1`。旧启动路径保留小型转发脚本。名称变化不创建额外 Bridge 或控制租约，详情见 [品牌迁移](../../docs/BRAND-MIGRATION.md)。

Windows PowerShell 示例：`$env:PYTHONPATH="models/skytrans/python"`，随后执行 `python models/skytrans/examples/python/full_flow.py`。
