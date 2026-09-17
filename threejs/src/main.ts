import * as T from 'three';
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
const renderer = new T.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(0xa4becb);
scene.fog = new T.Fog(0xa4becb, 1800, 7200);
const camera = new T.PerspectiveCamera(42, 1, 0.1, 9000);
camera.position.set(8, 3.6, 10);
const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;
composer.addPass(new RenderPass(scene, camera));
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
scene.environmentIntensity = 0.45;
room.dispose();
pmrem.dispose();
const terrain = environment(scene),
  aircraft = new T.Group();
aircraft.name = 'Flight_Pose';
scene.add(aircraft);
let flight: FlightController,
  ready = false,
  cameraMode: CameraMode = 'free',
  showLabels = false;
let assetVersion = 'unknown';
const site = sceneDetails(terrain.group);
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
Promise.all([
  new GLTFLoader().loadAsync(new URL('ev50.glb', document.baseURI).href),
  fetch(new URL('flight.json', document.baseURI)).then((r) => {
    if (!r.ok) throw Error('飞行数据读取失败');
    return r.json();
  }),
])
  .then(([gltf, data]) => {
    aircraft.add(gltf.scene);
    flight = new FlightController(data.frames as Frame[]);
    const pivots: T.Object3D[] = [];
    gltf.scene.traverse((o) => {
      if (o.userData.visual_asset_version) assetVersion = String(o.userData.visual_asset_version);
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
    ready = true;
    flight.evaluate();
    missionMap.setPath(flight.getPath());
    $<HTMLInputElement>('#timeline').max = String(flight.duration);
    $('#loading').hidden = true;
    $('#load-status').textContent = `模型就绪 · ${assetVersion} / 视景 1.0`;
    document.body.dataset.ready = 'true';
    document.body.dataset.assetVersion = assetVersion;
    for (const el of document.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('button,input,select'))
      el.disabled = false;
    presentationView.setReady();
    $('#summary').textContent = '7.00 m 翼展 / 8 + 3 动力系统';
  })
  .catch((e: Error) => {
    $('#loading').textContent = '加载失败：' + e.message + '。请通过本地服务打开，并检查模型文件。';
    console.error(e);
  });
function setMode(mode: 'product' | 'flight') {
  if (!ready) return;
  if (simulation.source !== 'demo') simulation.select('demo');
  site.clearTrail();
  flight.mode = mode;
  flight.restart();
  mapWrap.hidden = mode === 'product';
  flight.playing = mode === 'flight';
  terrain.group.visible = mode === 'flight';
  cameraMode = mode === 'flight' ? 'follow' : 'free';
  $<HTMLSelectElement>('#camera').value = cameraMode;
  controls.enabled = cameraMode === 'free';
  if (mode === 'product') {
    presentationView.resetProductView();
    scene.background = new T.Color(0x202c34);
    scene.fog = null;
  } else {
    scene.background = new T.Color(0xa4becb);
    scene.fog = new T.Fog(0xa4becb, 1800, 7200);
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
  site.clearTrail();
  rotorAngles.clear();
  if (source === 'demo') {
    setMode('flight');
    return;
  }
  flight.pause();
  flight.mode = 'flight';
  terrain.group.visible = true;
  mapWrap.hidden = true;
  scene.background = new T.Color(0xa4becb);
  scene.fog = new T.Fog(0xa4becb, 1800, 7200);
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
$('#product').onclick = () => setMode('product');
$('#flight').onclick = () => setMode('flight');
$('#play').onclick = () => {
  if (!ready) return;
  if (simulation.source !== 'demo') {
    if (simulation.source === 'replay' && simulation.replay.time >= simulation.replay.duration) {
      simulation.replay.seek(0);
      site.clearTrail();
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
  if (!ready) return;
  site.clearTrail();
  if (simulation.source === 'replay') {
    simulation.replay.seek(0);
    simulation.pause(false);
  } else if (simulation.source === 'demo') flight.restart();
};
$<HTMLInputElement>('#loop').onchange = (e) => {
  if (ready) flight.loop = (e.target as HTMLInputElement).checked;
};
$<HTMLInputElement>('#timeline').oninput = (e) => {
  if (!ready) return;
  const t = Number((e.target as HTMLInputElement).value);
  site.clearTrail();
  if (simulation.source === 'replay') {
    simulation.replay.seek(t);
    return;
  }
  if (simulation.source === 'external') return;
  if (flight.mode === 'product') setMode('flight');
  flight.seek(t);
};
$<HTMLSelectElement>('#camera').onchange = (e) => {
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
  if (ready) {
    leaveSimulation();
    site.clearTrail();
    flight.setRoute(routeSelect.value as keyof typeof routes);
    missionMap.setPath(flight.getPath());
  }
};
const requireReady = () => {
  if (!ready) throw new Error('EV50 is still loading');
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
    return ready;
  },
  visualRequest: (operation: string, payload: unknown) => {
    requireReady();
    if (operation === 'aircraft.describe') return rig!.describe();
    if (operation === 'camera.describe') return describeCamera(camera, canvas, cameraMode);
    if (operation === 'scene.describe') return site.describe();
    if (operation === 'scene.configure') return site.configure(payload);
    if (operation === 'scene.query') return site.query(payload);
    if (operation === 'simulation.replay.seek') site.clearTrail();
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
      terrain.group.visible = true;
      mapWrap.hidden = false;
      scene.background = new T.Color(0xa4becb);
      scene.fog = new T.Fog(0xa4becb, 1800, 7200);
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
    site.clearTrail();
    flight.pause();
    flight.restart();
  },
  seek: (seconds: number) => {
    requireReady();
    if (simulation.source !== 'demo') throw new Error('Use simulation.replay.seek for recordings');
    if (seconds < 0 || seconds > flight.duration) throw new Error('Invalid time');
    site.clearTrail();
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
    site.clearTrail();
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
const simulationTools = simulationPanel(api, simulation, site.getSettings);
window.addEventListener('pagehide', () => simulation.disconnect());
startHttpBridge(api);
let telemetryElapsed = 0;
$<HTMLSelectElement>('#playback-speed').onchange = (e) => {
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
  $('#quality-readout').textContent = q.toUpperCase();
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
  if (cameraMode === 'free' && (!ready || flight.mode === 'product'))
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
  $('#loading').hidden = false;
  $('#loading').textContent = '图形设备连接中断，请刷新页面恢复。';
  if (ready) flight.playing = false;
});
mapWrap.hidden = true;
terrain.group.visible = false;
scene.background = new T.Color(0x202c34);
scene.fog = null;
const initialQuality = innerWidth < 700 ? 'Low' : 'High';
$<HTMLSelectElement>('#quality').value = initialQuality;
quality(initialQuality);
const clock = new T.Clock(),
  desired = new T.Vector3(),
  target = new T.Vector3(),
  v = new T.Vector3();
let projectionMode = '',
  panelElapsed = 0;
const neutralSurfaces: Surfaces = { aileron: 0, elevator: 0, rudder: 0 };
function animate() {
  const dt = Math.min(clock.getDelta(), 0.1),
    activeDt = document.hidden ? 0 : dt,
    now = performance.now() / 1000;
  if (ready) {
    presentationView.update(flight.mode, cameraMode === 'free');
    const frame = simulation.tick(activeDt, now),
      simState = simulation.state(now),
      simulated = simulation.source !== 'demo';
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
    for (const r of rotors) {
      let power = r.lift ? flight.lift : flight.cruise,
        raw = r.lift ? flight.liftAngle : flight.cruiseAngle;
      if (simulated) {
        const index = (ROTOR_NAMES as readonly string[]).indexOf(r.pivot.name),
          rpm = frame && index >= 0 ? frame.rotorRpm[index] : 0;
        power = rpm / 1800;
        raw = rotorAngles.get(r.pivot.name) ?? 0;
        if (!simState.paused && !(simulation.source === 'external' && simState.stale))
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
    $('#lift-power').textContent = simulated
      ? `${Math.round(visual.lift)} rpm`
      : `${Math.round(visual.lift * 100)}%`;
    $('#cruise-power').textContent = simulated
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
  else renderer.render(scene, camera);
  presentationView.afterRender();
  document.body.dataset.geometries = String(renderer.info.memory.geometries);
  document.body.dataset.textures = String(renderer.info.memory.textures);
  document.body.dataset.drawCalls = String(renderer.info.render.calls);
  document.body.dataset.triangles = String(renderer.info.render.triangles);
}
renderer.setAnimationLoop(animate);
Object.defineProperty(window, 'ev50Diagnostics', {
  get: () => ({
    ready,
    assetVersion,
    presentation: presentationView.getState(),
    simulation: simulation.state(),
    rig: rig?.describe(),
    scene: site.describe(),
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
