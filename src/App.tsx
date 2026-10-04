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
import InternalDrivePanel from "./InternalDrivePanel";
import SimulationPanel from "./SimulationPanel";
import { SimulationRuntime } from "./simulation";
import { SimulationBridge } from "./simulationBridge";
import { MOTOR_IDS, newMotorCommands, type MotorCommands } from "./motors";
import { Euler, Quaternion } from "three";
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
    [showInfo, setShowInfo] = useState(false),
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
  const dispatchTilt = (action: TiltAction) =>
    dispatch({ type: "tilt", action });
  const unfold = externallyControlled
    ? simulation.state.wingTilt
    : displayedUnfold(state);
  const flightView =
    externallyControlled || (!tiltMode && (time > 0 || playing));
  const enterTilt = () => dispatch({ type: "enter-tilt" });
  const leaveTilt = () => {
    setInternalDriveRequested(false);
    dispatch({ type: "leave-tilt" });
  };
  const inspectJoint = (side: "L" | "R" = "R") => {
    setInternalDriveRequested(false);
    dispatch({ type: "joint", side });
  };
  const selectInspection = (view: CameraView) => {
    setInternalDriveRequested(false);
    dispatch({ type: "inspect", view });
  };
  const toggleInternalDrive = () => {
    if (!internalDriveInspection && !externallyControlled) {
      // 已在播放的整翼继续使用原来的进度与速度；飞行演示切入静止机体检查。
      enterTilt();
      setJointSide(null);
      setCameraView("perspective");
    }
    setInternalDriveRequested(!internalDriveInspection);
  };
  const playFlight = () => {
    setInternalDriveRequested(false);
    runtime.setLocal({}, "demo");
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
    const details =
      detailView && !exploded
        ? detailPose
        : { inboard: 0, outboard: 0, tail: 0, hatch: 0 };
    runtime.setLocal({
      positionM: [
        stationary ? 0 : f.x,
        stationary ? 0 : f.altitude * 0.32,
        stationary ? 0 : f.z,
      ],
      attitude: q.toArray(),
      wingTilt: displayedUnfold(state),
      ...(motors ? { motors } : {}),
      surfaces: {
        L_Inboard: details.inboard,
        R_Inboard: details.inboard,
        L_Outboard: details.outboard,
        R_Outboard: details.outboard,
        Tail_L: details.tail,
        Tail_R: details.tail,
      },
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
      if (e.key === "Escape" && internalDriveInspection && !showInfo) {
        setInternalDriveRequested(false);
        return;
      }
      if (externallyControlled) {
        if (e.key === "Escape") {
          void bridge.close();
          setShowInfo(false);
          setMenuOpen(false);
        }
        return;
      }
      if (showInfo && e.key !== "Escape") return;
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement).isContentEditable &&
        !["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        if (detailView) return;
        if (tiltMode) {
          dispatchTilt(
            tilt.playing
              ? { type: "pause" }
              : {
                  type: "begin",
                  direction:
                    tilt.progress >= 1
                      ? -1
                      : tilt.progress <= 0
                        ? 1
                        : tilt.direction,
                },
          );
        } else {
          playFlight();
        }
      }
      if (e.key === "Escape") {
        if (!showInfo && detailView) dispatch({ type: "close-detail" });
        setShowInfo(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tiltMode,
    tilt.playing,
    tilt.direction,
    tilt.progress,
    showInfo,
    time,
    detailView,
    externallyControlled,
    internalDriveInspection,
  ]);
  useEffect(() => {
    if (!showInfo) return;
    const previous = document.activeElement as HTMLElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLButtonElement>(".info-modal .close")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".info-modal button,.info-modal a",
        ),
      );
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
      previous?.focus();
    };
  }, [showInfo]);
  const reset = () => {
    setInternalDriveRequested(false);
    void bridge.close();
    dispatch({ type: "reset" });
  };
  const manualControl = () => {
    setPlaying(false);
    dispatchTilt({ type: "pause" });
    dispatch({ type: "close-detail" });
    setExploded(false);
    setAutoRotate(false);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Transwing 首页">
          <span className="brand-mark">
            T<span>W</span>
          </span>
          <span>
            TRANSWING<small>飞行形态研究室 / 整翼倾转</small>
          </span>
        </a>
        <nav className={menuOpen ? "nav open" : "nav"} aria-label="主导航">
          <a
            href="#experience"
            className="active"
            onClick={() => setMenuOpen(false)}
          >
            交互体验 <span>01</span>
          </a>
          <button
            onClick={() => {
              setShowInfo(true);
              setMenuOpen(false);
            }}
          >
            设计原理 <span>02</span>
          </button>
          <a href="#airframes" onClick={() => setMenuOpen(false)}>
            形态研究 <span>03</span>
          </a>
        </nav>
        <div className="header-status">
          <span className="status-dot" />
          实时 3D 实验室
        </div>
        <button
          className="mobile-menu icon-button"
          aria-label="切换导航菜单"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu size={20} />
        </button>
      </header>
      <main id="experience">
        <section
          className={`experience${inspection || internalDriveInspection ? " inspecting" : ""}${jointSide ? " joint-inspection" : ""}${detailView ? " detail-inspection" : ""}${internalDriveInspection ? " drive-inspection" : ""}${flightView ? " in-flight" : ""}${tiltMode ? " mechanism-active" : ""}`}
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
          <div className="scene-vignette" />
          <div className="hero-copy" inert={externallyControlled}>
            <div className="eyebrow">
              <span /> 在形态之间，探索飞行的可能
            </div>
            <h1>
              不止一种
              <br />
              飞行形态<span className="title-dot">.</span>
            </h1>
            <p>
              垂直起降的自由。固定翼飞行的从容。
              <br />
              让整翼的每一次转动，连接两种可能。
            </p>
            <button
              className="text-link"
              onClick={() => {
                enterTilt();
                setJointSide(null);
                setCameraView("perspective");
                dispatchTilt({
                  type: "begin",
                  direction: unfold >= 1 ? -1 : 1,
                });
              }}
            >
              {unfold >= 1 ? "观看连续收拢" : "观看连续展开"}{" "}
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="scene-heading">
            <span className="corner" />
            <span>机体编号 / {model.index}</span>
            <strong>{model.code}</strong>
            <span className="concept-badge">{model.tag}</span>
          </div>
          <div className="vertical-label">倾斜铰链 / 整翼倾转技术</div>
          <div className="model-label">
            <span className="target-cross">+</span>
            <span>
              {model.name}
              <small>
                {unfold > 0.98
                  ? "固定翼巡航构型"
                  : unfold > 0.02
                    ? "连续整翼转换"
                    : "紧凑垂直起降构型"}
              </small>
            </span>
            <div className="leader" />
          </div>
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
              onClick={() =>
                dispatch(
                  detailView
                    ? { type: "close-detail" }
                    : { type: "detail", view: "wing" },
                )
              }
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
              className={autoRotate ? "selected icon-button" : "icon-button"}
              aria-label="360度自动环绕"
              title="360° 自动环绕"
              aria-pressed={autoRotate}
              onClick={() => {
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
              title="恢复默认视角"
              onClick={() => {
                setInternalDriveRequested(false);
                setJointSide(null);
                if (!tiltMode) setInspection(false);
                setCameraView("perspective");
                setCameraReset((n) => n + 1);
                setAutoRotate(false);
              }}
            >
              <Crosshair size={18} />
            </button>
          </div>
          <div className="scene-bottom" inert={externallyControlled}>
            <span>
              <i className={loaded ? "status-dot" : "status-dot loading"} />
              {loaded
                ? internalDriveInspection
                  ? "内部驱动 / 外壳暂时移开 · 同源机构联动"
                  : exploded
                    ? "拆解示意 / 机翼与连杆接头已分离"
                    : detailView
                      ? "细节检查 / 静态限幅示意"
                      : inspection
                        ? jointSide
                          ? "关节与连杆 / 同步机构运动"
                          : "正交检查 / 机体航向已固定"
                        : "模型已就绪 / 拖动旋转 · 滚轮缩放 · 右键/双指平移"
                : "正在载入原生三维模型"}
            </span>
            <div className="inspection-panel">
              <div className="inspection-heading">
                <span>多角度检查</span>
                {inspection ? (
                  <>
                    <small>
                      {internalDriveInspection
                        ? "内部驱动 · 可自由旋转"
                        : jointSide
                          ? "关节特写"
                          : cameraView === "top"
                            ? "正交俯视 · 机头朝上"
                            : "正交投影 · 同一机体"}
                    </small>
                    <button
                      onClick={() => {
                        setInternalDriveRequested(false);
                        dispatchTilt({ type: "pause" });
                        setJointSide(null);
                        setInspection(false);
                      }}
                    >
                      自由观察
                    </button>
                  </>
                ) : (
                  <small>选择视角，暂停并对齐机体</small>
                )}
              </div>
              <div
                className="camera-presets"
                role="group"
                aria-label="多角度检查"
              >
                {INSPECTION_VIEWS.map(({ id, label, detail }) => (
                  <button
                    key={id}
                    aria-pressed={
                      inspection &&
                      !jointSide &&
                      !detailView &&
                      !internalDriveInspection &&
                      cameraView === id
                    }
                    title={detail}
                    onClick={() => {
                      selectInspection(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <span className="scene-number">
              场景 0{environment === "hangar" ? 1 : 2} <span>/</span>{" "}
              {environment === "hangar" ? "机库" : "开阔天空"}
            </span>
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
          {inspection && !detailView && !internalDriveInspection && (
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
                {" 滚轮或双指缩放，右键或双指拖动平移；可将细节移到画面中央。"}
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
          <div
            className="scene-transport"
            role="group"
            aria-label="场景内倾转控制"
            inert={externallyControlled}
          >
            <button
              disabled={unfold >= 1}
              onClick={() => {
                enterTilt();
                dispatchTilt({ type: "begin", direction: 1 });
              }}
            >
              <MoveUpRight size={15} />
              展开
            </button>
            <button
              disabled={unfold <= 0}
              onClick={() => {
                enterTilt();
                dispatchTilt({ type: "begin", direction: -1 });
              }}
            >
              <RotateCcw size={15} />
              收拢
            </button>
            <button
              aria-label="暂停当前演示"
              disabled={!playing && !tilt.playing}
              onClick={() => {
                setPlaying(false);
                dispatchTilt({ type: "pause" });
              }}
            >
              <Pause size={15} />
            </button>
            <span />
            <button
              aria-pressed={!!jointSide}
              onClick={() => inspectJoint(jointSide ?? "R")}
            >
              <Focus size={15} />
              关节特写
            </button>
          </div>
          <div className="telemetry">
            <div>
              <span>飞行状态</span>
              <strong data-testid="flight-phase">
                {externallyControlled
                  ? simulation.control === "replay"
                    ? "Python记录回放"
                    : "Python外部控制"
                  : detailView
                    ? "静态细节检查"
                    : tiltMode
                      ? tilt.playing
                        ? tilt.direction === 1
                          ? "连续展开中"
                          : "连续收拢中"
                        : unfold <= 0.001
                          ? "折叠待命"
                          : unfold >= 0.999
                            ? "巡航构型"
                            : "机构已暂停"
                      : time >= TOTAL
                        ? "飞行完成"
                        : phase.phase.label}
              </strong>
            </div>
            <div>
              <span>整翼展开进度</span>
              <strong>
                {Math.round(unfold * 100)}
                <small>%</small>
              </strong>
              <input
                className="scrubber scene-tilt-slider"
                aria-label="场景内整翼展开进度"
                disabled={externallyControlled}
                aria-valuetext={`${Math.round(unfold * 100)}% 展开`}
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={unfold * 100}
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
            </div>
            <span className="telemetry-note">
              {externallyControlled
                ? "仿真输入 / 非实测遥测"
                : "概念动画 / 非飞行遥测"}
            </span>
          </div>
        </section>
        <SimulationPanel
          runtime={runtime}
          bridge={bridge}
          onManual={manualControl}
          onExternal={() => dispatch({ type: "reset" })}
          onReset={() => {
            setInternalDriveRequested(false);
            dispatch({ type: "reset" });
          }}
        />
        <section
          className="tilt-console"
          aria-label="整翼倾转控制台"
          inert={externallyControlled}
        >
          <div>
            <span className="eyebrow">独立机构演示</span>
            <h2>从折叠开始，看清每一次转动</h2>
            <p>
              默认收拢待命。整翼与动力舱共同转动，黑色连杆随翼端接头摆动，滑架沿机身同步移动。标准速度八秒展开或收拢，可随时暂停、反向，或进入关节特写检查连接。
            </p>
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
        <section
          className="flight-console"
          aria-label="飞行控制台"
          inert={externallyControlled}
        >
          <div className="console-title">
            <span className="eyebrow">连续飞行演示</span>
            <h2>从地面，到天空</h2>
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
        <section
          className="airframes"
          id="airframes"
          inert={externallyControlled}
        >
          <div className="section-bar">
            <div>
              <span className="eyebrow">一个机体，两种可能</span>
              <h2>同一机体，两种飞行形态</h2>
            </div>
            <div className="environment-toggle">
              <button
                className={environment === "hangar" ? "active" : ""}
                onClick={() => setEnvironment("hangar")}
              >
                01 机库
              </button>
              <button
                className={environment === "sky" ? "active" : ""}
                onClick={() => setEnvironment("sky")}
              >
                02 开阔天空
              </button>
            </div>
          </div>
          <div className="variant-grid">
            {[
              {
                title: "垂直起降",
                code: "01 / 垂直起降",
                phase: 2,
                fold: 1,
                detail: "整翼收拢 · 升力向上",
              },
              {
                title: "整翼转换",
                code: "02 / 整翼转换",
                phase: 3,
                fold: 0.5,
                detail: "倾斜铰链 · 连续转动",
              },
              {
                title: "固定翼巡航",
                code: "03 / 固定翼巡航",
                phase: 4,
                fold: 0,
                detail: "翼面展开 · 推力向前",
              },
            ].map((v) => (
              <button
                key={v.code}
                className={`variant-card ${(v.phase === 0 ? unfold <= 0.02 : v.phase === 3 ? unfold > 0.02 && unfold < 0.98 : unfold >= 0.98) ? "selected" : ""}`}
                aria-label={`查看${v.title}形态`}
                onClick={() => {
                  leaveTilt();
                  setTime(phaseStart(v.phase) + (v.phase === 3 ? 4.5 : 0));
                  setInspection(true);
                  setPlaying(false);
                  setExploded(false);
                }}
              >
                <div className="card-top">
                  <span>{v.code}</span>
                  <span>形态研究 ↗</span>
                </div>
                <Silhouette fold={v.fold} />
                <div className="card-title">
                  <h3>{v.title}</h3>
                  <ArrowUpRight size={20} />
                </div>
                <div className="card-meta">
                  <span>{v.detail}</span>
                  <span>TRANSWING P4</span>
                </div>
              </button>
            ))}
          </div>
          <div className="variant-description">
            <span className="description-index">
              0{variants.findIndex((v) => v.id === variant) + 1} /
            </span>
            <p>{model.description}</p>
            <span>四旋翼 · 整翼折叠 · 复合飞行</span>
          </div>
          <div className="spec-strip" aria-label="P4 厂商公开参数">
            <div className="spec-context">
              P4 公开参数<small>厂商 2025 资料 · 非动画测量</small>
            </div>
            {[
              { value: "41", unit: "kg", label: "最大起飞重量" },
              { value: "6.8", unit: "kg", label: "有效载荷" },
              { value: "31", unit: "m/s", label: "巡航速度" },
              { value: "70", unit: "min", label: "续航时间" },
            ].map((s) => (
              <div className="spec" key={s.label}>
                <strong>
                  {s.value}
                  <small>{s.unit}</small>
                </strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer>
        <span>
          TRANSWING <b>飞行研究室</b>{" "}
          <span className="footer-separator">/</span> 独立交互概念研究
        </span>
        <button onClick={() => setShowInfo(true)}>
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
      {showInfo && (
        <div className="modal-backdrop" onClick={() => setShowInfo(false)}>
          <section
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label="关闭研究说明"
              onClick={() => setShowInfo(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">设计研究 / 原理与资料</span>
            <h2 id="info-title">
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
              本作品仅展示一版依据公开资料重建的 P4 参考构型，并非 Pterodynamics
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
          </section>
        </div>
      )}
    </div>
  );
}
