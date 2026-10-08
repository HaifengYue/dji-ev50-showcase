import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Box,
  Crosshair,
  Layers3,
  Menu,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  Focus,
  ScanLine,
  MoveUpRight,
  X,
} from "lucide-react";
import Scene, { type Variant, type CameraView } from "./Scene";
import { PHASES, TOTAL, getFlight, phaseStart } from "./flight";
import type { TiltAction } from "./tilt";
import { useExperience, displayedUnfold } from "./experience";
import { INSPECTION_VIEWS } from "./inspection";
import DetailPanel from "./DetailPanel";
import { NEUTRAL_DETAIL_POSE, detailSurfaces } from "./details";
import InternalDrivePanel from "./InternalDrivePanel";
import SimulationPanel from "./SimulationPanel";
import { SimulationRuntime } from "./simulation";
import { SimulationBridge } from "./simulationBridge";
import { MOTOR_IDS, newMotorCommands, type MotorCommands } from "./motors";
import { Euler, Quaternion } from "three";
import { RecordingLoader } from "./recordingLoader";
import { beginLocalControl, escapeTarget } from "./uiControl";
const variants = [
  {
    id: "xp4" as Variant,
    index: "01",
    name: "TRANSWING",
    code: "P4 · 参考重建",
    tag: "蓝白 P4 · 单一参考构型",
    description:
      "依据蓝白 P4 实拍、视频及公开手册重建六个舵面、分体前货舱盖、左尾尖空速静压探头与动力舱外形。可在细节检查中限幅偏转；电机与电调另以独立概念模块说明。",
    role: "技术验证",
    color: "#e4b16a",
  },
];
class SceneBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: false });
  }
  render() {
    return this.state.error ? (
      <div className="scene-error">
        <Box size={30} />
        <h3>三维场景暂时不可用</h3>
        <p>请确认浏览器支持 WebGL，并刷新重试。飞行状态与研究说明仍可使用。</p>
        <button onClick={() => location.reload()}>重新载入</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Silhouette({ fold = 0 }: { fold?: number }) {
  return (
    <svg viewBox="0 0 160 70" aria-hidden="true">
      <g
        transform={`translate(80 32) scale(${1 - fold * 0.6} 1) translate(-80 -32)`}
      >
        <path
          className="svg-wing"
          d="M76 27 17 42 19 47 77 39 83 39 141 47 143 42 84 27"
        />
        {[38, 61, 99, 122].map((x, i) => (
          <g key={x}>
            <ellipse cx={x} cy={i % 2 ? 34 : 39} rx="3" ry="8" />
            <path
              d={`M${x - 10} ${i % 2 ? 30 : 35}h20`}
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
        ))}
      </g>
      <path d="M77 6 Q80 0 83 6 L84 53 80 61 76 53Z" />
      <path d="M77 47 59 57 61 61 80 56 99 61 101 57 83 47Z" />
    </svg>
  );
}
export default function App() {
  const [runtime] = useState(() => new SimulationRuntime());
  const simulation = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
  );
  const externallyControlled = simulation.control !== "local";
  const [bridge] = useState(
    () =>
      new SimulationBridge(runtime, {
        origin: window.location.origin,
        fetch: window.fetch.bind(window),
        eventSource: (url) => new EventSource(url),
        viewerId: `viewer_${crypto.randomUUID().replaceAll("-", "")}`,
      }),
  );
  const [loader] = useState(() => new RecordingLoader(runtime, bridge));
  const [workspace, setWorkspace] = useState<"mechanism" | "simulation">(
    "mechanism",
  );
  const [modal, setModal] = useState<"info" | "properties" | null>(null);
  const [resetRequest, requestReset] = useState(0);
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  const openModal = (kind: "info" | "properties") => {
    modalReturnFocus.current = document.activeElement as HTMLElement;
    setModal(kind);
  };
  const [variant] = useState<Variant>("xp4"),
    [loop, setLoop] = useState(true),
    [rate, setRate] = useState(1),
    [wireframe, setWireframe] = useState(false),
    [internalDriveRequested, setInternalDriveRequested] = useState(false),
    [showAxes, setShowAxes] = useState(true),
    [environment, setEnvironment] = useState<"hangar" | "sky">("hangar"),
    [lowQuality, setLowQuality] = useState(
      () =>
        window.innerWidth < 768 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [loaded, setLoaded] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const {
    state,
    dispatch,
    setTime,
    setPlaying,
    setInspection,
    setJointSide,
    setCameraView,
    setCameraReset,
    setAutoRotate,
    setExploded,
  } = useExperience(!externallyControlled);
  const {
    time,
    playing,
    tiltMode,
    tilt,
    inspection,
    jointSide,
    cameraView,
    cameraReset,
    autoRotate,
    exploded,
    detailView,
    detailPose,
  } = state;
  // 仅本地观察状态：Python 的 display、步进、暂停与控制权均不改写。
  const displayedExploded = externallyControlled
    ? simulation.state.display.exploded
    : exploded;
  const internalDriveInspection =
    internalDriveRequested && !detailView && !displayedExploded;
  useEffect(() => {
    if (detailView || displayedExploded) setInternalDriveRequested(false);
  }, [detailView, displayedExploded]);
  const localInput = (driver: "demo" | "manual" = "demo") =>
    beginLocalControl(runtime, bridge, loader, driver);
  const dispatchTilt = (action: TiltAction) => {
    if (localInput()) dispatch({ type: "tilt", action });
  };
  const unfold = externallyControlled
    ? simulation.state.wingTilt
    : displayedUnfold(state);
  const flightView =
    externallyControlled || (!tiltMode && (time > 0 || playing));
  const enterTilt = () => {
    if (localInput()) dispatch({ type: "enter-tilt" });
  };
  const leaveTilt = () => {
    if (!localInput()) return;
    setInternalDriveRequested(false);
    dispatch({ type: "leave-tilt" });
  };
  const inspectJoint = (side: "L" | "R" = "R") => {
    if (!localInput()) return;
    setInternalDriveRequested(false);
    dispatch({ type: "joint", side });
  };
  const selectInspection = (view: CameraView) => {
    if (!localInput()) return;
    setInternalDriveRequested(false);
    dispatch({ type: "inspect", view });
  };
  const toggleInternalDrive = () => {
    if (!internalDriveInspection && !externallyControlled) {
      // 已在播放的整翼继续使用原来的进度与速度；飞行演示切入静止机体检查。
      enterTilt();
      setJointSide(null);
    }
    setInternalDriveRequested(!internalDriveInspection);
  };
  const playFlight = () => {
    if (!localInput()) return;
    setInternalDriveRequested(false);
    dispatch({ type: "play-flight" });
  };
  const phase = getFlight(time),
    model = variants.find((v) => v.id === variant)!;
  const currentExperience = useRef(state);
  currentExperience.current = state;
  const onLoaded = useCallback(() => setLoaded(true), []);
  const previousFlightTime = useRef(0);
  // 本地面板、自主演示和Python都先提交到同一状态源，场景只消费快照。
  useLayoutEffect(() => {
    if (externallyControlled) return;
    const stationary = inspection || tiltMode;
    const f = getFlight(time);
    const q = new Quaternion().setFromEuler(
      new Euler(0, stationary ? 0 : f.yaw, stationary ? 0 : f.bank),
    );
    const jump =
      time < previousFlightTime.current ||
      Math.abs(time - previousFlightTime.current) > 0.25;
    if (jump) runtime.seekLocal(time);
    previousFlightTime.current = time;
    let motors: MotorCommands | undefined;
    if (simulation.driver === "demo") {
      const rpm = stationary ? 0 : f.rpm * 1800;
      const rearOff =
        f.index === 4 || f.index === 5 || (f.index === 3 && f.progress > 0.55);
      motors = Object.fromEntries(
        MOTOR_IDS.map((id) => [
          id,
          {
            targetRpm: id.endsWith("Rear") && rearOff ? 0 : rpm,
            enabled: rpm >= 60 && !(id.endsWith("Rear") && rearOff),
          },
        ]),
      ) as MotorCommands;
    }
    if (exploded) motors = newMotorCommands();
    const details = detailView && !exploded ? detailPose : NEUTRAL_DETAIL_POSE;
    runtime.setLocal({
      positionM: [
        stationary ? 0 : f.x,
        stationary ? 0 : f.altitude * 0.32,
        stationary ? 0 : f.z,
      ],
      attitude: q.toArray(),
      wingTilt: displayedUnfold(state),
      ...(motors ? { motors } : {}),
      surfaces: detailSurfaces(details),
      hatchDeg: details.hatch,
      display: { wireframe, exploded, environment },
      time: { paused: !playing && simulation.driver !== "manual" },
    });
  }, [
    runtime,
    externallyControlled,
    time,
    inspection,
    tiltMode,
    tilt.progress,
    detailView,
    detailPose,
    wireframe,
    exploded,
    environment,
    playing,
    simulation.driver,
  ]);
  // 唯一浏览器时钟：本地演示/手动电机或JSON回放。外部模式只接受Python step。
  useEffect(() => {
    if (!loaded) return;
    let previous = 0,
      frame = 0;
    const tick = (now: number) => {
      if (previous) {
        const dt = Math.min((now - previous) / 1000, 0.1);
        runtime.advancePresentation(dt);
        const snapshot = runtime.getSnapshot();
        const current = currentExperience.current;
        if (snapshot.control === "local") {
          if (current.tiltMode && current.tilt.playing)
            dispatch({ type: "tilt", action: { type: "tick", seconds: dt } });
          if (current.playing && !current.tiltMode)
            dispatch({ type: "advance-flight", seconds: dt * rate, loop });
          if (current.playing || snapshot.driver === "manual")
            runtime.stepLocal(dt * (current.playing ? rate : 1));
        } else if (snapshot.control === "replay") runtime.advanceReplay(dt);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loaded, runtime, rate, loop, externallyControlled]);
  const lifecycle = useRef(0);
  useEffect(() => {
    const generation = ++lifecycle.current;
    const leave = () => {
      void bridge.close();
    };
    window.addEventListener("popstate", leave);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("popstate", leave);
      window.removeEventListener("pagehide", leave);
      queueMicrotask(() => {
        if (lifecycle.current === generation) {
          void bridge.close(false);
          runtime.dispose();
        }
      });
    };
  }, [runtime, bridge]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = escapeTarget({
          modal: !!modal,
          menu: menuOpen,
          drive: internalDriveInspection,
          detail: !!detailView,
        });
        if (target) e.preventDefault();
        if (target === "modal") setModal(null);
        else if (target === "menu") setMenuOpen(false);
        else if (target === "drive") setInternalDriveRequested(false);
        else if (target === "detail") dispatch({ type: "close-detail" });
        return;
      }
      if (modal || menuOpen || runtime.getSnapshot().control !== "local")
        return;
      if (
        e.code !== "Space" ||
        (e.target as HTMLElement).isContentEditable ||
        ["INPUT", "BUTTON", "SELECT", "TEXTAREA", "SUMMARY", "A"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      e.preventDefault();
      if (detailView) return;
      if (workspace === "mechanism") {
        enterTilt();
        dispatchTilt(
          tilt.playing
            ? { type: "pause" }
            : {
                type: "begin",
                direction: unfold >= 1 ? -1 : unfold <= 0 ? 1 : tilt.direction,
              },
        );
      } else if (runtime.getSnapshot().driver === "demo") playFlight();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    workspace,
    tilt,
    unfold,
    modal,
    menuOpen,
    detailView,
    internalDriveInspection,
    playing,
  ]);
  useEffect(() => {
    if (!modal) return;
    const previous =
      modalReturnFocus.current ?? (document.activeElement as HTMLElement);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>("[data-app-dialog]")!;
    dialog.querySelector<HTMLButtonElement>(".close")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      );
      if (!nodes.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0]?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal]);
  // 外控退出先由桥同步归还 runtime，随后在新渲染里复位受保护的 UI 状态。
  useEffect(() => {
    if (resetRequest && !externallyControlled) {
      setInternalDriveRequested(false);
      dispatch({ type: "reset" });
    }
  }, [resetRequest, externallyControlled]);
  const reset = () => {
    setInternalDriveRequested(false);
    if (!localInput()) return;
    runtime.resetLocal();
    dispatch({ type: "reset" });
  };
  const manualControl = () => {
    setPlaying(false);
    dispatch({ type: "tilt", action: { type: "pause" } });
    dispatch({ type: "close-detail" });
    setExploded(false);
    setAutoRotate(false);
  };

  return (
    <div className="app-shell">
      <div className="app-content" inert={!!modal}>
        <header className="topbar">
          <a
            className="brand"
            href="#experience"
            aria-label="Transwing 飞行研究室"
          >
            <span className="brand-mark">
              T<span>W</span>
            </span>
            <span>
              TRANSWING<small>整翼倾转 · 交互研究室</small>
            </span>
          </a>
          <nav
            className={menuOpen ? "nav open" : "nav"}
            aria-label="工作区导航"
          >
            <button
              className={workspace === "mechanism" ? "active" : ""}
              aria-pressed={workspace === "mechanism"}
              onClick={() => {
                setWorkspace("mechanism");
                setMenuOpen(false);
              }}
            >
              机构演示
            </button>
            <button
              className={workspace === "simulation" ? "active" : ""}
              aria-pressed={workspace === "simulation"}
              onClick={() => {
                setWorkspace("simulation");
                setMenuOpen(false);
              }}
            >
              仿真接口
            </button>
          </nav>
          <div className="header-actions">
            <button
              className="property-trigger"
              onClick={() => openModal("properties")}
              aria-haspopup="dialog"
            >
              <Settings2 size={16} /> 飞行器属性
            </button>
            <button
              className="research-trigger"
              onClick={() => openModal("info")}
              aria-haspopup="dialog"
            >
              研究说明 <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="mobile-menu icon-button"
            aria-label="切换导航菜单"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={20} />
          </button>
        </header>
        <main id="experience">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">P4 参考构型 / 交互视景</span>
              <h1>
                看见每一次形态转换<span>.</span>
              </h1>
            </div>
            <p>自由观察机体，独立探索机构，或接入同一仿真状态。</p>
          </div>
          <div className="viewport-shell">
            <div className="viewport-header">
              <div className="viewport-title">
                <span
                  className={loaded ? "status-dot" : "status-dot loading"}
                />
                <strong>三维视景</strong>
                <span>{loaded ? "模型已就绪" : "模型载入中"}</span>
              </div>
              <div
                className="environment-toggle"
                role="group"
                aria-label="场景环境"
              >
                <button
                  disabled={externallyControlled}
                  className={environment === "hangar" ? "active" : ""}
                  aria-pressed={environment === "hangar"}
                  onClick={() => setEnvironment("hangar")}
                >
                  机库
                </button>
                <button
                  disabled={externallyControlled}
                  className={environment === "sky" ? "active" : ""}
                  aria-pressed={environment === "sky"}
                  onClick={() => setEnvironment("sky")}
                >
                  开阔天空
                </button>
              </div>
            </div>
            <section
              className={`experience${inspection || internalDriveInspection ? " inspecting" : ""}${jointSide ? " joint-inspection" : ""}${detailView ? " detail-inspection" : ""}${internalDriveInspection ? " drive-inspection" : ""}${flightView ? " in-flight" : ""}${tiltMode ? " mechanism-active" : ""}${detailView || internalDriveInspection || (!externallyControlled && inspection) ? " has-inspector" : ""}`}
              aria-label="交互飞行实验室"
            >
              <div className="scene">
                <SceneBoundary resetKey={variant}>
                  <Scene
                    runtime={runtime}
                    variant={variant}
                    time={time}
                    tiltProgress={tiltMode ? tilt.progress : null}
                    wireframe={wireframe}
                    internalDriveInspection={internalDriveInspection}
                    exploded={simulation.state.display.exploded}
                    cameraView={cameraView}
                    cameraReset={cameraReset}
                    inspection={externallyControlled ? false : inspection}
                    jointSide={jointSide}
                    detailView={detailView}
                    detailPose={detailPose}
                    showAxes={showAxes}
                    flightView={flightView}
                    autoRotate={autoRotate}
                    lowQuality={lowQuality}
                    onLoaded={onLoaded}
                    onCloseDetail={() => dispatch({ type: "close-detail" })}
                    environment={environment}
                  />
                </SceneBoundary>
              </div>
              {detailView && (
                <DetailPanel
                  view={detailView}
                  pose={detailPose}
                  onSelect={(view) => dispatch({ type: "detail", view })}
                  onChange={(control, degrees) =>
                    dispatch({ type: "detail-pose", control, degrees })
                  }
                  onClose={() => dispatch({ type: "close-detail" })}
                  onNeutral={() => dispatch({ type: "detail-neutral" })}
                />
              )}
              {internalDriveInspection && (
                <InternalDrivePanel
                  progress={unfold}
                  external={externallyControlled}
                  onClose={() => setInternalDriveRequested(false)}
                />
              )}
              {!externallyControlled &&
                inspection &&
                !detailView &&
                !internalDriveInspection && (
                  <div className="inspection-context">
                    <span>
                      {jointSide
                        ? `${jointSide === "R" ? "右" : "左"}侧翼根关节与连杆`
                        : cameraView === "top"
                          ? "正交俯视 · 机头朝上"
                          : "整翼机构检查"}
                    </span>
                    <strong>
                      {Math.round(unfold * 100)}
                      <small>% 展开</small>
                    </strong>
                    <p>
                      {jointSide
                        ? "黑色连杆随翼端摆动，后端滑架同步移动。金色虚线为模型旋转轴，浅绿色弧线为 0–120° 运动范围。"
                        : "机身航向固定。切换视角保留当前展开程度。"}
                      {
                        " 滚轮或双指缩放，右键或双指拖动平移；可将细节移到画面中央。"
                      }
                    </p>
                    {!jointSide && (
                      <div
                        className="pose-presets"
                        role="group"
                        aria-label="检查形态预设"
                      >
                        {[
                          { value: 0, label: "折叠" },
                          { value: 0.5, label: "转换" },
                          { value: 1, label: "巡航" },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            aria-pressed={Math.abs(unfold - value) < 0.001}
                            onClick={() => {
                              enterTilt();
                              dispatchTilt({ type: "scrub", progress: value });
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {jointSide && (
                      <>
                        <div
                          className="joint-side-switch"
                          role="group"
                          aria-label="检查哪侧关节"
                        >
                          <button
                            aria-pressed={jointSide === "L"}
                            onClick={() => inspectJoint("L")}
                          >
                            左关节
                          </button>
                          <button
                            aria-pressed={jointSide === "R"}
                            onClick={() => inspectJoint("R")}
                          >
                            右关节
                          </button>
                        </div>
                        <label className="axis-toggle">
                          <input
                            type="checkbox"
                            checked={showAxes}
                            onChange={(e) => setShowAxes(e.target.checked)}
                          />
                          显示轴线与转角
                        </label>
                        <small>
                          模型转角 {(unfold * 120).toFixed(1)}° · 理想化机构示意
                        </small>
                        <button
                          className="joint-back"
                          onClick={() => selectInspection("perspective")}
                        >
                          返回整机检查 ↗
                        </button>
                      </>
                    )}
                  </div>
                )}
            </section>
            <div className="viewport-toolbar">
              <div className="scene-tools" aria-label="视图工具">
                <button
                  disabled={externallyControlled}
                  className={
                    detailView
                      ? "selected icon-button detail-entry"
                      : "icon-button detail-entry"
                  }
                  aria-label="细节检查"
                  title="舵面、舱盖、探头与动力系统细节检查"
                  aria-pressed={!!detailView}
                  onClick={() => {
                    if (!localInput()) return;
                    dispatch(
                      detailView
                        ? { type: "close-detail" }
                        : { type: "detail", view: "wing" },
                    );
                  }}
                >
                  <Focus size={18} />
                  <span>细节</span>
                </button>
                <button
                  disabled={externallyControlled}
                  className={wireframe ? "selected icon-button" : "icon-button"}
                  aria-label="线框视图"
                  title="线框视图"
                  aria-pressed={wireframe}
                  onClick={() => setWireframe(!wireframe)}
                >
                  <Box size={18} />
                </button>
                <button
                  className={
                    internalDriveInspection
                      ? "selected icon-button drive-entry"
                      : "icon-button drive-entry"
                  }
                  aria-label="内部驱动视图"
                  title="移开外壳，检查中央驱动与左右连杆；内部布局为概念重建"
                  aria-pressed={internalDriveInspection}
                  disabled={
                    externallyControlled && simulation.state.display.exploded
                  }
                  onClick={toggleInternalDrive}
                >
                  <ScanLine size={18} />
                  <span>内部驱动</span>
                </button>
                <button
                  disabled={externallyControlled}
                  className={exploded ? "selected icon-button" : "icon-button"}
                  aria-label="结构拆解"
                  title="结构拆解：机翼与连杆接头分离，连杆不伸长"
                  aria-pressed={exploded}
                  onClick={() => {
                    if (!localInput()) return;
                    setInternalDriveRequested(false);
                    setJointSide(null);
                    setExploded(!exploded);
                    setPlaying(false);
                    dispatchTilt({ type: "pause" });
                  }}
                >
                  <Layers3 size={18} />
                </button>
                <button
                  disabled={externallyControlled}
                  className={
                    autoRotate ? "selected icon-button" : "icon-button"
                  }
                  aria-label="360度自动环绕"
                  title="360° 自动环绕"
                  aria-pressed={autoRotate}
                  onClick={() => {
                    if (!localInput()) return;
                    setInternalDriveRequested(false);
                    enterTilt();
                    dispatchTilt({ type: "pause" });
                    setJointSide(null);
                    setInspection(false);
                    setAutoRotate(!autoRotate);
                  }}
                >
                  <RotateCw size={18} />
                </button>
                <span />
                <button
                  disabled={externallyControlled}
                  className="icon-button"
                  aria-label="恢复默认视角"
                  title="恢复默认视角并返回自由观察"
                  onClick={() => {
                    if (!localInput(simulation.driver)) return;
                    setInternalDriveRequested(false);
                    setJointSide(null);
                    setInspection(false);
                    setCameraView("perspective");
                    setCameraReset((n) => n + 1);
                    setAutoRotate(false);
                  }}
                >
                  <Crosshair size={18} />
                </button>
              </div>
              <div
                className="camera-presets"
                role="group"
                aria-label="多角度检查"
                inert={externallyControlled}
              >
                <button
                  title="返回透视观察，可自由拖动旋转"
                  aria-pressed={
                    !inspection && !detailView && !internalDriveInspection
                  }
                  onClick={() => {
                    if (!localInput(simulation.driver)) return;
                    setInternalDriveRequested(false);
                    dispatch({ type: "tilt", action: { type: "pause" } });
                    setJointSide(null);
                    setInspection(false);
                    setCameraView("perspective");
                    setCameraReset((value) => value + 1);
                  }}
                >
                  自由观察
                </button>
                {INSPECTION_VIEWS.map(({ id, label, detail }) => (
                  <button
                    key={id}
                    title={detail}
                    aria-pressed={
                      inspection &&
                      !jointSide &&
                      !detailView &&
                      !internalDriveInspection &&
                      cameraView === id
                    }
                    onClick={() => selectInspection(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="viewport-status">
              <span>拖动旋转 · 滚轮缩放 · 右键 / 双指平移</span>
              <div>
                <span data-testid="flight-phase">
                  {externallyControlled
                    ? simulation.control === "replay"
                      ? "JSON 记录回放"
                      : "Python 外部控制"
                    : simulation.driver === "manual"
                      ? "手动电机控制"
                      : detailView
                        ? "静态细节检查"
                        : tiltMode
                          ? tilt.playing
                            ? tilt.direction === 1
                              ? "连续展开中"
                              : "连续收拢中"
                            : "机构已暂停"
                          : playing
                            ? phase.phase.label
                            : "待命 / 已暂停"}
                </span>
                <strong>
                  {Math.round(unfold * 100)}% <small>整翼展开</small>
                </strong>
              </div>
            </div>
          </div>
          <div
            className="workspace-tabs"
            role="group"
            aria-label="选择控制工作区"
          >
            <button
              aria-pressed={workspace === "mechanism"}
              aria-controls="mechanism-panel"
              onClick={() => setWorkspace("mechanism")}
            >
              <MoveUpRight size={18} />
              <span>
                机构演示<small>形态 · 行程 · 连接</small>
              </span>
            </button>
            <button
              aria-pressed={workspace === "simulation"}
              aria-controls="simulation-panel"
              onClick={() => setWorkspace("simulation")}
            >
              <Settings2 size={18} />
              <span>
                仿真接口<small>连续飞行 · 四电机 · Python</small>
              </span>
            </button>
            <span className="control-badge">
              当前控制：
              {externallyControlled
                ? simulation.control === "replay"
                  ? "JSON 回放"
                  : "Python"
                : simulation.driver === "manual"
                  ? "手动电机"
                  : "本地演示"}
            </span>
          </div>
          {workspace === "mechanism" && externallyControlled && (
            <div className="ownership-notice" role="status">
              当前由 {simulation.control === "replay" ? "JSON 回放" : "Python"}{" "}
              控制。机构操作已锁定，切换页面不会中断输入。
              <button onClick={() => setWorkspace("simulation")}>
                前往仿真接口管理控制源 ↗
              </button>
            </div>
          )}
          <section
            className="tilt-console"
            id="mechanism-panel"
            hidden={workspace !== "mechanism"}
            aria-label="独立机构演示"
            inert={externallyControlled}
          >
            <div>
              <span className="eyebrow">独立机构演示</span>
              <h2>一个机体，两种可能</h2>
              <p>
                整翼与动力舱共同转动，定长连杆与滑架同步运动。选择形态，或用八秒连续转换看清每一次连接。
                操作机构时保留当前观察角度与缩放。
              </p>
              <div
                className="mechanism-presets"
                role="group"
                aria-label="机构形态预设"
              >
                {[
                  {
                    progress: 0,
                    title: "垂直起降",
                    detail: "整翼收拢 · 升力向上",
                  },
                  {
                    progress: 0.5,
                    title: "整翼转换",
                    detail: "倾斜铰链 · 连续转动",
                  },
                  {
                    progress: 1,
                    title: "固定翼巡航",
                    detail: "翼面展开 · 推力向前",
                  },
                ].map((pose) => (
                  <button
                    key={pose.progress}
                    aria-pressed={Math.abs(unfold - pose.progress) < 0.001}
                    onClick={() => {
                      enterTilt();
                      dispatchTilt({ type: "scrub", progress: pose.progress });
                    }}
                  >
                    <Silhouette fold={1 - pose.progress} />
                    <strong>{pose.title}</strong>
                    <small>{pose.detail}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="tilt-controls">
              <label htmlFor="wing-tilt">
                整翼展开进度{" "}
                <strong data-testid="tilt-value">
                  {Math.round(unfold * 100)}%
                </strong>
              </label>
              <input
                id="wing-tilt"
                className="scrubber"
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={unfold * 100}
                aria-valuetext={`${Math.round(unfold * 100)}% 展开`}
                onChange={(e) => {
                  enterTilt();
                  dispatchTilt({
                    type: "scrub",
                    progress: Number(e.target.value) / 100,
                  });
                }}
                style={
                  { "--progress": `${unfold * 100}%` } as React.CSSProperties
                }
              />
              <div className="tilt-endpoints">
                <span>0% · 完全折叠 / 垂直起降</span>
                <span>100% · 固定翼巡航</span>
              </div>
              <div className="tilt-actions">
                <button
                  disabled={unfold >= 1}
                  onClick={() => {
                    enterTilt();
                    dispatchTilt({ type: "begin", direction: 1 });
                  }}
                >
                  连续展开
                </button>
                <button
                  disabled={unfold <= 0}
                  onClick={() => {
                    enterTilt();
                    dispatchTilt({ type: "begin", direction: -1 });
                  }}
                >
                  连续收拢
                </button>
                <button
                  disabled={!tiltMode || !tilt.playing}
                  onClick={() => dispatchTilt({ type: "pause" })}
                >
                  暂停倾转
                </button>
                <button
                  onClick={() => {
                    enterTilt();
                    dispatchTilt({ type: "reset" });
                  }}
                >
                  折叠复位
                </button>
                <button
                  aria-pressed={tilt.repeat}
                  onClick={() =>
                    dispatchTilt({ type: "repeat", enabled: !tilt.repeat })
                  }
                >
                  往返循环 {tilt.repeat ? "开" : "关"}
                </button>
              </div>
              <button
                className="joint-entry"
                aria-pressed={!!jointSide}
                onClick={() => inspectJoint(jointSide ?? "R")}
              >
                <Focus size={16} /> 关节特写
              </button>
              <div className="tilt-speed">
                <label>
                  机构速度{" "}
                  <select
                    aria-label="倾转播放速度"
                    value={tilt.rate}
                    onChange={(e) =>
                      dispatchTilt({
                        type: "rate",
                        value: Number(e.target.value),
                      })
                    }
                  >
                    <option value={0.5}>0.5× · 慢动作</option>
                    <option value={1}>1× · 8 秒</option>
                    <option value={2}>2×</option>
                  </select>
                </label>
                <span>
                  {tiltMode
                    ? tilt.playing
                      ? "正在运行 · 可直接反向"
                      : "手动检查 · 空格继续"
                    : "拖动滑块进入机构检查"}
                </span>
              </div>
            </div>
          </section>
          <div hidden={workspace !== "simulation"} id="simulation-panel">
            <SimulationPanel
              runtime={runtime}
              bridge={bridge}
              loader={loader}
              onManual={manualControl}
              onDemo={() => {
                if (localInput()) {
                  setPlaying(false);
                  dispatchTilt({ type: "pause" });
                }
              }}
              onExternal={() => {
                setInternalDriveRequested(false);
                dispatch({ type: "reset" });
              }}
              onReset={() => requestReset((value) => value + 1)}
            >
              <section
                className="flight-console"
                aria-label="飞行控制台"
                inert={externallyControlled || simulation.driver !== "demo"}
              >
                <div className="console-title">
                  <span className="eyebrow">连续飞行演示 · 同源仿真驱动</span>
                  <h3>从地面，到天空</h3>
                  <p>{phase.phase.detail}</p>
                </div>
                <div className="sequence-panel">
                  <div className="playback">
                    <button
                      className="play-button"
                      data-testid="play-toggle"
                      aria-label={playing ? "暂停飞行" : "播放飞行"}
                      onClick={playFlight}
                    >
                      {playing ? (
                        <Pause size={17} />
                      ) : (
                        <Play size={17} fill="currentColor" />
                      )}
                      {playing
                        ? "暂停飞行"
                        : !tiltMode && time > 0 && time < TOTAL
                          ? "继续飞行"
                          : "开始完整飞行"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="重置飞行"
                      title="重置"
                      onClick={reset}
                    >
                      <RotateCcw size={17} />
                    </button>
                    <span className="playback-time">
                      {Math.floor(time).toString().padStart(2, "0")}{" "}
                      <span>/ {TOTAL} S</span>
                    </span>
                    <div className="playback-options">
                      <button
                        className={loop ? "loop active" : "loop"}
                        aria-pressed={loop}
                        onClick={() => setLoop(!loop)}
                      >
                        循环 {loop ? "开" : "关"}
                      </button>
                      <label>
                        速度
                        <select
                          aria-label="播放速度"
                          value={rate}
                          onChange={(e) => setRate(Number(e.target.value))}
                        >
                          <option value={0.5}>0.5×</option>
                          <option value={1}>1×</option>
                          <option value={2}>2×</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <input
                    className="scrubber"
                    aria-label="飞行进度"
                    type="range"
                    min="0"
                    max={TOTAL}
                    step=".01"
                    value={time}
                    onChange={(e) => {
                      if (!localInput()) return;
                      if (!flightView) setCameraReset((value) => value + 1);
                      leaveTilt();
                      setInspection(false);
                      setExploded(false);
                      setTime(Number(e.target.value));
                      setPlaying(false);
                    }}
                    style={
                      {
                        "--progress": `${(time / TOTAL) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                  <div className="phase-track">
                    {PHASES.map((p, i) => (
                      <button
                        key={p.id}
                        data-testid={`phase-${p.id}`}
                        title={`播放${p.label}阶段`}
                        className={
                          phase.index === i
                            ? "active"
                            : phase.index > i
                              ? "complete"
                              : ""
                        }
                        onClick={() => {
                          if (!localInput()) return;
                          if (!flightView) setCameraReset((value) => value + 1);
                          leaveTilt();
                          setTime(phaseStart(i));
                          setInspection(false);
                          setExploded(false);
                          setPlaying(true);
                        }}
                      >
                        <span className="phase-node" />
                        <span>{p.label}</span>
                        <small>0{i + 1}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </SimulationPanel>
          </div>
        </main>
        <footer>
          <span>TRANSWING · 独立交互概念研究</span>
          <button onClick={() => openModal("info")}>
            研究说明与资料 <ArrowUpRight size={13} />
          </button>
          <button
            aria-pressed={lowQuality}
            onClick={() => setLowQuality(!lowQuality)}
          >
            <Settings2 size={13} />
            {lowQuality ? "节能画质" : "高质量渲染"}
          </button>
          <span>非官方产品 · 非工程仿真</span>
        </footer>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="info-modal"
            data-app-dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label={
                modal === "properties" ? "关闭飞行器属性" : "关闭研究说明"
              }
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "properties" ? (
              <>
                <span className="eyebrow">飞行器属性 / 参考资料</span>
                <h2 id="dialog-title">TRANSWING P4</h2>
                <p>{model.description}</p>
                <div className="property-grid">
                  {[
                    { value: "41", unit: "kg", label: "最大起飞重量" },
                    { value: "6.8", unit: "kg", label: "有效载荷" },
                    { value: "31", unit: "m/s", label: "巡航速度" },
                    { value: "70", unit: "min", label: "续航时间" },
                  ].map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>
                        {item.value}
                        <small>{item.unit}</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="property-source">
                  厂商 2025
                  年公开资料；这些数值是参考信息，并非动画测量或模型仿真输出。
                </p>
                <dl className="property-details">
                  <div>
                    <dt>参考构型</dt>
                    <dd>蓝白 P4 · 六舵面 · 分体前货舱盖</dd>
                  </div>
                  <div>
                    <dt>机构原理</dt>
                    <dd>倾斜铰链 · 整翼倾转 · 固定长度连杆</dd>
                  </div>
                  <div>
                    <dt>演示边界</dt>
                    <dd>内部布局、行程、转速与轨迹为概念约定</dd>
                  </div>
                </dl>
                <a
                  className="source-link"
                  href="https://pterodynamics.com/media/PD_TranswingSpecs_2025.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看厂商公开规格 <ArrowUpRight size={16} />
                </a>
              </>
            ) : (
              <>
                <span className="eyebrow">设计研究 / 原理与资料</span>
                <h2 id="dialog-title">
                  改变整翼的方向，
                  <br />
                  保留飞行的连续性。
                </h2>
                <p>
                  Transwing
                  的关键是整片机翼绕倾斜铰链折叠。垂直起降时，机翼向机身后方收拢，前缘向上；巡航时机翼展开，动力单元随机翼转向前方。机身整体保持平飞姿态。
                </p>
                <div className="info-grid">
                  <div>
                    <span>01</span>
                    <h3>整翼，而非只转动电机</h3>
                    <p>
                      模型中的四个动力单元随左右整翼转动。转换使用连续四元数旋转。
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <h3>研究，不等同于工程参数</h3>
                    <p>
                      模型为原创视觉重建。铰链尺寸、飞行时间与路径均用于交互演示。
                    </p>
                  </div>
                </div>
                <p>
                  本作品仅展示一版依据公开资料重建的 P4 参考构型，并非
                  Pterodynamics
                  官方数字模型。固定长度连杆连接移动滑架与翼面偏轴接头，两端接头随姿态转动。
                  滑架行程、内部传动、模型 120°
                  转角、巡航旋翼停止时序与折桨均为理想化演示，并非厂商内部 CAD
                  或真实飞控逻辑。
                </p>
                <p>
                  当前动画展示外侧桨收起的双桨巡航工况。官方视频也介绍了四台电机共同工作、用于加速和爬升的模式，因此双桨巡航并非唯一实际工况。
                </p>
                <p>
                  细节检查中的六个舵面采用柔性铰接位置下的刚体偏转近似，±12°
                  与货舱盖 0–55°
                  均为模型检视范围。进入后暂停飞行、固定整翼展开；离开自动回中、关盖。每吊舱电机与电调的组成有公开手册依据，独立模块的形状和布置仍为概念示意。
                </p>
                <a
                  className="source-link"
                  href="https://pterodynamics.com/media/PD_TranswingSpecs_2025.pdf"
                  target="_blank"
                  rel="noreferrer"
                >
                  Pterodynamics 官方规格资料 <ArrowUpRight size={16} />
                </a>
                <p className="small-print">
                  使用方式：拖动查看 360° · 滚轮缩放 · 空格播放/暂停 · Esc
                  关闭说明或细节检查。多角度检查使用正交投影并固定机体航向，可配合时间轴检查同一机体的不同形态。低性能设备可启用节能画质。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
