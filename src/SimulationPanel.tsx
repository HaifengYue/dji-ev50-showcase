import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MOTOR_IDS, type MotorStage } from "./motors";
import { SimulationRuntime } from "./simulation";
import { SimulationBridge } from "./simulationBridge";
import { RecordingLoader, readPythonExample } from "./recordingLoader";
import { beginLocalControl } from "./uiControl";
const names = {
  L_Front: "左前",
  R_Front: "右前",
  L_Rear: "左后",
  R_Rear: "右后",
};
const stages: Record<MotorStage, string> = {
  folded: "已收桨",
  unfolding: "正在展桨",
  accelerating: "正在升速",
  running: "运转",
  decelerating: "正在减速",
  indexing: "停桨寻位",
  folding: "正在收桨",
};
export default function SimulationPanel({
  runtime,
  bridge,
  onManual,
  onExternal,
  onReset,
  onDemo,
  loader: sharedLoader,
  children,
}: {
  runtime: SimulationRuntime;
  bridge: SimulationBridge;
  onManual: () => void;
  onExternal?: () => void;
  onReset: () => void;
  onDemo?: () => void;
  loader?: RecordingLoader;
  children?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [open, setOpen] = useState(true),
    [fileError, setFileError] = useState<string | null>(null),
    [, refreshImport] = useState(0);
  const [ownLoader] = useState(() => new RecordingLoader(runtime, bridge));
  const loader = sharedLoader ?? ownLoader;
  const loading = loader.loading;
  const setLoading = (_value: boolean) => refreshImport((value) => value + 1);
  const cancelImport = () => {
    loader.cancel();
    setLoading(false);
  };
  useEffect(() => {
    const cancel = () => loader.cancel();
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("[data-app-dialog]")
      )
        cancelImport();
    };
    window.addEventListener("popstate", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("keydown", key);
    return () => {
      cancel();
      window.removeEventListener("popstate", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [loader]);
  const load = async (
    read: (signal: AbortSignal) => Promise<string>,
    autoplay = false,
  ) => {
    setFileError(null);
    setLoading(true);
    try {
      await loader.load(read, onExternal ?? onManual, autoplay);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "记录加载失败");
    } finally {
      if (!loader.loading) setLoading(false);
    }
  };
  const manual = () => {
    if (
      runtime.getSnapshot().control !== "local" ||
      runtime.getSnapshot().driver !== "manual"
    )
      return false;
    cancelImport();
    return true;
  };
  const local = snapshot.control === "local";
  const status =
    snapshot.control === "replay"
      ? "JSON 离线回放"
      : snapshot.connection === "connected"
        ? snapshot.state.owner === "external"
          ? "Python 独占控制"
          : "同源桥就绪，等待 Python 会话"
        : snapshot.connection === "connecting"
          ? "正在连接同源本地桥"
          : "本地操作 · Python 未连接";
  const leave = () => {
    cancelImport();
    void bridge.close();
    onReset();
  };
  return (
    <section className="simulation-panel" aria-label="Python 仿真与四电机控制">
      <div className="simulation-heading">
        <div>
          <span className="eyebrow">统一状态源 / 本地与 Python</span>
          <h2>飞行仿真工作台</h2>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "收起" : "展开"}
        </button>
      </div>
      <div className="simulation-status">
        <p role="status">
          {status} · {snapshot.ready ? "模型已就绪" : "模型载入中"}
        </p>
        <span>
          仿真时间 <strong>{snapshot.state.time.seconds.toFixed(2)}</strong> 秒
        </span>
      </div>
      {open && (
        <>
          <div
            className="source-selector"
            role="group"
            aria-label="本地控制来源"
          >
            <span>本地控制来源</span>
            <button
              disabled={!local}
              aria-pressed={local && snapshot.driver === "demo"}
              onClick={() => {
                if (!beginLocalControl(runtime, bridge, loader, "demo")) return;
                onDemo?.();
              }}
            >
              连续飞行演示
            </button>
            <button
              disabled={!local}
              aria-pressed={local && snapshot.driver === "manual"}
              onClick={() => {
                if (!beginLocalControl(runtime, bridge, loader, "manual"))
                  return;
                onManual();
              }}
            >
              手动四电机
            </button>
            <small>
              {local
                ? snapshot.driver === "demo"
                  ? "飞行序列驱动位置、姿态、整翼与电机"
                  : "飞行已暂停，四台电机可独立操作"
                : "外部输入已锁定本地动作"}
            </small>
          </div>
          {children}
          <div className="integration-heading">
            <h3>Python 接入与记录回放</h3>
            <span>切换控制来源会停止当前本地演示</span>
          </div>
          <div className="simulation-actions">
            <button
              disabled={!local}
              onClick={() => {
                cancelImport();
                (onExternal ?? onManual)();
                void bridge.connect();
              }}
            >
              连接本机 Python 桥
            </button>
            <button onClick={leave}>退出外控 / 复位</button>
            <button
              onClick={() =>
                void load((signal) => readPythonExample(signal), true)
              }
            >
              {loading ? "重新加载 Python 示例" : "播放 Python 示例（离线）"}
            </button>
            <label className="file-button">
              导入 JSON 回放
              <input
                aria-label="导入仿真 JSON 记录"
                type="file"
                accept=".json,application/json"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void load(async () => {
                    if (file.size > 1024 * 1024)
                      throw new Error("记录最大为 1 MiB");
                    return file.text();
                  });
                }}
              />
            </label>
          </div>
          {loading && (
            <p role="status">正在验证离线记录，完成前保留当前画面…</p>
          )}
          {(snapshot.error || fileError) && (
            <p className="simulation-notice" role="alert">
              {fileError ?? snapshot.error}
            </p>
          )}
          <p className="simulation-note">
            静态网站不会连接你电脑的端口。实时接入请在本机运行 Python
            启动器；当前位置与尺寸是视景约定，不构成飞控或实测动力学。
          </p>
          {snapshot.control === "replay" && (
            <div className="simulation-replay">
              <button
                onClick={() => runtime.playReplay(!snapshot.replayPlaying)}
              >
                {snapshot.replayPlaying ? "暂停记录" : "播放记录"}
              </button>
              <input
                aria-label="记录逐帧定位"
                type="range"
                min={0}
                max={snapshot.replayCount - 1}
                value={snapshot.replayIndex}
                onChange={(event) =>
                  runtime.replayAt(Number(event.target.value))
                }
              />
              <button
                aria-pressed={snapshot.replayRate === 0.1}
                onClick={() =>
                  runtime.setReplayRate(snapshot.replayRate === 1 ? 0.1 : 1)
                }
              >
                {snapshot.replayRate === 1
                  ? "切换 0.1× 慢放检视"
                  : "慢放检视 0.1× · 切回 1×"}
              </button>
              <span>
                {snapshot.replayIndex} / {snapshot.replayCount - 1} 条
              </span>
            </div>
          )}
          <label className="simulation-note">
            <input
              type="checkbox"
              checked={snapshot.rotorShutter}
              onChange={(event) =>
                runtime.setRotorShutter(event.target.checked)
              }
            />{" "}
            高速快门扫掠（防混叠）
          </label>
          <p className="simulation-note">
            {snapshot.rotorShutter
              ? "高速桨以真实轨迹的连续扫掠表示运转，并轻微增强显示对比；取消勾选可查看真实瞬时相位。"
              : "真实瞬时相位：高速旋桨可能因画面采样显得停转或倒转。"}
            {snapshot.control === "replay" &&
              " 0.1× 将整个记录放慢十倍，RPM仍是仿真值；桨毂与桨叶同轴同步，便于检查旋向。"}
          </p>
          <div className="integration-heading">
            <h3>四电机状态</h3>
            <span>
              {local && snapshot.driver === "manual"
                ? "手动控制已启用"
                : "只读监看；选择“手动四电机”后可调整"}
            </span>
          </div>
          <div className="motor-grid">
            {MOTOR_IDS.map((id) => {
              const motor = snapshot.actuators[id],
                command = snapshot.state.motors[id];
              return (
                <div className="motor-card" key={id}>
                  <div>
                    <strong>{names[id]}电机</strong>
                    <span>{stages[motor.stage]}</span>
                  </div>
                  <label>
                    <input
                      aria-label={`${names[id]}电机启动`}
                      type="checkbox"
                      disabled={!local || snapshot.driver !== "manual"}
                      checked={command.enabled}
                      onChange={(event) => {
                        if (!manual()) return;
                        runtime.setLocal(
                          {
                            display: { exploded: false },
                            motors: {
                              [id]: {
                                enabled: event.target.checked,
                                targetRpm: command.targetRpm || 1800,
                              },
                            },
                          },
                          "manual",
                        );
                      }}
                    />{" "}
                    电机启动
                  </label>
                  <label>
                    {names[id]}目标 {Math.round(command.targetRpm)} RPM
                    <input
                      aria-label={`${names[id]}电机目标转速`}
                      type="range"
                      min={0}
                      max={6000}
                      step={60}
                      disabled={!local || snapshot.driver !== "manual"}
                      value={Math.min(6000, command.targetRpm)}
                      onChange={(event) => {
                        if (!manual()) return;
                        runtime.setLocal(
                          {
                            display: { exploded: false },
                            motors: {
                              [id]: { targetRpm: Number(event.target.value) },
                            },
                          },
                          "manual",
                        );
                      }}
                    />
                  </label>
                  <small>
                    仿真 {Math.round(motor.rpm)} RPM · 收桨{" "}
                    {Math.round(motor.fold * 100)}%
                    {snapshot.control === "replay" &&
                      snapshot.replayRate === 0.1 &&
                      ` · 0.1×画面约 ${snapshot.replayPlaying ? Math.round(motor.rpm * 0.1) : 0} RPM`}
                  </small>
                </div>
              );
            })}
          </div>
          <p className="simulation-note">
            启动：展开 → 升速　停机：减速 → 正向寻位 →
            收桨。四台电机分别控制，整翼倾转不会代替电机启停。
          </p>
          <details>
            <summary>本机接入方式与坐标约定</summary>
            <p>
              在项目目录运行 python python/run_server.py。启动器仅需 Python
              标准库，建议使用项目 .venv 独立环境，不依赖
              UAV-RL。打开终端显示的本机页面，点击“连接本机 Python
              桥”，再按项目文档运行 Python 示例。
            </p>
            <p>
              右手坐标：+X 向右、+Y 向上、+Z 机头；位置单位为约定米。四元数顺序
              x,y,z,w，舵面和舱盖使用度，RPM 为每分钟转数。Python 提交 set /
              step / seek，由本机桥返回 accepted 与 applied
              回执；页面关闭时不会谎报已应用。
            </p>
          </details>
        </>
      )}
    </section>
  );
}
