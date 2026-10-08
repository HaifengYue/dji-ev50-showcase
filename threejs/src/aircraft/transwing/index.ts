import * as THREE from 'three';
import type {
  AircraftHost,
  AircraftInstance,
  AircraftMode,
  AircraftQuality,
  AircraftSnapshot,
} from '../types';
import {
  createModelRig,
  measureModelRig,
  applyModelPose,
  applyMotorPose,
  applySurfacePose,
} from './core/rig';
import { SimulationRuntime, type StatePatch } from './core/simulation';
import { SimulationBridge } from './core/simulationBridge';
import { RecordingLoader } from './core/recordingLoader';
import { beginLocalControl } from './core/uiControl';
import {
  experienceReducer,
  INITIAL_EXPERIENCE,
  displayedUnfold,
  type ExperienceAction,
  type ExperienceState,
} from './core/experience';
import { getFlight, TOTAL } from './core/flight';
import { MOTOR_IDS, newMotorCommands, type MotorCommands } from './core/motors';
import { detailSurfaces, NEUTRAL_DETAIL_POSE } from './core/details';
import {
  getInspectionFrame,
  getPresentationFrame,
  getJointInspectionFrame,
  getDetailInspectionFrame,
  type CameraView,
} from './core/inspection';
import { createRotorExposure } from './core/rotorExposure';
import { createInternalDriveInspection } from './core/internalDriveInspection';
import { modelAssetUrl } from './core/modelAssetRevision';
import { loadOwnedGLTF, type OwnedResources } from './resources';
import { TranswingCamera } from './camera';
import { TranswingPresentation, createJointGuide } from './presentation';
import { createTranswingPanel } from './panel';
import { prepareManualInput, cargoPresentationLift } from './localControl';
import './panel.css';

/** One host renderer, canvas and clock. Every asynchronous asset belongs to this selection. */
export async function createTranswing(
  host: AircraftHost,
  signal: AbortSignal,
): Promise<AircraftInstance> {
  const model = await loadOwnedGLTF(modelAssetUrl('xp4', host.assetUrl), signal);
  try {
    signal.throwIfAborted();
    return new TranswingInstance(host, signal, model.scene, model.resources);
  } catch (error) {
    model.resources.dispose();
    throw error;
  }
}

class TranswingInstance implements AircraftInstance {
  readonly id = 'transwing' as const;
  private readonly root = new THREE.Group();
  private readonly runtime = new SimulationRuntime();
  private readonly bridge: SimulationBridge;
  private readonly loader: RecordingLoader;
  private readonly rig: ReturnType<typeof createModelRig>;
  private readonly measurements: ReturnType<typeof measureModelRig>;
  private camera!: TranswingCamera;
  private presentation!: TranswingPresentation;
  private panel: ReturnType<typeof createTranswingPanel> | null = null;
  private exposure: ReturnType<typeof createRotorExposure> | null = null;
  private drive: ReturnType<typeof createInternalDriveInspection> | null = null;
  private guide: ReturnType<typeof createJointGuide> = null;
  private guideSide: 'L' | 'R' | null = null;
  private state: ExperienceState = structuredClone(INITIAL_EXPERIENCE);
  private mode: AircraftMode = 'product';
  private rate = 1;
  private loop = true;
  private wireframe = false;
  private environment: 'hangar' | 'sky' = 'hangar';
  private internalDrive = false;
  private axes = true;
  private lastWireframe: boolean | null = null;
  private lastEnvironment: 'hangar' | 'sky' = 'hangar';
  private disposed = false;
  private concept: { scene: THREE.Group; resources: OwnedResources; bounds: THREE.Box3 } | null =
    null;
  private conceptLoading: Promise<void> | null = null;
  private conceptAbort = new AbortController();
  private lastControl: 'local' | 'external' | 'replay' = 'local';
  private readonly abort = () => this.dispose();
  private readonly leave = () => {
    this.loader.cancel();
    void this.bridge.close();
  };
  private readonly keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.disposed) return;
    if (this.loader.loading) {
      this.loader.cancel();
      event.preventDefault();
    } else if (this.internalDrive) {
      this.setInternalDrive(false);
      event.preventDefault();
    } else if (this.state.detailView && this.runtime.getSnapshot().control === 'local') {
      this.dispatch({ type: 'close-detail' });
      event.preventDefault();
    }
  };
  constructor(
    private host: AircraftHost,
    private signal: AbortSignal,
    private model: THREE.Group,
    private resources: OwnedResources,
  ) {
    this.bridge = new SimulationBridge(this.runtime, {
      origin: window.location.origin,
      fetch: window.fetch.bind(window),
      eventSource: (url) => new EventSource(url),
      viewerId: `transwing_${crypto.randomUUID().replaceAll('-', '')}`,
    });
    this.loader = new RecordingLoader(this.runtime, this.bridge);
    this.rig = createModelRig(model);
    this.measurements = measureModelRig(this.rig);
    try {
      this.model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dithering = true;
      });
      this.root.name = 'Transwing_Aircraft';
      this.root.add(model);
      host.scene.add(this.root);
      this.drive = createInternalDriveInspection(model);
      this.exposure = createRotorExposure(this.rig);
      this.presentation = new TranswingPresentation(host, this.measurements);
      this.camera = new TranswingCamera(host);
      this.panel = createTranswingPanel(host.panel, {
        runtime: this.runtime,
        bridge: this.bridge,
        loader: this.loader,
        assetUrl: host.assetUrl,
        getState: () => this.state,
        dispatch: (action) => this.dispatch(action),
        manual: (patch) => this.manual(patch),
        setWireframe: (value) => {
          if (this.local()) {
            this.wireframe = value;
            this.syncLocal();
          }
        },
        setEnvironment: (value) => {
          if (this.local()) {
            this.environment = value;
            this.syncLocal();
          }
        },
        setInternalDrive: (value) => this.setInternalDrive(value),
        setAxes: (value) => {
          this.axes = value;
        },
        setAutoRotate: (value) => this.dispatch({ type: 'set', key: 'autoRotate', value }),
        setView: (view) => this.setView(view),
        resetLocal: () => this.releaseLocal(),
        prepareExternal: () => this.prepareExternal(),
        getViewSettings: () => ({ internalDrive: this.internalDrive, axes: this.axes }),
      });
      this.runtime.setReady(true);
      this.syncLocal();
      this.paint();
      this.frame(true);
      signal.addEventListener('abort', this.abort, { once: true });
      window.addEventListener('pagehide', this.leave);
      window.addEventListener('popstate', this.leave);
      window.addEventListener('keydown', this.keydown);
      signal.throwIfAborted();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private local(driver: 'demo' | 'manual' = 'demo') {
    return !this.disposed && beginLocalControl(this.runtime, this.bridge, this.loader, driver);
  }
  private dispatch(action: ExperienceAction) {
    if (!this.local()) return;
    const previous = this.state;
    if (action.type === 'tilt' && ['begin', 'scrub', 'reset'].includes(action.action.type))
      this.state = experienceReducer(this.state, { type: 'enter-tilt' });
    this.state = experienceReducer(this.state, action);
    if (this.state.detailView || this.state.exploded) this.internalDrive = false;
    if (action.type === 'play-flight') this.mode = 'flight';
    if (
      action.type === 'enter-tilt' ||
      action.type === 'tilt' ||
      action.type === 'detail' ||
      action.type === 'joint'
    )
      this.mode = 'product';
    if (action.type === 'set' && action.key === 'time') this.runtime.seekLocal(this.state.time);
    this.syncLocal();
    if (
      this.state.cameraReset !== previous.cameraReset ||
      this.state.cameraView !== previous.cameraView ||
      this.state.inspection !== previous.inspection
    )
      this.frame();
    if (this.state.detailView === 'systems') void this.loadConcept();
  }
  private manual(patch: StatePatch) {
    if (!this.local('manual')) return;
    const input = prepareManualInput(this.state, this.runtime.getSnapshot(), patch);
    this.state = input.state;
    this.runtime.setLocal(input.patch, 'manual');
  }
  private setInternalDrive(value: boolean) {
    if (this.disposed) return;
    if (value && this.runtime.getSnapshot().control === 'local') {
      if (!this.local()) return;
      this.state = experienceReducer(this.state, { type: 'enter-tilt' });
      this.state = { ...this.state, jointSide: null };
      this.syncLocal();
    }
    this.internalDrive =
      value && !this.state.detailView && !this.runtime.getSnapshot().state.display.exploded;
  }
  private prepareExternal() {
    this.state = {
      ...this.state,
      playing: false,
      tilt: { ...this.state.tilt, playing: false },
      detailView: null,
      jointSide: null,
      autoRotate: false,
    };
    this.internalDrive = false;
    this.camera.resetExternalAnchor(this.runtime.getSnapshot().state.positionM);
  }
  private async releaseLocal() {
    if (this.disposed) return;
    this.loader.cancel();
    const cleanup = this.bridge.close();
    this.state = structuredClone(INITIAL_EXPERIENCE);
    this.internalDrive = false;
    this.mode = 'product';
    this.wireframe = false;
    this.environment = 'hangar';
    this.lastControl = 'local';
    this.syncLocal();
    this.frame();
    await cleanup;
  }
  /** Convert demo intent once into the authoritative runtime, never directly into meshes. */
  private syncLocal() {
    const snapshot = this.runtime.getSnapshot();
    if (this.disposed || snapshot.control !== 'local') return;
    const state = this.state,
      stationary = state.inspection || state.tiltMode;
    const flight = getFlight(state.time);
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, stationary ? 0 : flight.yaw, stationary ? 0 : flight.bank),
    );
    let motors: MotorCommands | undefined;
    if (snapshot.driver === 'demo') {
      const rpm = stationary ? 0 : flight.rpm * 1800;
      const rearOff =
        flight.index === 4 || flight.index === 5 || (flight.index === 3 && flight.progress > 0.55);
      motors = Object.fromEntries(
        MOTOR_IDS.map((id) => [
          id,
          {
            targetRpm: id.endsWith('Rear') && rearOff ? 0 : rpm,
            enabled: rpm >= 60 && !(id.endsWith('Rear') && rearOff),
          },
        ]),
      ) as MotorCommands;
    }
    if (state.exploded) motors = newMotorCommands();
    const details = state.detailView && !state.exploded ? state.detailPose : NEUTRAL_DETAIL_POSE;
    this.runtime.setLocal({
      positionM: [
        stationary ? 0 : flight.x,
        stationary ? 0 : flight.altitude * 0.32,
        stationary ? 0 : flight.z,
      ],
      attitude: quaternion.toArray(),
      wingTilt: displayedUnfold(state),
      ...(motors ? { motors } : {}),
      ...(snapshot.driver === 'demo'
        ? { surfaces: detailSurfaces(details), hatchDeg: details.hatch }
        : {}),
      display: {
        wireframe: this.wireframe,
        exploded: state.exploded,
        environment: this.environment,
      },
      time: { paused: !state.playing && snapshot.driver !== 'manual' },
    });
  }
  private frame(immediate = false) {
    if (this.disposed) return;
    const state = this.state,
      aspect = this.camera.aspect;
    const bounds = this.measurements.bounds.clone();
    if (this.runtime.getSnapshot().state.display.exploded) {
      bounds.min.x -= 1.4;
      bounds.max.x += 1.4;
    }
    const detailBounds =
      state.detailView === 'systems'
        ? this.concept?.bounds
        : state.detailView
          ? this.measurements.detailBounds[state.detailView]
          : null;
    const joint = state.jointSide ? this.measurements.joints[state.jointSide] : null;
    const frame = state.inspection
      ? detailBounds && !detailBounds.isEmpty()
        ? getDetailInspectionFrame(detailBounds, state.detailView!, aspect)
        : joint && state.jointSide
          ? getJointInspectionFrame(
              joint.position.clone().add(new THREE.Vector3(0, this.measurements.groundOffset, 0)),
              state.jointSide,
              aspect,
              this.measurements.jointBounds[state.jointSide],
            )
          : getInspectionFrame(bounds, state.cameraView, aspect)
      : getPresentationFrame(bounds, aspect, this.mode === 'flight');
    const external = this.runtime.getSnapshot().control !== 'local';
    const offset = external
      ? new THREE.Vector3(...this.runtime.getSnapshot().state.positionM)
      : new THREE.Vector3();
    frame.position.add(offset);
    frame.target.add(offset);
    this.camera.frame(frame, state.inspection, immediate || external, offset);
  }
  private async loadConcept() {
    if (this.concept || this.conceptLoading || this.disposed) return;
    this.conceptLoading = (async () => {
      try {
        const loaded = await loadOwnedGLTF(
          this.host.assetUrl('transwing/models/nacelle-system-concept.glb?v=10'),
          this.conceptAbort.signal,
        );
        if (this.disposed) {
          loaded.resources.dispose();
          return;
        }
        const bounds = new THREE.Box3().setFromObject(loaded.scene);
        loaded.scene.position.y += -0.42 - bounds.min.y;
        loaded.scene.updateMatrixWorld(true);
        this.concept = { ...loaded, bounds: new THREE.Box3().setFromObject(loaded.scene) };
        loaded.scene.name = 'Transwing_ConceptSystems';
        this.host.scene.add(loaded.scene);
        loaded.scene.visible = this.state.detailView === 'systems';
        if (loaded.scene.visible) this.frame();
      } catch (error) {
        if (this.disposed || this.conceptAbort.signal.aborted) return;
        this.host.report(
          `独立概念模块载入失败：${error instanceof Error ? error.message : String(error)}。主机体仍可检查。`,
        );
        if (this.state.detailView === 'systems') {
          this.state = experienceReducer(this.state, { type: 'close-detail' });
          this.syncLocal();
          this.frame();
        }
      } finally {
        this.conceptLoading = null;
      }
    })();
    await this.conceptLoading;
  }
  private paint() {
    if (this.disposed) return;
    const snapshot = this.runtime.getSnapshot(),
      sample = this.runtime.getRenderSample(),
      pose = sample.state;
    this.root.position.set(
      pose.positionM[0],
      this.measurements.groundOffset +
        cargoPresentationLift(
          this.state.detailView,
          snapshot.control,
          pose.hatchDeg,
          this.measurements.detailLift,
        ) +
        pose.positionM[1],
      pose.positionM[2],
    );
    this.root.quaternion.fromArray(pose.attitude).normalize();
    this.root.updateMatrixWorld(true);
    this.root.visible = this.state.detailView !== 'systems' || !this.concept;
    if (this.concept) this.concept.scene.visible = this.state.detailView === 'systems';
    applyModelPose(this.rig, pose.wingTilt, pose.display.exploded);
    applyMotorPose(this.rig, sample.actuators);
    applySurfacePose(this.rig, pose.surfaces, pose.hatchDeg);
    if (this.lastWireframe !== pose.display.wireframe) {
      this.lastWireframe = pose.display.wireframe;
      this.model.traverse((object) => {
        if (object instanceof THREE.Mesh)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if ('wireframe' in material)
              (material as THREE.MeshStandardMaterial).wireframe = pose.display.wireframe;
      });
    }
    // ACK follows the applied authoritative model. Exposure never mutates the endpoint.
    this.runtime.markApplied(snapshot.revision);
    this.exposure?.update(sample.exposure);
    if (pose.display.exploded || this.state.detailView) this.internalDrive = false;
    this.drive?.setActive(this.internalDrive);
    if (this.lastEnvironment !== pose.display.environment) {
      this.lastEnvironment = pose.display.environment;
      this.presentation.setEnvironment(pose.display.environment);
    }
    this.presentation.update(this.root.position, pose.display.exploded);
    if (this.guideSide !== this.state.jointSide) {
      this.guide?.dispose();
      this.guideSide = this.state.jointSide;
      this.guide = this.guideSide
        ? createJointGuide(this.rig, this.guideSide, this.host.canvas)
        : null;
      if (this.guide) this.root.add(this.guide.group);
    }
    this.guide?.update(pose.wingTilt, this.camera.active, this.axes && this.root.visible);
  }
  update(dt: number, _now: number) {
    if (this.disposed) return;
    dt = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.runtime.advancePresentation(dt);
    const before = this.runtime.getSnapshot();
    if (before.control !== this.lastControl) {
      if (before.control === 'local') {
        this.state = structuredClone(INITIAL_EXPERIENCE);
        this.internalDrive = false;
        this.syncLocal();
      }
      if (before.control === 'local') this.camera.resetExternalAnchor(before.state.positionM);
      this.lastControl = before.control;
    }
    if (before.control === 'local') {
      if (this.state.tiltMode && this.state.tilt.playing)
        this.state = experienceReducer(this.state, {
          type: 'tilt',
          action: { type: 'tick', seconds: dt },
        });
      if (this.state.playing && !this.state.tiltMode) {
        const previousTime = this.state.time;
        this.state = experienceReducer(this.state, {
          type: 'advance-flight',
          seconds: dt * this.rate,
          loop: this.loop,
        });
        if (this.state.time < previousTime) this.runtime.seekLocal(this.state.time);
      }
      this.syncLocal();
      if (this.state.playing || before.driver === 'manual')
        this.runtime.stepLocal(dt * (this.state.playing ? this.rate : 1));
    } else if (before.control === 'replay') this.runtime.advanceReplay(dt);
    this.camera.setAutoRotate(this.state.autoRotate);
    this.camera.setInternal(this.internalDrive);
    this.camera.update(
      dt,
      this.runtime.getSnapshot().control !== 'local'
        ? this.runtime.getRenderSample().state.positionM
        : null,
    );
    this.paint();
    this.panel?.update();
  }
  resize() {
    if (!this.disposed) {
      this.camera.resize();
      this.presentation.resize();
    }
  }
  setQuality(quality: AircraftQuality) {
    if (!this.disposed) this.presentation.setQuality(quality);
  }
  setMode(mode: AircraftMode) {
    if (!this.local()) return;
    this.mode = mode;
    this.internalDrive = false;
    this.state = experienceReducer(this.state, {
      type: mode === 'product' ? 'enter-tilt' : 'leave-tilt',
    });
    this.state = { ...this.state, inspection: false, jointSide: null };
    this.syncLocal();
    this.frame();
  }
  playPause() {
    const snapshot = this.runtime.getSnapshot();
    if (snapshot.control === 'replay') {
      this.runtime.playReplay(!snapshot.replayPlaying);
      return;
    }
    if (snapshot.control !== 'local') return;
    if (this.mode === 'product')
      this.dispatch({
        type: 'tilt',
        action: this.state.tilt.playing
          ? { type: 'pause' }
          : {
              type: 'begin',
              direction:
                displayedUnfold(this.state) >= 1
                  ? -1
                  : displayedUnfold(this.state) <= 0
                    ? 1
                    : this.state.tilt.direction,
            },
      });
    else this.dispatch({ type: 'play-flight' });
  }
  restart() {
    if (this.runtime.getSnapshot().control === 'replay') {
      this.runtime.replayAt(0);
      return;
    }
    if (!this.local()) return;
    const mode = this.mode;
    this.runtime.resetLocal();
    this.state = structuredClone(INITIAL_EXPERIENCE);
    this.internalDrive = false;
    this.wireframe = false;
    if (mode === 'product') this.state = experienceReducer(this.state, { type: 'enter-tilt' });
    this.syncLocal();
  }
  seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    const snapshot = this.runtime.getSnapshot();
    if (snapshot.control === 'replay') {
      this.runtime.replayAt(Math.max(0, Math.min(snapshot.replayCount - 1, Math.round(seconds))));
      return;
    }
    if (snapshot.control !== 'local') return;
    if (this.mode === 'product')
      this.dispatch({
        type: 'tilt',
        action: { type: 'scrub', progress: Math.max(0, Math.min(1, seconds / 8)) },
      });
    else this.dispatch({ type: 'set', key: 'time', value: Math.max(0, Math.min(TOTAL, seconds)) });
  }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed <= 0) return;
    if (this.runtime.getSnapshot().control === 'replay') {
      this.runtime.setReplayRate(speed < 1 ? 0.1 : 1);
      return;
    }
    this.rate = Math.max(0.1, Math.min(4, speed));
    if (this.runtime.getSnapshot().control === 'local')
      this.state = experienceReducer(this.state, {
        type: 'tilt',
        action: { type: 'rate', value: speed },
      });
  }
  setLoop(loop: boolean) {
    this.loop = loop;
    if (this.runtime.getSnapshot().control === 'local')
      this.state = experienceReducer(this.state, {
        type: 'tilt',
        action: { type: 'repeat', enabled: loop },
      });
  }
  setView(view: string) {
    if (this.disposed) return;
    const lower = view.toLowerCase();
    if (lower === 'joint-l' || lower === 'joint-r') {
      const side = lower === 'joint-l' ? 'L' : 'R';
      if (this.runtime.getSnapshot().control === 'local') this.dispatch({ type: 'joint', side });
      else {
        this.state = { ...this.state, jointSide: side, detailView: null, inspection: true };
        this.frame();
      }
      return;
    }
    const mapped: CameraView =
      lower.includes('top') || lower === 'down'
        ? 'top'
        : lower.includes('front')
          ? 'front'
          : lower.includes('side') || lower.includes('left') || lower.includes('right')
            ? 'side'
            : 'perspective';
    // Camera-only commands remain available during external ownership.
    if (this.runtime.getSnapshot().control !== 'local') {
      this.state = {
        ...this.state,
        cameraView: mapped,
        inspection: mapped !== 'perspective',
        jointSide: null,
        detailView: null,
      };
      this.frame();
      return;
    }
    if (mapped === 'perspective') {
      this.state = {
        ...this.state,
        cameraView: mapped,
        inspection: false,
        jointSide: null,
        detailView: null,
      };
      this.syncLocal();
      this.frame();
    } else this.dispatch({ type: 'inspect', view: mapped });
  }
  snapshot(): AircraftSnapshot {
    const snapshot = this.runtime.getSnapshot(),
      pose = this.runtime.getRenderSample().state,
      flight = getFlight(this.state.time);
    const external = snapshot.control !== 'local',
      replay = snapshot.control === 'replay';
    const duration = replay
      ? Math.max(0, snapshot.replayCount - 1)
      : this.mode === 'product'
        ? 8
        : TOTAL;
    const time = replay
      ? snapshot.replayIndex
      : external
        ? pose.time.seconds
        : this.mode === 'product'
          ? pose.wingTilt * 8
          : this.state.time;
    return {
      ready: snapshot.ready,
      mode: this.mode,
      playing: replay
        ? snapshot.replayPlaying
        : external
          ? !pose.time.paused
          : this.mode === 'product'
            ? this.state.tilt.playing
            : this.state.playing,
      time,
      duration,
      state: external ? snapshot.control : this.mode === 'product' ? 'mechanism' : flight.phase.id,
      label: replay
        ? 'JSON 离线回放'
        : external
          ? 'Python 外部控制'
          : this.mode === 'product'
            ? `整翼 ${Math.round(pose.wingTilt * 120)}°`
            : flight.phase.label,
      speedMps: external || this.mode === 'product' ? 0 : flight.speed * 20,
      altitude: pose.positionM[1],
      lift: `${Math.round(pose.wingTilt * 100)}% 整翼展开`,
      cruise: `${MOTOR_IDS.filter((id) => snapshot.actuators[id].rpm > 0).length}/4 电机`,
      externallyControlled: external,
    };
  }
  describe() {
    return {
      id: this.id,
      source: '2ecb723',
      runtime: structuredClone(this.runtime.getSnapshot()),
      experience: structuredClone(this.state),
      camera: this.camera.describe(),
      modelBounds: this.measurements.bounds.clone(),
      internalDrive: this.internalDrive,
      conceptLoaded: !!this.concept,
      resources: this.resources.describe(),
      disposed: this.disposed,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal.removeEventListener('abort', this.abort);
    window.removeEventListener('pagehide', this.leave);
    window.removeEventListener('popstate', this.leave);
    window.removeEventListener('keydown', this.keydown);
    this.conceptAbort.abort();
    this.loader.cancel();
    this.panel?.dispose();
    this.panel = null;
    void this.bridge.close(false);
    this.runtime.dispose();
    this.camera?.dispose();
    this.drive?.dispose();
    this.guide?.dispose();
    this.guide = null;
    this.exposure?.dispose();
    this.exposure = null;
    this.root.removeFromParent();
    this.resources.dispose();
    this.concept?.scene.removeFromParent();
    this.concept?.resources.dispose();
    this.concept = null;
    this.presentation?.dispose();
  }
}
