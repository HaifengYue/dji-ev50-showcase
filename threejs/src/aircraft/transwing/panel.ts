import type { ExperienceAction, ExperienceState } from './core/experience';
import { displayedUnfold } from './core/experience';
import type { StatePatch, SimulationRuntime } from './core/simulation';
import type { SimulationBridge } from './core/simulationBridge';
import { readPythonExample, type RecordingLoader } from './core/recordingLoader';
import { MOTOR_IDS, type MotorStage } from './core/motors';
import { SURFACE_IDS, type SurfaceId } from './core/surfaces';
import { DETAIL_VIEWS } from './core/details';
import { INSPECTION_VIEWS } from './core/inspection';
import { WORLD_FLIGHT_PHASES, worldFlightPhase } from './worldFlight';
import { DEMO_DURATION, TRANSWING_DEMO_PROFILE } from './demoProfile';
import type { TiltAction } from './core/tilt';
import './panel.css';

/** The adapter owns state, the frame loop and all network/runtime lifetimes. */
export interface TranswingPanelAPI {
  runtime: SimulationRuntime;
  bridge: SimulationBridge;
  loader: RecordingLoader;
  assetUrl: (path: string) => string;
  getState: () => ExperienceState;
  dispatch: (action: ExperienceAction) => void;
  manual: (patch: StatePatch) => void;
  setWireframe: (enabled: boolean) => void;
  startFlightAt: (seconds: number) => void;
  getCameraView?: () => string;
  isUnifiedControl?: () => boolean;
  setInternalDrive: (enabled: boolean) => void;
  setAxes: (enabled: boolean) => void;
  setAutoRotate: (enabled: boolean) => void;
  setView?: (view: string) => void;
  resetLocal: () => void | Promise<void>;
  prepareExternal?: () => void;
  getViewSettings?: () => { internalDrive: boolean; axes: boolean };
}

const MOTOR_NAMES = { L_Front: '左前', R_Front: '右前', L_Rear: '左后', R_Rear: '右后' };
const SURFACE_NAMES: Record<SurfaceId, string> = {
  L_Inboard: '左翼内侧副翼',
  R_Inboard: '右翼内侧副翼',
  L_Outboard: '左翼外侧副翼',
  R_Outboard: '右翼外侧副翼',
  Tail_L: '左 V 尾舵面',
  Tail_R: '右 V 尾舵面',
};
const MOTOR_STAGES: Record<MotorStage, string> = {
  folded: '已收桨',
  unfolding: '正在展桨',
  accelerating: '正在升速',
  running: '运转',
  decelerating: '正在减速',
  indexing: '停桨寻位',
  folding: '正在收桨',
};

/** A scoped, framework-free inspector. update() is driven by the host frame loop. */
export function createTranswingPanel(
  element: HTMLElement,
  api: TranswingPanelAPI,
): {
  update(): void;
  dispose(): void;
} {
  const doc = element.ownerDocument;
  const listeners: Array<() => void> = [];
  const localControls: Array<HTMLButtonElement | HTMLInputElement | HTMLSelectElement> = [];
  let disposed = false;
  let generation = 0;
  let fileError = '';
  let resetting = false;
  let internalDrive = false;
  let axes = false;
  let lastPaint = -Infinity;

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
    const result = doc.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function text(target: HTMLElement, value: string) {
    if (target.textContent !== value) target.textContent = value;
  }
  function pressed(target: HTMLElement, value: boolean) {
    const valueString = String(value);
    if (target.getAttribute('aria-pressed') !== valueString)
      target.setAttribute('aria-pressed', valueString);
  }
  function value(target: HTMLInputElement | HTMLSelectElement, next: number | string) {
    if (target.value !== String(next)) target.value = String(next);
  }
  function on(target: EventTarget, event: string, handler: (event: Event) => void) {
    const listener = (event: Event) => {
      if (disposed) return;
      try {
        handler(event);
      } catch (error) {
        reportError(error);
      }
      paint();
    };
    target.addEventListener(event, listener);
    listeners.push(() => target.removeEventListener(event, listener));
  }
  function reportError(error: unknown) {
    if (!disposed) fileError = error instanceof Error ? error.message : '操作未完成，请重试';
  }
  function local(action: () => void) {
    const snapshot = api.runtime.getSnapshot();
    if (disposed || snapshot.disposed || snapshot.control !== 'local' || api.isUnifiedControl?.())
      return;
    generation++;
    fileError = '';
    action();
  }
  async function asynchronous(action: () => void | Promise<unknown>) {
    const request = ++generation;
    fileError = '';
    try {
      await action();
    } catch (error) {
      if (request === generation) reportError(error);
    } finally {
      if (!disposed && request === generation) paint();
    }
  }
  function button(parent: HTMLElement, label: string, action: () => void, isLocal = false) {
    const result = node('button', 'tw-button', label);
    result.type = 'button';
    result.setAttribute('aria-label', label);
    on(result, 'click', () => (isLocal ? local(action) : action()));
    parent.append(result);
    if (isLocal) localControls.push(result);
    return result;
  }
  function section(label: string, open = false) {
    const result = node('details', 'tw-section');
    result.open = open;
    result.append(node('summary', 'tw-summary', label));
    const body = node('div', 'tw-section-body');
    result.append(body);
    content.append(result);
    return body;
  }
  function row(parent: HTMLElement, label?: string) {
    const result = node('div', 'tw-row');
    if (label) {
      result.setAttribute('role', 'group');
      result.setAttribute('aria-label', label);
    }
    parent.append(result);
    return result;
  }
  function note(parent: HTMLElement, content: string) {
    const result = node('p', 'tw-note', content);
    parent.append(result);
    return result;
  }
  function check(
    parent: HTMLElement,
    label: string,
    action: (enabled: boolean) => void,
    isLocal = false,
  ) {
    const wrapper = node('label', 'tw-check');
    const input = node('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    wrapper.append(input, node('span', undefined, label));
    parent.append(wrapper);
    on(input, 'change', () =>
      isLocal ? local(() => action(input.checked)) : action(input.checked),
    );
    if (isLocal) localControls.push(input);
    return input;
  }
  function range(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    action: (amount: number) => void,
    isLocal = true,
  ) {
    const wrapper = node('label', 'tw-range');
    const heading = node('span', 'tw-range-heading');
    const output = node('span', 'tw-value');
    heading.append(node('span', undefined, label), output);
    const input = node('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    wrapper.append(heading, input);
    parent.append(wrapper);
    on(input, 'input', () =>
      isLocal ? local(() => action(Number(input.value))) : action(Number(input.value)),
    );
    if (isLocal) localControls.push(input);
    return { input, output };
  }
  function select(
    parent: HTMLElement,
    label: string,
    choices: ReadonlyArray<readonly [string, string]>,
    action: (selection: string) => void,
    isLocal = true,
  ) {
    const wrapper = node('label', 'tw-select');
    wrapper.append(node('span', undefined, label));
    const input = node('select');
    input.setAttribute('aria-label', label);
    choices.forEach(([optionValue, label]) => {
      const option = node('option', undefined, label);
      option.value = optionValue;
      input.append(option);
    });
    wrapper.append(input);
    parent.append(wrapper);
    on(input, 'change', () => (isLocal ? local(() => action(input.value)) : action(input.value)));
    if (isLocal) localControls.push(input);
    return input;
  }
  function tilt(action: TiltAction) {
    api.dispatch({ type: 'enter-tilt' });
    api.dispatch({ type: 'tilt', action });
  }
  function external() {
    if (api.isUnifiedControl?.())
      throw new Error('请先在统一控制台释放控制，再连接 Python 或导入 JSON');
    if (api.prepareExternal) api.prepareExternal();
    else {
      api.dispatch({ type: 'set', key: 'playing', value: false });
      api.dispatch({ type: 'tilt', action: { type: 'pause' } });
    }
  }
  function load(read: (signal: AbortSignal) => Promise<string>, autoplay = false) {
    if (api.isUnifiedControl?.()) throw new Error('请先在统一控制台释放控制，再导入 JSON');
    void asynchronous(() => api.loader.load(read, external, autoplay));
  }

  const root = node('section', 'tw-panel');
  root.setAttribute('aria-label', 'Transwing 原生控制台');
  const header = node('div', 'tw-header');
  const heading = node('div');
  heading.append(node('span', 'tw-eyebrow', 'TRANSWING'), node('h2', 'tw-title', '机构与仿真控制'));
  header.append(heading);
  const collapse = button(header, '收起控制台', () => {
    content.hidden = !content.hidden;
    collapse.setAttribute('aria-expanded', String(!content.hidden));
    text(collapse, content.hidden ? '展开' : '收起');
    collapse.setAttribute('aria-label', content.hidden ? '展开控制台' : '收起控制台');
  });
  collapse.setAttribute('aria-expanded', 'true');
  const status = node('p', 'tw-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const content = node('div', 'tw-content');
  const ownership = node('p', 'tw-owner');
  const clock = node('p', 'tw-clock');
  content.append(ownership, clock);
  root.append(header, status, content);
  element.append(root);

  const modes = row(content, '控制来源');
  const demo = button(modes, '连续飞行演示', () => api.dispatch({ type: 'play-flight' }), true);
  const manual = button(modes, '手动机构 / 四电机', () => api.manual({}), true);
  const localHint = note(content, '');

  const flight = section('连续飞行阶段');
  const phaseDescription = note(flight, '');
  const phaseRow = row(flight, '选择飞行阶段');
  phaseRow.classList.add('tw-phase-grid');
  const phaseButtons = WORLD_FLIGHT_PHASES.map((phase, index) => ({
    phase: phase.id,
    index,
    button: button(
      phaseRow,
      phase.label,
      () => {
        api.startFlightAt(phase.start);
      },
      true,
    ),
  }));
  note(
    flight,
    `复用共享水平航线与地形；演示 ${DEMO_DURATION} 秒，上升 ≤${TRANSWING_DEMO_PROFILE.climbMps} m/s、下降 ≤${TRANSWING_DEMO_PROFILE.descentMps} m/s（按仿真秒）。数值为演示配置，非厂家性能或物理飞控。`,
  );

  const mechanism = section('连续整翼倾转', true);
  const poses = row(mechanism, '整翼形态预设');
  const presets = (
    [
      ['垂直起降', 0],
      ['转换中点', 0.5],
      ['固定翼巡航', 1],
    ] as const
  ).map(([label, progress]) => ({
    progress,
    button: button(poses, label, () => tilt({ type: 'scrub', progress }), true),
  }));
  const unfold = range(mechanism, '整翼展开进度', 0, 100, 0.1, (amount) =>
    tilt({ type: 'scrub', progress: amount / 100 }),
  );
  const endpoints = node('div', 'tw-endpoints');
  endpoints.append(node('span', undefined, '0% · 折叠'), node('span', undefined, '100% · 展开'));
  mechanism.append(endpoints);
  const tiltActions = row(mechanism, '倾转播放控制');
  const extend = button(tiltActions, '连续展开', () => tilt({ type: 'begin', direction: 1 }), true);
  const fold = button(tiltActions, '连续收拢', () => tilt({ type: 'begin', direction: -1 }), true);
  const playTilt = button(
    tiltActions,
    '播放倾转',
    () => {
      const current = api.getState();
      const progress = displayedUnfold(current);
      if (current.tiltMode && current.tilt.playing)
        api.dispatch({ type: 'tilt', action: { type: 'pause' } });
      else
        tilt({
          type: 'begin',
          direction: progress >= 1 ? -1 : progress <= 0 ? 1 : current.tilt.direction,
        });
    },
    true,
  );
  const reverse = button(
    tiltActions,
    '立即反向',
    () => tilt({ type: 'begin', direction: api.getState().tilt.direction === 1 ? -1 : 1 }),
    true,
  );
  const repeat = check(
    mechanism,
    '往返循环',
    (enabled) => api.dispatch({ type: 'tilt', action: { type: 'repeat', enabled } }),
    true,
  );
  const speed = select(
    mechanism,
    '倾转速度',
    [
      ['0.25', '0.25×'],
      ['0.5', '0.5×'],
      ['1', '1× · 8 秒'],
      ['1.5', '1.5×'],
      ['2', '2×'],
    ],
    (selection) =>
      api.dispatch({ type: 'tilt', action: { type: 'rate', value: Number(selection) } }),
  );
  note(mechanism, '整翼倾转与电机启停独立。反向和拖动保留当前机构进度。');

  const views = section('视角与显示', true);
  const freeCamera = button(views, '恢复自由透视 / 重置镜头', () => {
    if (api.setView) {
      api.setView('free');
      return;
    }
    local(() => {
      api.setInternalDrive(false);
      api.dispatch({ type: 'close-detail' });
      api.dispatch({ type: 'set', key: 'jointSide', value: null });
      api.dispatch({ type: 'set', key: 'inspection', value: false });
      api.dispatch({ type: 'set', key: 'cameraView', value: 'perspective' });
      api.dispatch({ type: 'set', key: 'cameraReset', value: (current) => current + 1 });
    });
  });
  const cameraRow = row(views, '正交与整体视角');
  const cameraButtons = INSPECTION_VIEWS.map((view) => ({
    view: view.id,
    button: button(cameraRow, view.label, () => api.setView?.(view.id)),
  }));
  const jointRow = row(views, '倾转关节特写');
  const joints = (['L', 'R'] as const).map((side) => ({
    side,
    button: button(jointRow, `${side === 'L' ? '左' : '右'}关节特写`, () =>
      api.setView?.(`joint-${side.toLowerCase()}`),
    ),
  }));
  const wireframe = check(views, '线框显示', api.setWireframe, true);
  const exploded = check(
    views,
    '展开装配 / 爆炸视图',
    (enabled) => api.dispatch({ type: 'set', key: 'exploded', value: enabled }),
    true,
  );
  const drive = check(views, '内部驱动透视', (enabled) => {
    internalDrive = enabled;
    api.setInternalDrive(enabled);
  });
  const driveNote = note(
    views,
    '电机 / 减速箱 → 丝杠 → 滑架与横梁 → 左右连杆。内部布局为概念重建，非原厂 CAD。',
  );
  driveNote.hidden = true;
  const axis = check(views, '显示机构坐标轴', (enabled) => {
    axes = enabled;
    api.setAxes(enabled);
  });
  const rotate = check(views, '自动环绕观察', api.setAutoRotate);
  const flightViews = row(views, '航线镜头');
  const flightCameras = (
    [
      ['follow', '跟随'],
      ['wide', '航线远景'],
      ['fpv', '机头 FPV'],
      ['down', '腹部下视'],
    ] as const
  ).map(([view, label]) => ({
    view,
    button: button(flightViews, label, () => api.setView?.(view)),
  }));
  note(
    views,
    '自由观察不会跟随机体移动；跟随、远景、机头与下视需明确选择。地形、背景和光照使用主场景设置。',
  );

  const detail = section('部件细节与系统概念');
  const detailRow = row(detail, '部件细节镜头');
  const detailButtons = DETAIL_VIEWS.map((view) => ({
    view: view.id,
    button: button(
      detailRow,
      view.label,
      () => api.dispatch({ type: 'detail', view: view.id }),
      true,
    ),
  }));
  const detailDescription = note(
    detail,
    '选择部件查看固定细节机位。电机 / 电调是按需载入的独立概念模块。',
  );
  const closeDetail = button(
    detail,
    '退出细节检查',
    () => api.dispatch({ type: 'close-detail' }),
    true,
  );
  note(
    detail,
    '系统连接：直流输入 → 电调 → 三相输出 → 无刷电机 → 轴端。非真实线束走向或精确拆机。',
  );

  const surfaces = section('六片独立舵面与舱盖');
  const surfaceInputs = SURFACE_IDS.map((id) => ({
    id,
    ...range(surfaces, SURFACE_NAMES[id], -12, 12, 0.5, (amount) =>
      api.manual({ surfaces: { [id]: amount } }),
    ),
  }));
  const hatch = range(surfaces, '前货舱盖开启', 0, 55, 0.5, (amount) =>
    api.manual({ hatchDeg: amount }),
  );
  button(
    surfaces,
    '舵面回中 / 关闭舱盖',
    () =>
      api.manual({
        surfaces: { inboard: 0, outboard: 0, tail: 0 },
        hatchDeg: 0,
      }),
    true,
  );
  note(surfaces, '左右以机体自身为准。各舵面独立偏转，范围为模型示意行程，不代表实飞控制律。');

  const motors = section('四台独立电机');
  const motorHint = note(motors, '');
  button(motors, '启用手动四电机', () => api.manual({}), true);
  const motorGrid = node('div', 'tw-motor-grid');
  motors.append(motorGrid);
  const motorControls = MOTOR_IDS.map((id) => {
    const card = node('div', 'tw-motor-card');
    card.append(node('h3', 'tw-motor-title', `${MOTOR_NAMES[id]}电机`));
    const stage = node('span', 'tw-stage');
    card.append(stage);
    const enabled = check(
      card,
      `${MOTOR_NAMES[id]}电机启动`,
      (active) => {
        const command = api.runtime.getSnapshot().state.motors[id];
        api.manual({
          display: { exploded: false },
          motors: { [id]: { enabled: active, targetRpm: command.targetRpm || 1800 } },
        });
      },
      true,
    );
    const rpm = range(card, `${MOTOR_NAMES[id]}目标转速`, 0, 6000, 60, (targetRpm) =>
      api.manual({ display: { exploded: false }, motors: { [id]: { targetRpm } } }),
    );
    const actual = note(card, '');
    motorGrid.append(card);
    return { id, enabled, rpm, stage, actual };
  });
  note(motors, '启动：展开 → 升速。停机：减速 → 正向寻位 → 收桨。RPM 是仿真值，非实测动力学。');

  const simulation = section('Python 接入与 JSON 回放');
  const connectionRow = row(simulation, 'Python 连接与控制权');
  const connect = button(connectionRow, '连接本机 Python 桥', () => {
    if (api.isUnifiedControl?.()) throw new Error('请先在统一控制台释放控制，再连接 Python');
    if (api.runtime.getSnapshot().control !== 'local') return;
    api.loader.cancel();
    external();
    void asynchronous(() => api.bridge.connect());
  });
  const release = button(connectionRow, '退出外控 / 复位', () => {
    api.loader.cancel();
    resetting = true;
    void asynchronous(async () => {
      try {
        await api.resetLocal();
      } finally {
        resetting = false;
      }
    });
  });
  const importRow = row(simulation, '离线记录导入');
  const example = button(importRow, '播放公开 Python 示例', () =>
    load(
      (signal) =>
        readPythonExample(
          signal,
          window.fetch.bind(window),
          api.assetUrl('transwing/examples/python-full-flow.json'),
        ),
      true,
    ),
  );
  const fileLabel = node('label', 'tw-file');
  fileLabel.append(node('span', undefined, '导入 JSON 回放'));
  const file = node('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.setAttribute('aria-label', '导入仿真 JSON 记录');
  fileLabel.append(file);
  importRow.append(fileLabel);
  on(file, 'change', () => {
    const recording = file.files?.[0];
    file.value = '';
    if (!recording) return;
    load(async (signal) => {
      if (recording.size > 1024 * 1024) throw new Error('记录最大为 1 MiB');
      const result = await recording.text();
      if (signal.aborted) throw new DOMException('已取消导入', 'AbortError');
      return result;
    });
  });
  const importStatus = note(simulation, '');
  importStatus.setAttribute('role', 'status');
  const cancelImport = button(simulation, '取消记录加载', () => {
    generation++;
    api.loader.cancel();
    fileError = '';
  });
  const error = node('p', 'tw-error');
  error.setAttribute('role', 'alert');
  simulation.append(error);
  const replay = node('div', 'tw-replay');
  simulation.append(replay);
  const replayActions = row(replay, 'JSON 回放控制');
  const replayPlay = button(replayActions, '播放记录', () => {
    if (api.runtime.getSnapshot().control === 'replay')
      api.runtime.playReplay(!api.runtime.getSnapshot().replayPlaying);
  });
  const replayRate = select(
    replayActions,
    '回放速度',
    [
      ['1', '1×'],
      ['0.1', '0.1× 慢放检视'],
    ],
    (selection) => api.runtime.setReplayRate(selection === '0.1' ? 0.1 : 1),
    false,
  );
  const replayFrame = range(
    replay,
    '记录逐帧定位',
    0,
    0,
    1,
    (frame) => {
      if (api.runtime.getSnapshot().control === 'replay') api.runtime.replayAt(frame);
    },
    false,
  );
  const shutter = check(simulation, '高速快门扫掠（防混叠）', (enabled) =>
    api.runtime.setRotorShutter(enabled),
  );
  const shutterNote = note(simulation, '');
  note(
    simulation,
    '实时连接仅允许本机页面的同源 Python 桥。远程静态网站不会探测你电脑的端口；可在这里导入 JSON 或播放离线示例。',
  );
  note(
    simulation,
    '本机启动：在仓库根目录运行 python models/transwing/python/run_server.py，再打开终端显示的地址。右手坐标：+X 向右、+Y 向上、+Z 机头；四元数为 x,y,z,w。',
  );

  const properties = section('飞行器属性与研究说明');
  properties.setAttribute('aria-label', '飞行器属性与研究说明');
  const referenceTitle = node('h3', 'tw-properties-title', 'TRANSWING P4 · 参考重建');
  properties.append(referenceTitle);
  note(
    properties,
    '依据蓝白 P4 实拍、视频及公开手册重建六个舵面、分体前货舱盖、左尾尖空速静压探头与动力舱外形。电机与电调以独立概念模块说明。',
  );
  const metrics = node('dl', 'tw-property-grid');
  for (const [label, metric] of [
    ['最大起飞重量', '41 kg'],
    ['有效载荷', '6.8 kg'],
    ['巡航速度', '31 m/s'],
    ['续航时间', '70 min'],
  ]) {
    const item = node('div');
    item.append(node('dt', undefined, label), node('dd', undefined, metric));
    metrics.append(item);
  }
  properties.append(metrics);
  note(
    properties,
    '以上为原版研究页面引用的厂商 2025 年公开资料，仅供参考，并非动画测量或模型仿真输出。',
  );
  note(
    properties,
    '整翼绕倾斜铰链转换，四个动力单元随左右整翼转动；固定长度连杆连接移动滑架与翼面偏轴接头。',
  );
  note(
    properties,
    '模型为独立视觉重建，并非 Pterodynamics 官方数字模型。滑架行程、内部传动、模型 120° 转角、旋翼停止时序与折桨均为理想化演示，非厂商内部 CAD 或真实飞控逻辑。',
  );
  note(
    properties,
    '动画展示外侧桨收起的双桨巡航；原研究说明也引用四台电机共同工作用于加速和爬升的模式，双桨巡航并非唯一实际工况。',
  );
  note(
    properties,
    '六舵面使用柔性铰接位置下的刚体偏转近似。±12° 舵面与 0–55° 舱盖范围仅用于模型检视；位置单位为约定米。',
  );
  const qualification = note(
    properties,
    '非官方产品 · 非工程仿真。本视景不构成性能验证或适航认证依据。内部布局、行程、转速和轨迹均有概念约定。',
  );
  qualification.classList.add('tw-qualification');
  const source = node('a', 'tw-source-link', '厂商 2025 年公开规格资料 ↗');
  source.href = 'https://pterodynamics.com/media/PD_TranswingSpecs_2025.pdf';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  properties.append(source);

  // Stable hooks are scoped to this mount, so browser tests do not depend on translated labels.
  const testId = (target: HTMLElement, name: string) =>
    target.setAttribute('data-testid', `tw-${name}`);
  const hooks: Array<[HTMLElement, string]> = [
    [root, 'panel'],
    [collapse, 'panel-collapse'],
    [status, 'status'],
    [ownership, 'owner'],
    [clock, 'clock'],
    [demo, 'control-demo'],
    [manual, 'control-manual'],
    [unfold.input, 'tilt-progress'],
    [extend, 'tilt-extend'],
    [fold, 'tilt-fold'],
    [playTilt, 'tilt-play'],
    [reverse, 'tilt-reverse'],
    [repeat, 'tilt-repeat'],
    [speed, 'tilt-rate'],
    [wireframe, 'wireframe'],
    [exploded, 'exploded'],
    [drive, 'internal-drive'],
    [axis, 'axes'],
    [rotate, 'auto-rotate'],
    [closeDetail, 'detail-close'],
    [freeCamera, 'camera-free'],
    [properties, 'properties'],
    [hatch.input, 'hatch'],
    [connect, 'bridge-connect'],
    [release, 'bridge-release'],
    [file, 'import-json'],
    [example, 'example-python'],
    [cancelImport, 'import-cancel'],
    [error, 'error'],
    [replayPlay, 'replay-play'],
    [replayRate, 'replay-rate'],
    [replayFrame.input, 'replay-frame'],
    [shutter, 'shutter'],
  ];
  hooks.forEach(([target, name]) => testId(target, name));
  flightCameras.forEach((item) => testId(item.button, `camera-${item.view}`));
  phaseButtons.forEach((item) => testId(item.button, `flight-phase-${item.phase}`));
  presets.forEach((item) => testId(item.button, `tilt-preset-${item.progress * 100}`));
  cameraButtons.forEach((item) => testId(item.button, `camera-${item.view}`));
  joints.forEach((item) => testId(item.button, `joint-${item.side}`));
  detailButtons.forEach((item) => testId(item.button, `detail-${item.view}`));
  surfaceInputs.forEach((item) => testId(item.input, `surface-${item.id}`));
  motorControls.forEach((item) => {
    testId(item.enabled, `motor-${item.id}-enabled`);
    testId(item.rpm.input, `motor-${item.id}-rpm`);
  });

  function paint() {
    if (disposed) return;
    const snapshot = api.runtime.getSnapshot();
    const state = api.getState();
    const isLocal = snapshot.control === 'local' && !snapshot.disposed && !api.isUnifiedControl?.();
    const isManual = isLocal && snapshot.driver === 'manual';
    const progress = snapshot.state.wingTilt;
    const settings = api.getViewSettings?.();
    if (settings) {
      internalDrive = settings.internalDrive;
      axes = settings.axes;
    }
    text(
      status,
      `${snapshot.ready ? '模型已就绪' : '模型载入中'} · ${
        snapshot.control === 'replay'
          ? 'JSON 离线回放'
          : snapshot.connection === 'connecting'
            ? '正在连接同源桥'
            : snapshot.state.owner === 'external'
              ? api.isUnifiedControl?.()
                ? '统一外部控制'
                : 'Python 独占控制'
              : snapshot.connection === 'connected'
                ? '同源桥就绪，等待 Python'
                : api.isUnifiedControl?.()
                  ? '统一接口 · 本地时钟'
                  : '本地操作'
      }`,
    );
    text(
      ownership,
      isLocal
        ? `控制权：本地 · ${isManual ? '手动机构 / 四电机' : '连续飞行演示'}`
        : snapshot.control === 'replay'
          ? '控制权：JSON 回放 · 退出并复位后可恢复本地操作'
          : api.isUnifiedControl?.()
            ? snapshot.control === 'external'
              ? '控制权：统一外部控制 · 本地动作已锁定，镜头仍可查看'
              : '控制权：统一接口 · 本地时钟，镜头仍可查看'
            : '控制权：Python · 本地动作已锁定，镜头显示仍可查看',
    );
    text(clock, `仿真时间 ${snapshot.state.time.seconds.toFixed(2)} 秒`);
    text(
      localHint,
      isLocal ? '拖动旋转，滚轮缩放，右键或双指平移。' : '“退出外控 / 复位”会释放控制并安全复位。',
    );
    localControls.forEach((control) => {
      control.disabled = !isLocal;
    });
    const currentPhase = worldFlightPhase(state.time);
    phaseButtons.forEach((item) =>
      pressed(
        item.button,
        isLocal && snapshot.driver === 'demo' && !state.tiltMode && currentPhase.id === item.phase,
      ),
    );
    text(phaseDescription, `${currentPhase.label} · ${currentPhase.detail}`);
    pressed(
      freeCamera,
      (api.getCameraView?.() ?? 'free') === 'free' &&
        !state.inspection &&
        !state.detailView &&
        !state.jointSide,
    );
    flightCameras.forEach((item) => pressed(item.button, api.getCameraView?.() === item.view));
    freeCamera.disabled = !isLocal && !api.setView;
    pressed(demo, isLocal && snapshot.driver === 'demo');
    pressed(manual, isManual);
    text(demo, state.playing && isLocal ? '暂停飞行演示' : '连续飞行演示');
    demo.setAttribute('aria-label', state.playing && isLocal ? '暂停飞行演示' : '连续飞行演示');
    presets.forEach((preset) =>
      pressed(preset.button, Math.abs(progress - preset.progress) < 0.001),
    );
    value(unfold.input, Math.round(progress * 1000) / 10);
    text(unfold.output, `${Math.round(progress * 100)}%`);
    unfold.input.setAttribute('aria-valuetext', `${Math.round(progress * 100)}% 展开`);
    extend.disabled = !isLocal || progress >= 1;
    fold.disabled = !isLocal || progress <= 0;
    const tiltPlaying = isLocal && state.tiltMode && state.tilt.playing;
    text(playTilt, tiltPlaying ? '暂停倾转' : '播放倾转');
    playTilt.setAttribute('aria-label', tiltPlaying ? '暂停倾转' : '播放倾转');
    repeat.checked = state.tilt.repeat;
    value(speed, state.tilt.rate);
    cameraButtons.forEach((item) =>
      pressed(
        item.button,
        state.inspection && !state.jointSide && !state.detailView && state.cameraView === item.view,
      ),
    );
    joints.forEach((item) => pressed(item.button, state.jointSide === item.side));
    wireframe.checked = snapshot.state.display.wireframe;
    exploded.checked = snapshot.state.display.exploded;
    drive.checked = internalDrive;
    driveNote.hidden = !internalDrive;
    axis.checked = axes;
    rotate.checked = state.autoRotate;
    detailButtons.forEach((item) => pressed(item.button, state.detailView === item.view));
    const selected = DETAIL_VIEWS.find((item) => item.id === state.detailView);
    text(
      detailDescription,
      selected?.description ?? '选择部件查看固定细节机位。电机 / 电调是按需载入的独立概念模块。',
    );
    closeDetail.hidden = !state.detailView;
    surfaceInputs.forEach((item) => {
      const degrees = snapshot.state.surfaces[item.id];
      value(item.input, degrees);
      text(item.output, `${degrees.toFixed(1)}°`);
    });
    value(hatch.input, snapshot.state.hatchDeg);
    text(hatch.output, `${snapshot.state.hatchDeg.toFixed(1)}°`);
    text(
      motorHint,
      isManual ? '手动控制已启用，四台电机分别控制。' : '只读监看。先选择“启用手动四电机”再调整。',
    );
    motorControls.forEach((item) => {
      const command = snapshot.state.motors[item.id];
      const motor = snapshot.actuators[item.id];
      item.enabled.disabled = !isManual;
      item.rpm.input.disabled = !isManual;
      item.enabled.checked = command.enabled;
      value(item.rpm.input, Math.min(6000, command.targetRpm));
      text(item.rpm.output, `${Math.round(command.targetRpm)} RPM`);
      text(item.stage, MOTOR_STAGES[motor.stage]);
      text(
        item.actual,
        `仿真 ${Math.round(motor.rpm)} RPM · 收桨 ${Math.round(motor.fold * 100)}%`,
      );
    });
    connect.disabled =
      !isLocal ||
      snapshot.connection === 'connecting' ||
      snapshot.connection === 'connected' ||
      resetting;
    release.disabled = resetting || !!api.isUnifiedControl?.();
    example.disabled = !!api.isUnifiedControl?.();
    file.disabled = !!api.isUnifiedControl?.();
    connect.disabled ||= !!api.isUnifiedControl?.();
    text(release, resetting ? '正在释放控制…' : '退出外控 / 复位');
    text(importStatus, api.loader.loading ? '正在验证记录，完成前保留当前画面…' : '');
    importStatus.hidden = !api.loader.loading;
    cancelImport.hidden = !api.loader.loading;
    const notice = fileError || snapshot.error || '';
    text(error, notice);
    error.hidden = !notice;
    replay.hidden = snapshot.control !== 'replay';
    text(replayPlay, snapshot.replayPlaying ? '暂停记录' : '播放记录');
    replayPlay.setAttribute('aria-label', snapshot.replayPlaying ? '暂停记录' : '播放记录');
    value(replayRate, snapshot.replayRate);
    replayFrame.input.max = String(Math.max(0, snapshot.replayCount - 1));
    replayFrame.input.disabled = snapshot.replayCount < 2;
    value(replayFrame.input, snapshot.replayIndex);
    text(replayFrame.output, `${snapshot.replayIndex + 1} / ${snapshot.replayCount} 帧`);
    shutter.checked = snapshot.rotorShutter;
    text(
      shutterNote,
      snapshot.rotorShutter
        ? '连续扫掠表示高速旋桨；取消可检查真实瞬时相位。'
        : '真实瞬时相位可能因画面采样显得停转或倒转。',
    );
  }
  on(root, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && api.loader.loading) {
      generation++;
      api.loader.cancel();
      fileError = '';
    }
  });
  const cancelPending = () => {
    generation++;
    api.loader.cancel();
  };
  if (doc.defaultView) {
    on(doc.defaultView, 'pagehide', cancelPending);
    on(doc.defaultView, 'popstate', cancelPending);
  }
  paint();
  return {
    update() {
      const now = performance.now();
      if (now - lastPaint < 80) return;
      lastPaint = now;
      paint();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      api.loader.cancel();
      listeners.splice(0).forEach((remove) => remove());
      root.remove();
    },
  };
}
