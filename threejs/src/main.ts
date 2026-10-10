import * as T from 'three';
import { UnifiedControlGateway } from './control/gateway';
import { LocalHttpBridge } from './control/localHttpBridge';
import { controlPanel } from './control/panel';
import { Ev50ExternalControl } from './aircraft/ev50Control';
import type {
  AircraftControlCapabilities,
  AircraftControlCommand,
  AdapterAircraftState,
} from './control/contracts';
import { AIRCRAFT, aircraftDescriptor, aircraftFromUrl, isAircraftId } from './aircraft/registry';
import { normalizeAircraftId } from './aircraft/identity';
import { createAircraftSelection } from './aircraft/selection';
import { disposeObjectTree } from './aircraft/resources';
import { playbackPresentation } from './aircraft/playbackPresentation';
import type { AircraftId, AircraftInstance, AircraftQuality } from './aircraft/types';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { routeMap } from './route-map';
import { obstacleCeiling } from './terrain';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FlightController, labels, Frame, routes, FlightCommand } from './flight';
import { environment } from './environment';
import {
  LANDSCAPE_STORAGE_KEY,
  isLandscapePreset,
  readLandscapePreset,
  rememberLandscapePreset,
  landscapeUrl,
  type LandscapePreset,
} from './landscape-settings';
import { FlightTrail } from './flight-trail';
import './style.css';
import {
  API_VERSION,
  ApiSettings,
  CameraMode,
  FlightControlCommand,
  RenderQuality,
} from './api/contracts';
import { Ev50ApiGateway } from './api/gateway';
import { installBrowserApi } from './api/browser-api';
import { startHttpBridge } from './api/http-bridge';
import { presentation } from './presentation';
import { SCENE_APPEARANCE } from './scene-appearance';
import {
  aircraftRig,
  CAMERA_MOUNTS,
  describeCamera,
  placeSensorCamera,
} from './simulation/aircraft-rig';
import { sceneDetails } from './simulation/scene-details';
import { SimulationSource, VisualSession } from './simulation/session';
import { simulationPanel } from './simulation/panel';
import { ROTOR_NAMES, Surfaces } from './simulation/telemetry';
const $ = <E extends HTMLElement>(s: string) => document.querySelector<E>(s)!;
const canvas = $<HTMLCanvasElement>('#scene');
let unifiedGateway: UnifiedControlGateway | undefined;
let unifiedBridge: LocalHttpBridge | undefined;
let unifiedPanel: ReturnType<typeof controlPanel> | undefined;
const ev50External = new Ev50ExternalControl();
let selectedId: AircraftId = aircraftFromUrl(new URL(location.href));
let selectionRevision = 0;
let historyRestores = 0;
let frameNumber = 0;
let renderedSelectionRevision = -1;
let renderedAircraft: AircraftId | null = null;
const assetUrl = (path: string) => new URL(path, document.baseURI).href;
const renderer = new T.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = SCENE_APPEARANCE.product.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(SCENE_APPEARANCE.product.background);
const camera = new T.PerspectiveCamera(42, 1, 0.1, 9000);
camera.position.set(8, 3.6, 10);
const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;
let activeCamera: T.Camera = camera;
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const setActiveCamera = (next: T.Camera) => {
  activeCamera = next;
  renderPass.camera = next;
};
const bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.12, 0.35, 1.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let postEnabled = true;
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.65, 0);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 5200;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();
const hemisphere = new T.HemisphereLight(0xd6e9ff, 0x58624a, 1.3);
scene.add(hemisphere);
const sun = new T.DirectionalLight(0xffefd4, 2.4);
sun.position.set(-35, 65, 25);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 150 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment(),
  envmap = pmrem.fromScene(room, 0.025);
scene.environment = envmap.texture;
scene.environmentIntensity = SCENE_APPEARANCE.product.environmentIntensity;
room.dispose();
pmrem.dispose();
const terrain = environment(scene),
  aircraft = new T.Group();
let landscapePreset = readLandscapePreset(new URL(location.href), () =>
  localStorage.getItem(LANDSCAPE_STORAGE_KEY),
);
terrain.setLandscape(landscapePreset);
aircraft.name = 'Flight_Pose';
scene.add(aircraft);
let flight: FlightController,
  ready = false,
  cameraMode: CameraMode = 'free',
  showLabels = false;
let sharedSceneMode: 'product' | 'flight' = 'product';
let assetVersion = 'EV50';
const site = sceneDetails(terrain.group, { externalTrail: true });
let flightTrail = new FlightTrail(scene, { surfaceHeight: terrain.surfaceHeight });
let trailGeneration = 0;
function clearFlightTrail(reason = 'source-change') {
  site.clearTrail();
  flightTrail.reset(reason);
  trailGeneration++;
}
const landscapeSelect = $<HTMLSelectElement>('#landscape');
landscapeSelect.value = landscapePreset;
function selectLandscape(next: LandscapePreset, persist = false) {
  if (next !== landscapePreset) {
    terrain.setLandscape(next);
    landscapePreset = next;
    // A new visual surface invalidates the old ribbon, never the flight pose.
    clearFlightTrail('landscape');
  }
  landscapeSelect.value = landscapePreset;
  if (persist) {
    rememberLandscapePreset(next, (value) => localStorage.setItem(LANDSCAPE_STORAGE_KEY, value));
    const url = landscapeUrl(new URL(location.href), next);
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  }
}
landscapeSelect.onchange = () => {
  if (isLandscapePreset(landscapeSelect.value)) selectLandscape(landscapeSelect.value, true);
  else landscapeSelect.value = landscapePreset;
};
let rig: ReturnType<typeof aircraftRig> | undefined;
const visual = {
  position: new T.Vector3(),
  quaternion: new T.Quaternion(),
  speedMps: 0,
  lift: 0,
  cruise: 0,
  time: 0,
};
const simulation = new VisualSession(sourceChanged);
const rotorAngles = new Map<string, number>();
const presentationView = presentation({
  canvas,
  camera,
  controls,
  scene,
  sun,
  hemisphere,
  setSky: terrain.setSky,
  aircraftName: () => aircraftDescriptor(selectedId).name,
  showProduct: () => {
    if (!ready) return;
    if (flight.mode !== 'product') setMode('product');
    cameraMode = 'free';
    controls.enabled = true;
    $<HTMLSelectElement>('#camera').value = 'free';
  },
});
type Rotor = {
  pivot: T.Object3D;
  base: T.Quaternion;
  parts: T.Material[];
  disc: T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
  lift: boolean;
  sign: number;
};
const rotors: Rotor[] = [],
  axis = new T.Vector3(0, 1, 0),
  spin = new T.Quaternion();
const labelData = [
  { name: '宽体货舱', pos: new T.Vector3(0, 0.75, 1.15) },
  { name: '8 旋翼 · 共轴升力', pos: new T.Vector3(-1.24, 1, 0.94) },
  { name: '7 m 复材主翼', pos: new T.Vector3(2.7, 0.96, 0) },
  { name: '巡航尾推', pos: new T.Vector3(0, 0.92, -1.8) },
];
const routeSelect = document.createElement('select');
routeSelect.id = 'route';
routeSelect.setAttribute('aria-label', '飞行航线');
for (const [id, r] of Object.entries(routes)) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = r.name;
  routeSelect.append(o);
}
const routeLabel = document.createElement('label');
routeLabel.className = 'field';
routeLabel.textContent = '飞行航线';
routeLabel.prepend(routeSelect);
$('.right-tools')?.prepend(routeLabel);
const mapWrap = document.createElement('div');
mapWrap.className = 'route-map';
mapWrap.innerHTML =
  '<span>航线 / 完成度 <b id="route-progress">0%</b></span><canvas width="180" height="92" aria-label="飞行航线缩略图"></canvas>';
$('.right-tools')?.append(mapWrap);
let missionPath: T.Vector3[] | null = null;
const mapCanvas = mapWrap.querySelector('canvas')!,
  missionMap = routeMap(mapCanvas);
for (const d of labelData) {
  const el = document.createElement('div');
  el.className = 'part-label';
  el.textContent = d.name;
  el.hidden = true;
  $('#labels').append(el);
}
const labelEls = Array.from(document.querySelectorAll<HTMLDivElement>('.part-label'));
async function loadEv50(signal: AbortSignal): Promise<AircraftInstance> {
  const generation = selectionRevision;
  const [bytes, data] = await Promise.all([
    fetch(assetUrl('ev50.glb'), { signal }).then((response) => {
      if (!response.ok) throw new Error(`EV50 模型读取失败 (${response.status})`);
      return response.arrayBuffer();
    }),
    fetch(new URL('flight.json', document.baseURI), { signal }).then((response) => {
      if (!response.ok) throw new Error('飞行数据读取失败');
      return response.json();
    }),
  ]);
  const gltf = await new GLTFLoader().parseAsync(bytes, new URL('.', document.baseURI).href);
  if (signal.aborted || generation !== selectionRevision) {
    disposeObjectTree(gltf.scene);
    throw new DOMException('Aircraft selection changed', 'AbortError');
  }
  const originalMaterials = new Set<T.Material>();
  try {
    gltf.scene.traverse((object) => {
      if (object instanceof T.Mesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          originalMaterials.add(material);
      }
    });
    aircraft.add(gltf.scene);
    flight = new FlightController(data.frames as Frame[]);
    const pivots: T.Object3D[] = [];
    gltf.scene.traverse((o) => {
      if (o.userData.visual_asset_name) assetVersion = String(o.userData.visual_asset_name);
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      if (o.name.startsWith('LiftRotor_') || o.name.startsWith('CruiseRotor_')) pivots.push(o);
    });
    for (const o of pivots) {
      const isLift = o.name.startsWith('Lift'),
        mats: T.Material[] = [];
      o.traverse((c) => {
        if (c instanceof T.Mesh && /Blade|Tip/.test(c.name)) {
          const copy = (m: T.Material) => {
            const n = m.clone();
            n.transparent = true;
            mats.push(n);
            return n;
          };
          c.material = Array.isArray(c.material) ? c.material.map(copy) : copy(c.material);
        }
      });
      const disc = new T.Mesh(
        new T.CircleGeometry(isLift ? 0.58 : 0.25, 64),
        new T.MeshBasicMaterial({
          color: 0x8d979b,
          transparent: true,
          opacity: 0,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.renderOrder = 2;
      o.add(disc);
      rotors.push({
        pivot: o,
        base: o.quaternion.clone(),
        parts: mats,
        disc,
        lift: isLift,
        sign: Number(o.userData.spin_sign) || 1,
      });
    }
    if (rotors.filter((r) => r.lift).length !== 8 || rotors.filter((r) => !r.lift).length !== 3)
      throw Error('动力部件数量校验失败');
    rig = aircraftRig(aircraft);
    const ownedChildren = [...aircraft.children];
    ready = true;
    flight.evaluate();
    missionMap.setPath(flight.getPath());
    $<HTMLInputElement>('#timeline').max = String(flight.duration);
    $('#loading').hidden = true;
    $('#load-status').textContent = `模型就绪 · ${assetVersion} / 连续视景`;
    document.body.dataset.ready = 'true';
    document.body.dataset.assetVersion = assetVersion;
    for (const el of document.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('button,input,select'))
      el.disabled = false;
    presentationView.setReady();
    $('#summary').textContent = '7.00 m 翼展 / 8 + 3 动力系统';
    let disposed = false;
    return {
      id: 'ev50',
      update() {},
      resize() {},
      setQuality() {},
      setMode,
      playPause: () => $('#play').click(),
      restart: () => $('#restart').click(),
      seek: (time) => flight.seek(time),
      setSpeed: (speed) => flight.setSpeed(speed),
      setLoop: (loop) => {
        flight.loop = loop;
      },
      setView: () => {},
      snapshot: () => ({
        ready,
        mode: flight.mode,
        playing: flight.playing,
        time: flight.time,
        duration: flight.duration,
        state: flight.state,
        label: labels[flight.state],
        speedMps: flight.speedMps,
        altitude: aircraft.position.y,
        lift: `${Math.round(flight.lift * 100)}%`,
        cruise: `${Math.round(flight.cruise * 100)}%`,
      }),
      describe: () => rig?.describe(),
      dispose() {
        if (disposed) return;
        disposed = true;
        const ownedRoot = new T.Group();
        ownedRoot.add(...ownedChildren);
        disposeObjectTree(ownedRoot, originalMaterials);
        if (generation === selectionRevision) {
          ready = false;
          rotors.length = 0;
          rig = undefined;
        }
      },
    };
  } catch (error) {
    const failedRoot = new T.Group();
    failedRoot.add(...aircraft.children);
    if (!gltf.scene.parent) failedRoot.add(gltf.scene);
    disposeObjectTree(failedRoot, originalMaterials);
    rotors.length = 0;
    rig = undefined;
    ready = false;
    throw error;
  }
}
/** The host alone owns the stage, lighting, fog and terrain for every airframe. */
function setSceneMode(mode: 'product' | 'flight') {
  if (sharedSceneMode !== mode) clearFlightTrail();
  sharedSceneMode = mode;
  terrain.group.visible = mode === 'flight';
  const appearance = SCENE_APPEARANCE[mode];
  const fog = SCENE_APPEARANCE.flight.fog;
  renderer.toneMappingExposure = appearance.exposure;
  scene.environmentIntensity = appearance.environmentIntensity;
  scene.background = new T.Color(
    mode === 'product' ? SCENE_APPEARANCE.product.background : fog.daylight,
  );
  scene.fog = mode === 'product' ? null : new T.Fog(fog.daylight, fog.near, fog.far);
}
function setMode(mode: 'product' | 'flight') {
  if (selectedId === 'skytrans') {
    const before = selection.current?.snapshot();
    if (!before || before.control !== 'local' || unifiedGateway?.getLease()) return;
    selection.current?.setMode(mode);
    if (mode === 'product') cameraSelect.value = 'free';
    else if (before.mode !== 'flight') cameraSelect.value = 'follow';
    return;
  }
  if (!ready) return;
  if (
    mode === 'flight' &&
    flight.mode === 'flight' &&
    flight.playing &&
    !flight.manual &&
    simulation.source === 'demo'
  )
    return;
  if (simulation.source !== 'demo') simulation.select('demo');
  clearFlightTrail();
  flight.mode = mode;
  flight.restart();
  mapWrap.hidden = mode === 'product';
  flight.playing = mode === 'flight';
  setSceneMode(mode);
  cameraMode = mode === 'flight' ? 'follow' : 'free';
  $<HTMLSelectElement>('#camera').value = cameraMode;
  controls.enabled = cameraMode === 'free';
  if (mode === 'product') {
    presentationView.resetProductView();
  }
  $('#product').classList.toggle('active', mode === 'product');
  $('#flight').classList.toggle('active', mode === 'flight');
  $('#mode-label').textContent = mode === 'product' ? 'PRODUCT STUDY' : 'FLIGHT DEMONSTRATION';
  $('#play').textContent = (flight.manual ? !flight.manualPaused : flight.playing)
    ? '暂停'
    : '播放';
  $('#timeline-wrap').classList.toggle('muted', mode === 'product');
}
function sourceChanged(source: SimulationSource) {
  if (!ready) return;
  clearFlightTrail();
  rotorAngles.clear();
  if (source === 'demo') {
    setMode('flight');
    return;
  }
  flight.pause();
  flight.mode = 'flight';
  setSceneMode('flight');
  mapWrap.hidden = true;
  if (cameraMode === 'free') cameraMode = 'follow';
  controls.enabled = false;
  $<HTMLSelectElement>('#camera').value = cameraMode;
  $('#product').classList.remove('active');
  $('#flight').classList.remove('active');
  $('#mode-label').textContent =
    source === 'external' ? 'TELEMETRY VISUALIZATION' : 'TELEMETRY REPLAY';
}
function leaveSimulation() {
  if (simulation.source !== 'demo') simulation.select('demo');
}
$('#product').onclick = () => {
  if (!unifiedGateway?.getLease()) setMode('product');
};
$('#flight').onclick = () => {
  if (!unifiedGateway?.getLease()) setMode('flight');
};
$('#play').onclick = () => {
  if (selectedId === 'skytrans') {
    selection.current?.playPause();
    return;
  }
  if (!ready) return;
  if (simulation.source !== 'demo') {
    if (simulation.source === 'replay' && simulation.replay.time >= simulation.replay.duration) {
      simulation.replay.seek(0);
      clearFlightTrail();
      simulation.pause(false);
    } else simulation.pause(!simulation.state().paused);
    return;
  }
  if (flight.mode === 'product') {
    setMode('flight');
    return;
  }
  if (flight.manual) {
    flight.manualPaused = !flight.manualPaused;
    return;
  }
  if (flight.time >= flight.duration) flight.restart();
  flight.playing = !flight.playing;
};
$('#restart').onclick = () => {
  clearFlightTrail('restart');
  if (selectedId === 'skytrans') {
    selection.current?.restart();
    return;
  }
  if (!ready) return;
  clearFlightTrail();
  if (simulation.source === 'replay') {
    simulation.replay.seek(0);
    simulation.pause(false);
  } else if (simulation.source === 'demo') flight.restart();
};
$<HTMLInputElement>('#loop').onchange = (e) => {
  if (selectedId === 'skytrans') {
    selection.current?.setLoop((e.target as HTMLInputElement).checked);
    return;
  }
  if (ready) flight.loop = (e.target as HTMLInputElement).checked;
};
$<HTMLInputElement>('#timeline').oninput = (e) => {
  clearFlightTrail('seek');
  if (selectedId === 'skytrans') {
    selection.current?.seek(Number((e.target as HTMLInputElement).value));
    return;
  }
  if (!ready) return;
  const t = Number((e.target as HTMLInputElement).value);
  clearFlightTrail();
  if (simulation.source === 'replay') {
    simulation.replay.seek(t);
    return;
  }
  if (simulation.source === 'external') return;
  if (flight.mode === 'product') setMode('flight');
  flight.seek(t);
};
$<HTMLSelectElement>('#camera').onchange = (e) => {
  if (selectedId === 'skytrans') {
    selection.current?.setView((e.target as HTMLSelectElement).value);
    return;
  }
  cameraMode = (e.target as HTMLSelectElement).value as CameraMode;
  controls.enabled = cameraMode === 'free';
  if (cameraMode === 'free' && ready) {
    controls.target.copy(visual.position);
    controls.target.y += 0.65;
    camera.position.copy(visual.position).add(new T.Vector3(8, 3.6, 10));
    controls.update();
  }
};
$<HTMLInputElement>('#annotations').onchange = (e) => {
  showLabels = (e.target as HTMLInputElement).checked;
};
routeSelect.onchange = () => {
  if (selectedId === 'skytrans') {
    selection.current?.setRoute?.(routeSelect.value as keyof typeof routes);
    return;
  }
  if (ready) {
    leaveSimulation();
    clearFlightTrail();
    flight.setRoute(routeSelect.value as keyof typeof routes);
    missionMap.setPath(flight.getPath());
  }
};
const requireReady = () => {
  if (!ready || selectedId !== 'ev50') throw new Error('EV50 is not selected or is still loading');
};
const subscribers = new Set<(state: ReturnType<typeof status>) => void>();
const status = () => {
  requireReady();
  if (simulation.source !== 'demo') {
    const s = simulation.state(),
      external = simulation.source === 'external',
      frame = simulation.frame;
    return {
      version: API_VERSION,
      control: external ? 'telemetry' : 'replay',
      time: external ? (frame?.time ?? null) : s.replay.time,
      duration: external ? null : s.replay.duration,
      route: null,
      progress: external ? null : s.replay.time / (s.replay.duration || 1),
      playing: !s.paused && !(external && (s.stale || s.waiting)),
      paused: s.paused,
      speed: 1,
      speedMps: frame ? Math.hypot(...frame.velocity) : 0,
      position: frame ? [...frame.position] : visual.position.toArray(),
      quaternion: frame ? [...frame.quaternion] : visual.quaternion.toArray(),
      lift: frame
        ? Math.min(1, frame.rotorRpm.slice(0, 8).reduce((a, b) => a + b, 0) / 8 / 1800)
        : 0,
      cruise: frame
        ? Math.min(1, frame.rotorRpm.slice(8).reduce((a, b) => a + b, 0) / 3 / 2400)
        : 0,
      state: external ? (s.waiting ? 'WAITING' : s.stale ? 'STALE' : 'TELEMETRY') : 'REPLAY',
    };
  }
  return {
    version: API_VERSION,
    control: flight.manual ? 'manual' : 'route',
    time: flight.time,
    duration: flight.duration,
    route: flight.route,
    progress: flight.routeProgress,
    playing: flight.playing,
    paused: flight.manual ? flight.manualPaused : !flight.playing,
    speed: flight.speed,
    speedMps: flight.speedMps,
    position: flight.position.toArray(),
    quaternion: flight.quaternion.toArray(),
    lift: flight.lift,
    cruise: flight.cruise,
    state: flight.manual ? 'MANUAL' : flight.state,
  };
};
const currentSettings = (): ApiSettings => ({
  loop: flight.loop,
  playbackSpeed: flight.speed,
  camera: cameraMode,
  quality: $<HTMLSelectElement>('#quality').value as RenderQuality,
  annotations: showLabels,
});
const apiGateway = new Ev50ApiGateway({
  get ready() {
    return ready && selectedId === 'ev50' && !unifiedGateway?.getLease();
  },
  visualRequest: (operation: string, payload: unknown) => {
    requireReady();
    if (operation === 'aircraft.describe') return rig!.describe();
    if (operation === 'camera.describe') return describeCamera(camera, canvas, cameraMode);
    if (operation === 'scene.describe') return site.describe();
    if (operation === 'scene.configure') return site.configure(payload);
    if (operation === 'scene.query') return site.query(payload);
    if (operation === 'simulation.replay.seek') clearFlightTrail();
    return simulation.request(operation, payload);
  },
  getState: status,
  getRoutes: () => Object.entries(routes).map(([id, route]) => ({ id, name: route.name })),
  command: (command: FlightControlCommand) => {
    requireReady();
    if (simulation.source !== 'demo')
      throw new Error('Visual telemetry owns the pose; select demo before using demo commands');
    const mode = flight.mode;
    flight.applyCommand(command as FlightCommand);
    if (mode === 'product') {
      setSceneMode('flight');
      mapWrap.hidden = false;
      cameraMode = 'follow';
      controls.enabled = false;
      $<HTMLSelectElement>('#camera').value = 'follow';
      $('#product').classList.remove('active');
      $('#flight').classList.add('active');
      $('#mode-label').textContent = 'EXTERNAL CONTROL';
    }
    return status();
  },
  play: () => {
    requireReady();
    leaveSimulation();
    flight.clearCommand();
    if (flight.mode !== 'flight') setMode('flight');
    flight.playing = true;
  },
  pause: () => {
    requireReady();
    if (simulation.source !== 'demo') simulation.pause(true);
    else flight.pause();
  },
  resume: () => {
    requireReady();
    if (simulation.source !== 'demo') simulation.pause(false);
    else if (flight.manual) flight.manualPaused = false;
    else flight.playing = true;
  },
  reset: () => {
    requireReady();
    leaveSimulation();
    clearFlightTrail();
    flight.pause();
    flight.restart();
  },
  seek: (seconds: number) => {
    requireReady();
    if (simulation.source !== 'demo') throw new Error('Use simulation.replay.seek for recordings');
    if (seconds < 0 || seconds > flight.duration) throw new Error('Invalid time');
    clearFlightTrail();
    flight.clearCommand();
    flight.seek(seconds);
  },
  setSpeed: (speed: number) => {
    requireReady();
    flight.setSpeed(speed);
    $<HTMLSelectElement>('#playback-speed').value = String(speed);
  },
  setRoute: (route: string) => {
    requireReady();
    if (!Object.hasOwn(routes, route)) throw new Error('Unknown route');
    leaveSimulation();
    clearFlightTrail();
    routeSelect.value = route;
    flight.setRoute(route as keyof typeof routes);
    missionMap.setPath(flight.getPath());
  },
  getSettings: currentSettings,
  updateSettings: (settings: Partial<ApiSettings>) => {
    requireReady();
    if (settings.loop !== undefined && typeof settings.loop !== 'boolean')
      throw new Error('loop must be boolean');
    if (
      settings.playbackSpeed !== undefined &&
      (!Number.isFinite(settings.playbackSpeed) ||
        settings.playbackSpeed < 0.25 ||
        settings.playbackSpeed > 4)
    )
      throw new Error('playbackSpeed must be within [0.25, 4]');
    if (
      settings.camera !== undefined &&
      !['free', 'ground', 'follow', 'side', 'wide', 'fpv', 'down'].includes(settings.camera)
    )
      throw new Error('Unknown camera');
    if (settings.quality !== undefined && !['Low', 'Medium', 'High'].includes(settings.quality))
      throw new Error('Unknown quality');
    if (settings.annotations !== undefined && typeof settings.annotations !== 'boolean')
      throw new Error('annotations must be boolean');
    if (settings.loop !== undefined) {
      flight.loop = settings.loop;
      $<HTMLInputElement>('#loop').checked = settings.loop;
    }
    if (settings.playbackSpeed !== undefined) {
      flight.setSpeed(settings.playbackSpeed);
      $<HTMLSelectElement>('#playback-speed').value = String(settings.playbackSpeed);
    }
    if (settings.camera !== undefined) {
      cameraMode = settings.camera;
      controls.enabled = cameraMode === 'free';
      $<HTMLSelectElement>('#camera').value = cameraMode;
      if (cameraMode === 'free') {
        controls.target.copy(visual.position);
        controls.target.y += 0.65;
        camera.position.copy(visual.position).add(new T.Vector3(8, 3.6, 10));
        controls.update();
      }
    }
    if (settings.quality !== undefined) {
      $<HTMLSelectElement>('#quality').value = settings.quality;
      quality(settings.quality);
    }
    if (settings.annotations !== undefined) {
      showLabels = settings.annotations;
      $<HTMLInputElement>('#annotations').checked = settings.annotations;
    }
    return currentSettings();
  },
});
const api = installBrowserApi(apiGateway, (callback) => {
  if (typeof callback !== 'function') throw new Error('Expected callback');
  subscribers.add(callback);
  return () => subscribers.delete(callback);
});
Object.assign(window, { ev50API: api });
const scenePanelApi = {
  request(request: { operation: string; payload?: unknown }) {
    if (selectedId !== 'skytrans') return api.request(request);
    try {
      let data: unknown;
      if (request.operation === 'scene.configure') data = site.configure(request.payload);
      else if (request.operation === 'scene.describe') data = site.describe();
      else if (request.operation === 'scene.query') data = site.query(request.payload);
      else if (request.operation === 'aircraft.describe') data = selection.current?.describe();
      else if (request.operation === 'camera.describe')
        data = {
          type: activeCamera.type,
          position: activeCamera.position.toArray(),
          quaternion: activeCamera.quaternion.toArray(),
        };
      else if (request.operation === 'flight.state') data = selection.current?.worldState?.();
      else throw new Error('EV50 telemetry is unavailable for this aircraft');
      return { operation: request.operation, ok: true as const, data };
    } catch (error) {
      return {
        operation: request.operation,
        ok: false as const,
        error: { code: 'INVALID_REQUEST', message: String(error) },
      };
    }
  },
};
const simulationTools = simulationPanel(scenePanelApi, simulation, site.getSettings);
let stopHttpBridge: (() => void) | undefined;
let telemetryElapsed = 0;
$<HTMLSelectElement>('#playback-speed').onchange = (e) => {
  if (selectedId === 'skytrans') {
    selection.current?.setSpeed(Number((e.target as HTMLSelectElement).value));
    return;
  }
  if (ready) flight.setSpeed(Number((e.target as HTMLSelectElement).value));
};
function quality(q: string) {
  postEnabled = q === 'High';
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'Low' ? 1 : q === 'Medium' ? 1.5 : 2));
  renderer.shadowMap.enabled = q !== 'Low';
  const size = q === 'High' ? 4096 : 1024;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  terrain.setQuality(q);
  flightTrail.setQuality(q as RenderQuality);
  $('#quality-readout').textContent = q.toUpperCase();
  selection?.current?.setQuality(q as AircraftQuality);
  resize();
}
$<HTMLSelectElement>('#quality').onchange = (e) => quality((e.target as HTMLSelectElement).value);
function resize() {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  selection?.current?.resize();
  if (selectedId === 'ev50' && cameraMode === 'free' && (!ready || flight.mode === 'product'))
    presentationView.resizeProductView();
}
window.addEventListener('resize', resize);
document.addEventListener('keydown', (e) => {
  const target = e.target;
  if (
    e.code === 'Space' &&
    !(
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('button,input,select,textarea,a,summary'))
    )
  ) {
    e.preventDefault();
    $('#play').click();
  }
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  unifiedGateway?.disconnect();
  $('#loading').hidden = false;
  $('#loading').textContent = '图形设备连接中断，请刷新页面恢复。';
  selection.current?.setMode('product');
  if (ready) flight.playing = false;
});
mapWrap.hidden = true;
setSceneMode('product');
const initialQuality = innerWidth < 700 ? 'Low' : 'High';
$<HTMLSelectElement>('#quality').value = initialQuality;
// Apply initial quality after selection controller initialization below.
const clock = new T.Clock(),
  desired = new T.Vector3(),
  target = new T.Vector3(),
  v = new T.Vector3();
let projectionMode = '',
  panelElapsed = 0;
const neutralSurfaces: Surfaces = { aileron: 0, elevator: 0, rudder: 0 };
// ULog conversion maps normalized actuator magnitude to these visual maxima.
// Replays intentionally report throttle, not a claim about measured RPM.
const replayThrottle = (rpm: number, maximum: number) =>
  `${Math.round(T.MathUtils.clamp(rpm / maximum, 0, 1) * 100)}%`;
function animate() {
  unifiedBridge?.sync();
  unifiedGateway?.beforeFrame();
  const frameRevision = selectionRevision;
  const frameAircraft = selection.current?.id ?? null;
  const dt = Math.min(clock.getDelta(), 0.1),
    activeDt = document.hidden ? 0 : dt,
    now = performance.now() / 1000;
  if (selectedId === 'skytrans' && selection.current) {
    selection.current.update(activeDt, now);
    syncSkyTransHud(selection.current);
    const world = selection.current.worldState?.();
    if (world) {
      presentationView.update(world.mode, false);
      site.update(
        activeDt,
        world.time,
        world.position,
        world.mode === 'flight',
        scene.fog instanceof T.Fog ? scene.fog : null,
      );
      flightTrail.update({
        time: world.time,
        position: world.position,
        generation: `${selectedId}:${selectionRevision}:${trailGeneration}:${world.source}:${world.presentationRevision ?? 0}`,
        enabled: world.mode === 'flight' && site.getSettings().trail,
      });
      sun.position.copy(world.position).add(presentationView.sunOffset);
      sun.target.position.copy(world.position);
      mapWrap.hidden = world.mode !== 'flight' || world.source !== 'demo';
      routeSelect.disabled = world.source !== 'demo';
      if (missionPath !== world.path) {
        missionPath = world.path;
        missionMap.setPath(world.path);
      }
      missionMap.draw(world.routeProgress, world.position);
      $('#route-progress').textContent = `${Math.round(world.routeProgress * 100)}%`;
    }
    simulationTools.updateScene();
  }
  if (ready && selectedId === 'ev50') {
    presentationView.update(flight.mode, cameraMode === 'free');
    const externalFrame = ev50External.snapshot();
    const frame = externalFrame ?? simulation.tick(activeDt, now),
      simState = simulation.state(now),
      simulated = !!externalFrame || simulation.source !== 'demo';
    if (!simulated) {
      flight.tick(activeDt);
      visual.position.copy(flight.position);
      visual.quaternion.copy(flight.quaternion);
      visual.speedMps = flight.speedMps;
      visual.lift = flight.lift;
      visual.cruise = flight.cruise;
      visual.time = flight.time;
    } else if (frame) {
      visual.position.fromArray(frame.position);
      visual.quaternion.fromArray(frame.quaternion);
      visual.speedMps = Math.hypot(...frame.velocity);
      visual.time = frame.time;
      visual.lift = frame.rotorRpm.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      visual.cruise = frame.rotorRpm.slice(8).reduce((a, b) => a + b, 0) / 3;
    } else {
      visual.speedMps = visual.lift = visual.cruise = 0;
    }
    if (!simulated && simState.recording.active)
      simulation.capture(
        {
          version: 1,
          sequence: 0,
          time: visual.time,
          frame: 'SCENE',
          position: visual.position.toArray(),
          quaternion: visual.quaternion.toArray(),
          velocity: [visual.speedMps, 0, 0],
          rotorRpm: ROTOR_NAMES.map((_, index) =>
            Math.round((index < 8 ? visual.lift : visual.cruise) * 1800),
          ),
          surfaces: neutralSurfaces,
        },
        now,
      );
    aircraft.position.copy(visual.position);
    aircraft.quaternion.copy(visual.quaternion);
    flightTrail.update({
      time: visual.time,
      position: visual.position,
      generation: `${selectedId}:${selectionRevision}:${trailGeneration}:${ev50External.active ? 'unified' : simulation.source}`,
      enabled: flight.mode === 'flight' && site.getSettings().trail && (!simulated || !!frame),
    });
    for (const r of rotors) {
      let power = r.lift ? flight.lift : flight.cruise,
        raw = r.lift ? flight.liftAngle : flight.cruiseAngle;
      if (simulated) {
        const index = (ROTOR_NAMES as readonly string[]).indexOf(r.pivot.name),
          rpm = frame && index >= 0 ? frame.rotorRpm[index] : 0;
        power = rpm / 1800;
        raw = externalFrame ? ev50External.angle(index) : (rotorAngles.get(r.pivot.name) ?? 0);
        if (
          !externalFrame &&
          !simState.paused &&
          !(simulation.source === 'external' && simState.stale)
        )
          raw = (raw + ((rpm * 2 * Math.PI) / 60) * activeDt) % (2 * Math.PI);
        rotorAngles.set(r.pivot.name, raw);
      }
      const fade = T.MathUtils.smoothstep(power, 0.06, 0.3),
        angle = (raw % (2 * Math.PI)) * T.MathUtils.smoothstep(power, 0, 0.08);
      spin.setFromAxisAngle(axis, angle * r.sign);
      r.pivot.quaternion.copy(r.base).multiply(spin);
      for (const material of r.parts) material.opacity = 1 - fade;
      r.disc.material.opacity = 0.16 * fade;
      r.disc.visible = fade > 0.001;
    }
    rig?.update(
      frame && simulated ? frame.surfaces : neutralSurfaces,
      visual.time,
      visual.lift > 0 || visual.cruise > 0,
    );
    if (rig) rig.debug.visible = site.getSettings().references;
    const sensor = cameraMode === 'fpv' || cameraMode === 'down';
    const nextProjection = sensor ? 'sensor' : 'observer';
    if (projectionMode !== nextProjection) {
      projectionMode = nextProjection;
      camera.fov = sensor ? CAMERA_MOUNTS.fpv.verticalFov : 42;
      camera.near = sensor ? 0.025 : 0.1;
      camera.updateProjectionMatrix();
    }
    target.copy(visual.position);
    target.y += 0.65;
    if (cameraMode === 'fpv' || cameraMode === 'down')
      placeSensorCamera(cameraMode, aircraft, camera);
    else if (cameraMode !== 'free') {
      if (cameraMode === 'ground') desired.set(12, 2.8, 14);
      else if (cameraMode === 'wide') desired.set(1400, 680, 1900);
      else {
        v.set(
          cameraMode === 'side' ? 13 : 8,
          cameraMode === 'side' ? 3 : 3.5,
          cameraMode === 'side' ? 0 : 11,
        ).multiplyScalar(Math.max(1, 1.05 / camera.aspect));
        v.applyQuaternion(visual.quaternion);
        desired.copy(visual.position).add(v);
      }
      if (flight.mode === 'flight')
        desired.y = Math.max(desired.y, obstacleCeiling(desired.x, desired.z) + 10);
      camera.position.lerp(desired, 1 - Math.exp(-dt * 4));
      if (flight.mode === 'flight')
        camera.position.y = Math.max(
          camera.position.y,
          obstacleCeiling(camera.position.x, camera.position.z) + 6,
        );
      camera.lookAt(target);
    } else controls.update(dt);
    site.update(
      activeDt,
      visual.time,
      visual.position,
      flight.mode === 'flight',
      scene.fog instanceof T.Fog ? scene.fog : null,
    );
    sun.position.copy(visual.position).add(presentationView.sunOffset);
    sun.target.position.copy(visual.position);
    const stateCode = simulated
      ? simulation.source === 'replay'
        ? 'REPLAY'
        : simState.waiting
          ? 'WAITING'
          : simState.stale
            ? 'STALE'
            : 'TELEMETRY'
      : flight.manual
        ? 'MANUAL'
        : flight.state;
    $('#state').textContent = simulated
      ? simulation.source === 'replay'
        ? '遥测记录回放'
        : simState.waiting
          ? '等待外部首帧'
          : simState.stale
            ? '遥测断流 · 保持最后状态'
            : '外部遥测视景'
      : flight.manual
        ? '外部指令控制'
        : labels[flight.state];
    $('#state-code').textContent = stateCode;
    $('#speed').textContent = visual.speedMps.toFixed(1);
    $('#altitude').textContent = visual.position.y.toFixed(1);
    $('#lift-power').textContent =
      simulation.source === 'replay'
        ? replayThrottle(visual.lift, 2600)
        : simulated
          ? `${Math.round(visual.lift)} rpm`
          : `${Math.round(visual.lift * 100)}%`;
    $('#cruise-power').textContent =
      simulation.source === 'replay'
        ? replayThrottle(visual.cruise, 2800)
        : simulated
          ? `${Math.round(visual.cruise)} rpm`
          : `${Math.round(visual.cruise * 100)}%`;
    const time =
      simulation.source === 'replay'
        ? simulation.replay.time
        : simulated
          ? (frame?.time ?? 0)
          : flight.time;
    const duration = simulation.source === 'replay' ? simulation.replay.duration : flight.duration;
    $<HTMLInputElement>('#timeline').max = String(duration);
    $<HTMLInputElement>('#timeline').value = String(time);
    $<HTMLInputElement>('#timeline').disabled = simulation.source === 'external';
    $<HTMLButtonElement>('#restart').disabled = simulation.source === 'external';
    $<HTMLInputElement>('#loop').disabled = simulated;
    $<HTMLSelectElement>('#playback-speed').disabled = simulated;
    $('#time').textContent =
      simulation.source === 'external'
        ? `${time.toFixed(2)} s · 外部时钟`
        : `${time.toFixed(1)} / ${duration.toFixed(1)} s`;
    $('.timeline-head span').textContent = simulated
      ? simulation.source === 'replay'
        ? '遥测记录回放'
        : '实时视景 · 接收状态'
      : '完整飞行演示';
    $('.phase-labels').style.visibility = simulated ? 'hidden' : 'visible';
    $('#play').textContent = (
      simulated ? !simState.paused : flight.manual ? !flight.manualPaused : flight.playing
    )
      ? '暂停'
      : '播放';
    document.body.dataset.state = stateCode;
    document.body.dataset.source = simulation.source;
    aircraft.updateMatrixWorld();
    labelData.forEach((d, i) => {
      const el = labelEls[i];
      el.hidden = !showLabels || sensor;
      v.copy(d.pos).applyMatrix4(aircraft.matrixWorld).project(camera);
      if (v.z > 1 || v.z < 0) el.hidden = true;
      const x = Math.max(
        8,
        Math.min(canvas.clientWidth - 165, (v.x * 0.5 + 0.5) * canvas.clientWidth),
      );
      el.style.transform = `translate(${x}px,${(-v.y * 0.5 + 0.5) * canvas.clientHeight}px)`;
    });
    if (!simulated) {
      const progress = flight.routeProgress;
      missionMap.draw(progress, visual.position);
      mapWrap.querySelector('b')!.textContent = Math.round(progress * 100) + '%';
    }
    panelElapsed += dt;
    if (panelElapsed >= 0.2) {
      panelElapsed = 0;
      simulationTools.update(
        ready,
        visual.position.y - obstacleCeiling(visual.position.x, visual.position.z),
      );
    }
    telemetryElapsed += dt;
    if (telemetryElapsed >= 0.1) {
      telemetryElapsed = 0;
      for (const callback of subscribers) {
        try {
          callback(status());
        } catch (error) {
          console.warn('EV50 subscriber failed', error);
        }
      }
    }
  }
  if (postEnabled) composer.render();
  else renderer.render(scene, activeCamera);
  frameNumber++;
  const currentWasRendered =
    frameAircraft !== null &&
    frameRevision === selectionRevision &&
    frameAircraft === selection.current?.id;
  renderedSelectionRevision = currentWasRendered ? frameRevision : -1;
  renderedAircraft = currentWasRendered ? frameAircraft : null;
  if (currentWasRendered && !renderer.getContext().isContextLost())
    unifiedGateway?.afterRender(frameNumber);
  updateControlOwnership();
  unifiedPanel?.update();
  presentationView.afterRender();
  document.body.dataset.geometries = String(renderer.info.memory.geometries);
  document.body.dataset.textures = String(renderer.info.memory.textures);
  document.body.dataset.drawCalls = String(renderer.info.render.calls);
  document.body.dataset.triangles = String(renderer.info.render.triangles);
}
function syncSkyTransHud(instance: AircraftInstance) {
  const state = instance.snapshot();
  const playback = playbackPresentation(state);
  $('#state').textContent = state.label;
  $('#state-code').textContent = state.state;
  $('#speed').textContent = state.speedMps.toFixed(1);
  $('#vertical-speed').textContent = (state.verticalSpeedMps ?? 0).toFixed(1);
  $('#speed-label').textContent = state.control === 'local' ? '轨迹速度（仿真秒）' : '飞行速度';
  $('#vertical-speed-metric').title =
    state.control === 'local'
      ? `按仿真秒计量；${state.playbackRate ?? 1}× 播放会同比改变画面速度。演示参数，非实机性能。`
      : '世界 +Y 方向速度';
  $('#altitude').textContent = state.altitude.toFixed(1);
  $('#lift-power').textContent = state.lift;
  $('#cruise-power').textContent = state.cruise;
  $('#product').classList.toggle('active', state.mode === 'product');
  $('#flight').classList.toggle('active', state.mode === 'flight');
  $('#mode-label').textContent =
    state.control === 'replay'
      ? 'JSON REPLAY'
      : state.control === 'external'
        ? state.timelineLabel === '外部仿真时间'
          ? 'UNIFIED API CONTROL'
          : 'PYTHON CONTROL'
        : state.mode === 'product'
          ? 'MECHANISM STUDY'
          : 'FLIGHT DEMONSTRATION';
  $('#play').textContent = state.playing ? '暂停' : '播放';
  $('#timeline-wrap').classList.toggle('muted', state.mode === 'product');
  $<HTMLInputElement>('#timeline').max = String(state.duration);
  $<HTMLInputElement>('#timeline').value = String(state.time);
  $<HTMLInputElement>('#timeline').disabled = playback.disableSeek;
  $<HTMLInputElement>('#timeline').step = playback.step;
  $<HTMLButtonElement>('#play').disabled = playback.disablePlay;
  $<HTMLButtonElement>('#restart').disabled = playback.disableRestart;
  $<HTMLInputElement>('#loop').disabled = playback.disableLoop;
  $<HTMLInputElement>('#loop').checked = playback.loop;
  $<HTMLSelectElement>('#playback-speed').disabled = playback.disableSpeed;
  for (const id of ['product', 'flight'])
    $<HTMLButtonElement>(`#${id}`).disabled = playback.disableMode;
  configurePlaybackRates(playback.rateOptions, playback.rate);
  $('#time').textContent = playback.timeLabel;
  $('.timeline-head span').textContent = playback.timelineLabel;
  $('.phase-labels').style.visibility = 'hidden';
  document.body.dataset.state = state.state;
  document.body.dataset.source = 'skytrans';
}
function configurePlaybackRates(rates: readonly number[], selected: number) {
  const select = $<HTMLSelectElement>('#playback-speed');
  const key = rates.join(',');
  if (select.dataset.rates !== key) {
    select.dataset.rates = key;
    select.replaceChildren(
      ...rates.map((rate) => {
        const option = document.createElement('option');
        option.value = String(rate);
        option.textContent = `${rate}×`;
        return option;
      }),
    );
  }
  if (select.value !== String(selected)) select.value = String(selected);
}
const hangarSelect = $<HTMLSelectElement>('#aircraft-select');
const aircraftPanel = $('#aircraft-panel');
const cameraSelect = $<HTMLSelectElement>('#camera');
function configureAircraftShell(id: AircraftId) {
  const descriptor = aircraftDescriptor(id);
  hangarSelect.value = id;
  $('#vertical-speed-metric').hidden = id !== 'skytrans';
  $('#speed-label').textContent = '飞行速度';
  $('#aircraft-brand').textContent = descriptor.name;
  $('#aircraft-headline').textContent = id === 'ev50' ? '跨越山海' : 'Skytrans';
  $('#summary').textContent = descriptor.description;
  canvas.setAttribute('aria-label', `${descriptor.name} 三维展示，可用鼠标或触控观察`);
  document.title = `SkyCaptain · ${descriptor.name} — 交互飞行机库`;
  document.body.dataset.aircraft = id;
  cameraSelect.replaceChildren(
    ...descriptor.cameras.map(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      return option;
    }),
  );
  cameraSelect.value = 'free';
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-ev50-only],#simulation-tools',
  ))
    element.hidden = id !== 'ev50';
  routeLabel.hidden = false;
  mapWrap.hidden = true;
  labelEls.forEach((element) => {
    element.hidden = true;
  });
  configurePlaybackRates([0.25, 0.5, 1, 1.5, 2, 4], 1);
  $<HTMLInputElement>('#timeline').step = '0.01';
  $('#lift-label').textContent = id === 'ev50' ? '垂起旋翼' : '整翼展开';
  $('#cruise-label').textContent = id === 'ev50' ? '巡航推进' : '运行电机';
  $<HTMLInputElement>('#loop').checked = true;
  $<HTMLInputElement>('#annotations').checked = false;
  $<HTMLInputElement>('#auto-orbit').checked = false;
  $<HTMLSelectElement>('#product-view').value = 'hero';
  showLabels = false;
  cameraMode = 'free';
}
function createSelection() {
  return createAircraftSelection<AircraftInstance>({
    async load(id, signal) {
      if (id === 'ev50') return loadEv50(signal);
      const module = await import('./aircraft/skytrans/index');
      signal.throwIfAborted();
      const response = await fetch(assetUrl('flight.json'), { signal });
      if (!response.ok) throw new Error('共享航线数据读取失败');
      const data = await response.json();
      signal.throwIfAborted();
      return module.createSkyTrans(
        {
          flightFrames: data.frames as Frame[],
          setSceneMode,
          clearTrail: () => clearFlightTrail(),
          scene,
          renderer,
          canvas,
          panel: aircraftPanel,
          assetUrl,
          setCamera: setActiveCamera,
          report: (message) => {
            if (!signal.aborted) $('#load-status').textContent = message;
          },
        },
        signal,
      );
    },
    onPending(id) {
      unifiedGateway?.invalidateSelection();
      ev50External.release();
      ++selectionRevision;
      selectedId = id as AircraftId;
      ready = false;
      rotors.length = 0;
      rig = undefined;
      subscribers.clear();
      simulationTools.deactivate();
      simulation.reset();
      stopHttpBridge?.();
      stopHttpBridge = undefined;
      clearFlightTrail();
      rotorAngles.clear();
      presentationView.suspend();
      aircraftPanel.replaceChildren();
      aircraft.position.set(0, 0, 0);
      aircraft.quaternion.identity();
      aircraft.visible = selectedId === 'ev50';
      controls.enabled = selectedId === 'ev50';
      controls.autoRotate = false;
      setSceneMode('product');
      sun.visible = hemisphere.visible = true;
      sun.position.set(-35, 65, 25);
      sun.target.position.set(0, 0, 0);
      missionPath = null;
      scene.environment = envmap.texture;
      setActiveCamera(camera);
      configureAircraftShell(selectedId);
      if (selectedId === 'ev50') presentationView.resetProductView();
      for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >('.modes button,.timeline-panel button,.timeline-panel input,#camera'))
        control.disabled = true;
      $('#loading').hidden = false;
      $('#loading').textContent = `正在加载 ${aircraftDescriptor(selectedId).name}…`;
      $('#load-status').textContent = '读取三维模型…';
      $('#load-retry').hidden = true;
      document.body.dataset.ready = 'false';
      document.body.dataset.state = 'LOADING';
      $('#state').textContent = '载入中';
      $('#state-code').textContent = 'LOADING';
      for (const id of ['speed', 'altitude']) $(`#${id}`).textContent = '0.0';
      for (const id of ['lift-power', 'cruise-power']) $(`#${id}`).textContent = '—';
      $<HTMLInputElement>('#timeline').value = '0';
      $('#time').textContent = '—';
      quality($<HTMLSelectElement>('#quality').value);
    },
    onReady(id, instance) {
      $('#loading').hidden = true;
      $('#load-status').textContent = `模型就绪 · ${aircraftDescriptor(id as AircraftId).name}`;
      document.body.dataset.ready = 'true';
      for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >('.modes button,.timeline-panel button,.timeline-panel input,#camera'))
        control.disabled = false;
      presentationView.setReady();
      for (const control of document.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >('#scene-tools input,#scene-tools select,#scene-tools button,#lighting,#route,#immersive'))
        control.disabled = false;
      instance.setQuality($<HTMLSelectElement>('#quality').value as AircraftQuality);
      instance.resize();
      if (id === 'ev50') stopHttpBridge = startHttpBridge(api);
      else syncSkyTransHud(instance);
    },
    onError(_id, error) {
      ready = false;
      $('#loading').hidden = true;
      $('#load-status').textContent =
        `载入失败：${error instanceof Error ? error.message : String(error)}。可重试或选择其他飞机。`;
      $('#load-retry').hidden = false;
      console.error(error);
    },
  });
}
let selection = createSelection();
function unifiedCapabilities(): AircraftControlCapabilities {
  const operations: AircraftControlCapabilities['operations'] = [
    'aircraft.pose',
    'clock.step',
    'transport.play',
    'transport.pause',
    'transport.reset',
    'transport.seek',
    'transport.speed',
    'transport.loop',
    ...(selectedId === 'ev50'
      ? ['ev50.motors' as const]
      : ['skytrans.mechanism' as const, 'skytrans.motors' as const, 'skytrans.surfaces' as const]),
  ];
  return {
    aircraft: selectedId,
    rotorCount: selectedId === 'ev50' ? 11 : 4,
    operations,
    body: {
      forward: '+Z',
      up: '+Y',
      origin:
        selectedId === 'ev50'
          ? 'EV50 source GLB datum; home pad y=0'
          : 'ground datum at home pad y=0; source rig offset converted by adapter',
    },
    notes:
      selectedId === 'ev50'
        ? ['Eleven rotors, grouped lift/cruise power control; no SkyTrans motor names']
        : ['Four named motors; six independent surfaces; unchanged native mechanism rig'],
  };
}
function normalizedState(): AdapterAircraftState {
  if (selectedId === 'skytrans') return selection.current!.normalizedState!();
  const external = ev50External.snapshot();
  const state = status();
  const frame = external ?? simulation.frame;
  const source = external ? 'external' : simulation.source;
  const simulated = source !== 'demo';
  return {
    pose: {
      positionM: frame && simulated ? [...frame.position] : flight.position.toArray(),
      attitude: frame && simulated ? [...frame.quaternion] : flight.quaternion.toArray(),
      velocityMps: frame && simulated ? [...frame.velocity] : null,
    },
    clock: {
      authority: source === 'demo' ? 'host' : source === 'external' ? 'external' : 'replay',
      seconds: external?.time ?? state.time,
    },
    controlMode: source === 'demo' ? 'local' : source === 'external' ? 'external' : 'replay',
    transport: {
      playing: external ? ev50External.playing : state.playing,
      position: external?.time ?? state.time ?? 0,
      duration: external ? 0 : (state.duration ?? 0),
      unit: 'seconds',
      speed: simulated ? null : flight.speed,
      loop: !simulated && flight.loop,
    },
    model: {
      aircraft: 'ev50',
      rotorCount: 11,
      rotorsRpm:
        frame && simulated
          ? [...frame.rotorRpm]
          : ROTOR_NAMES.map((_, i) => (i < 8 ? flight.lift : flight.cruise) * 1800),
    },
  };
}
function applyUnifiedCommand(command: AircraftControlCommand) {
  if (selectedId === 'skytrans') {
    if (!selection.current?.applyControl)
      throw new Error('SkyTrans control adapter is unavailable');
    selection.current.applyControl(command);
    if (command.operation === 'transport.seek' || command.operation === 'transport.reset')
      clearFlightTrail(command.operation);
    return;
  }
  if (ev50External.active) {
    ev50External.apply(command);
    if (command.operation === 'transport.reset') clearFlightTrail(command.operation);
    return;
  }
  switch (command.operation) {
    case 'transport.play':
      if (flight.mode !== 'flight') setMode('flight');
      flight.playing = true;
      break;
    case 'transport.pause':
      flight.pause();
      break;
    case 'transport.reset':
      clearFlightTrail();
      flight.pause();
      flight.restart();
      break;
    case 'transport.seek':
      clearFlightTrail();
      flight.seek(command.payload.position);
      break;
    case 'transport.speed':
      flight.setSpeed(command.payload.speed);
      break;
    case 'transport.loop':
      flight.loop = command.payload.loop;
      break;
    case 'ev50.motors':
      flight.applyCommand({ type: 'motor', ...command.payload });
      setSceneMode('flight');
      break;
    default:
      throw new Error('Operation requires an external EV50 lease');
  }
}
function initializeUnifiedControl() {
  unifiedGateway = new UnifiedControlGateway(
    {
      getContext: () => ({
        aircraft: selectedId,
        generation: selectionRevision,
        ready: !!selection.current,
        blockedReason:
          selectedId === 'ev50'
            ? simulation.source !== 'demo'
              ? 'Legacy EV50 telemetry or replay owns the aircraft'
              : undefined
            : selection.current?.controlBlockedReason?.(),
      }),
      getState: normalizedState,
      getCapabilities: unifiedCapabilities,
      apply: applyUnifiedCommand,
      leaseChanged(lease, reason) {
        if (selectedId === 'skytrans') {
          selection.current?.setControlLease?.(lease, reason);
          clearFlightTrail('control-lease');
          return;
        }
        if (!ready) return;
        if (lease?.controlMode === 'external') {
          ev50External.acquire(flight);
          flight.mode = 'flight';
          setSceneMode('flight');
          clearFlightTrail();
        } else if (!lease) {
          const hadExternal = ev50External.active;
          ev50External.release();
          flight.pause();
          if (hadExternal) setMode('product');
          for (const control of document.querySelectorAll<
            HTMLInputElement | HTMLSelectElement | HTMLButtonElement
          >(
            '.modes button,.timeline-panel input,.timeline-panel button,.timeline-panel select,#route,#simulation-tools button,#simulation-tools input,#simulation-tools select',
          ))
            control.disabled = false;
        }
      },
    },
    { origin: location.origin },
  );
  unifiedBridge = new LocalHttpBridge(unifiedGateway);
  unifiedPanel = controlPanel(unifiedGateway, unifiedBridge);
}
function updateControlOwnership() {
  const lease = unifiedGateway?.getLease();
  if (!lease) return;
  for (const element of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >(
    '.modes button,.timeline-panel input,.timeline-panel button,.timeline-panel select,#route,#simulation-tools button,#simulation-tools input,#simulation-tools select',
  ))
    element.disabled = true;
  if (selectedId === 'ev50' && ev50External.active) {
    const state = ev50External.snapshot()!;
    $('#state').textContent = '统一 API 外部控制';
    $('#state-code').textContent = 'EXTERNAL';
    $('#mode-label').textContent = 'EXTERNAL VISUAL CONTROL';
    $('#time').textContent = `${state.time.toFixed(2)} s · 外部步进时钟`;
    $('#speed').textContent = Math.hypot(...state.velocity).toFixed(1);
    $('#altitude').textContent = state.position[1].toFixed(1);
    $('#play').textContent = ev50External.playing ? '暂停' : '播放';
    mapWrap.hidden = true;
  }
}
function selectAircraft(id: AircraftId, historyMode: 'push' | 'replace' | 'none' = 'push') {
  if (historyMode !== 'none') {
    const url = new URL(location.href);
    url.searchParams.set('aircraft', id);
    if (url.href !== location.href)
      history[historyMode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
  }
  return selection.select(id);
}
hangarSelect.onchange = () => {
  if (isAircraftId(hangarSelect.value)) void selectAircraft(hangarSelect.value);
};
$('#load-retry').onclick = () => {
  void selectAircraft(selectedId, 'none');
};
window.addEventListener('popstate', () => {
  selectLandscape(
    readLandscapePreset(new URL(location.href), () => localStorage.getItem(LANDSCAPE_STORAGE_KEY)),
  );
  void selectAircraft(aircraftFromUrl(new URL(location.href)), 'none');
});
window.addEventListener('pagehide', () => {
  unifiedBridge?.stop();
  unifiedGateway?.invalidateSelection();
  selection.dispose();
  simulationTools.deactivate();
  simulation.disconnect();
  stopHttpBridge?.();
  flightTrail.dispose();
  renderer.setAnimationLoop(null);
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  // BFCache retains the host and its listeners, but pagehide disposed its aircraft.
  // Rebuild only the selection/resources; do not duplicate a renderer or listener set.
  if (renderer.getContext().isContextLost()) {
    location.reload();
    return;
  }
  selection.dispose();
  flightTrail.dispose();
  flightTrail = new FlightTrail(scene, { surfaceHeight: terrain.surfaceHeight });
  selection = createSelection();
  historyRestores++;
  quality($<HTMLSelectElement>('#quality').value);
  void selectAircraft(aircraftFromUrl(new URL(location.href)), 'none');
  renderer.setAnimationLoop(animate);
});
Object.assign(window, {
  hangarAPI: Object.freeze({
    request: (request: unknown) => unifiedGateway!.request(request),
    config: () => unifiedGateway!.getConfig(),
    controlState: () => unifiedGateway!.getState(),
    list: () =>
      AIRCRAFT.map((entry) => ({
        id: entry.id,
        name: entry.name,
        capabilities: [...entry.capabilities],
      })),
    state: () => ({
      selected: selectedId,
      current: selection.currentId,
      pending: selection.pendingId,
      ready: !!selection.current,
      aircraft: selection.current?.describe(),
    }),
    select: (id: unknown) => {
      const canonicalId = normalizeAircraftId(id);
      if (!canonicalId) return Promise.reject(new Error('Unknown aircraft'));
      return selectAircraft(canonicalId);
    },
  }),
});
Object.defineProperty(window, 'hangarDiagnostics', {
  get: () => ({
    selected: selectedId,
    current: selection.currentId,
    pending: selection.pendingId,
    ready: !!selection.current,
    historyRestores,
    frameNumber,
    selectionRevision,
    renderedSelectionRevision,
    renderedAircraft,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    camera: activeCamera.type,
    renderCamera: {
      position: activeCamera.position.toArray(),
      quaternion: activeCamera.quaternion.toArray(),
      projection: activeCamera.projectionMatrix.elements.slice(),
      worldMatrix: activeCamera.matrixWorld.elements.slice(),
    },
    sceneChildren: scene.children.length,
    scene: {
      mode: sharedSceneMode,
      terrainVisible: terrain.group.visible,
      background: scene.background instanceof T.Color ? scene.background.getHexString() : null,
      exposure: renderer.toneMappingExposure,
      fog:
        scene.fog instanceof T.Fog
          ? { color: scene.fog.color.getHexString(), near: scene.fog.near, far: scene.fog.far }
          : null,
      environmentIntensity: scene.environmentIntensity,
      ownedGroups: scene.children.map((child) => child.name),
      settings: site.describe(),
    },
    world: selection.current?.worldState?.(),
    aircraft: selection.current?.describe(),
    control: unifiedGateway?.getState(),
    localBridge: unifiedBridge?.describe(),
    trail: flightTrail.diagnostics,
    landscape: terrain.diagnostics,
  }),
});
initializeUnifiedControl();
quality(initialQuality);
void selectAircraft(selectedId, 'replace');
renderer.setAnimationLoop(animate);
Object.defineProperty(window, 'ev50Diagnostics', {
  get: () => ({
    ready,
    assetVersion,
    presentation: presentationView.getState(),
    simulation: simulation.state(),
    rig: rig?.describe(),
    scene: site.describe(),
    trail: flightTrail.diagnostics,
    landscape: terrain.diagnostics,
    time: flight?.time,
    duration: flight?.duration,
    route: flight?.route,
    state: flight?.state,
    mode: flight?.mode,
    playing: flight?.playing,
    loop: flight?.loop,
    rotors: rotors.length,
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    position: aircraft.position.toArray(),
    camera: cameraMode,
    quality: $<HTMLSelectElement>('#quality').value,
  }),
});
