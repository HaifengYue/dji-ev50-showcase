import * as THREE from 'three';
import type {
  AircraftHost,
  AircraftInstance,
  AircraftMode,
  AircraftQuality,
  AircraftSnapshot,
  AircraftWorldState,
} from '../types';
import {
  createModelRig,
  measureModelRig,
  applyModelPose,
  applyMotorPose,
  applySurfacePose,
} from './core/rig';
import { SimulationRuntime, applyStatePatch, type StatePatch } from './core/simulation';
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
import type { routes } from '../../flight';
import {
  TranswingWorldFlight,
  WORLD_FLIGHT_DURATION,
  TRANSWING_COORDINATES,
  bodyGroundOffset,
  worldToLegacyPosition,
  legacyToWorldPosition,
} from './worldFlight';
import { newMotorCommands, newMotorStates, type MotorCommands } from './core/motors';
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
import { createJointGuide } from './presentation';
import { createTranswingPanel } from './panel';
import { buildTranswingSnapshot } from './snapshot';
import { prepareManualInput, cargoPresentationLift } from './localControl';
import { TranswingControlAdapter } from './controlAdapter';
import type {
  AdapterAircraftState,
  AircraftControlCommand,
  ControlLease,
} from '../../control/contracts';
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
  private readonly body = new THREE.Group();
  private readonly flight: TranswingWorldFlight;
  private readonly runtime = new SimulationRuntime();
  private readonly unified = new TranswingControlAdapter(this.runtime);
  private readonly bridge: SimulationBridge;
  private readonly loader: RecordingLoader;
  private readonly rig: ReturnType<typeof createModelRig>;
  private readonly measurements: ReturnType<typeof measureModelRig>;
  private camera!: TranswingCamera;
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
  private internalDrive = false;
  private axes = true;
  private lastWireframe: boolean | null = null;
  private disposed = false;
  private applyingControl = false;
  private manualPaused = false;
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
    this.flight = new TranswingWorldFlight(host.flightFrames);
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
      this.root.name = 'Transwing_WorldDatum';
      this.body.name = 'Transwing_BodyAlignment';
      this.body.position.y = bodyGroundOffset(this.measurements.groundOffset);
      this.body.add(model);
      this.root.add(this.body);
      host.scene.add(this.root);
      this.drive = createInternalDriveInspection(model);
      this.exposure = createRotorExposure(this.rig);
      this.camera = new TranswingCamera(host);
      this.panel = createTranswingPanel(host.panel, {
        runtime: this.runtime,
        bridge: this.bridge,
        loader: this.loader,
        assetUrl: host.assetUrl,
        getState: () => this.state,
        startFlightAt: (time) => this.startFlightAt(time),
        getCameraView: () => this.camera.view,
        isUnifiedControl: () => this.unified.lease !== null,
        dispatch: (action) => this.dispatch(action),
        manual: (patch) => this.manual(patch),
        setWireframe: (value) => {
          if (this.local()) {
            this.wireframe = value;
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
      this.state = experienceReducer(this.state, { type: 'enter-tilt' });
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
    return (
      !this.disposed &&
      (!this.unified.lease || this.applyingControl) &&
      beginLocalControl(this.runtime, this.bridge, this.loader, driver)
    );
  }
  private changeMode(mode: AircraftMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.host.setSceneMode(mode);
    this.host.clearTrail();
  }
  private startFlightAt(time: number) {
    if (!this.local()) return;
    this.changeMode('flight');
    this.state = {
      ...this.state,
      time: Math.max(0, Math.min(WORLD_FLIGHT_DURATION, time)),
      playing: true,
      tiltMode: false,
      detailView: null,
      jointSide: null,
      exploded: false,
      tilt: { ...this.state.tilt, playing: false },
    };
    this.internalDrive = false;
    this.runtime.seekLocal(this.state.time);
    this.host.clearTrail();
    this.syncLocal();
  }
  private dispatch(action: ExperienceAction) {
    if (!this.local()) return;
    const previous = this.state;
    // Mechanism buttons preserve the current world pose and camera. Only explicit
    // scene selection resets the world datum; detail/inspection explicitly frame.
    if (action.type === 'play-flight') {
      const playing = !this.state.playing;
      const time = this.state.time >= WORLD_FLIGHT_DURATION ? 0 : this.state.time;
      if (this.mode !== 'flight' || this.state.tiltMode || time !== this.state.time)
        this.startFlightAt(time);
      this.state = { ...this.state, playing };
    } else {
      if (
        (action.type === 'enter-tilt' ||
          action.type === 'tilt' ||
          action.type === 'inspect' ||
          action.type === 'joint' ||
          action.type === 'detail') &&
        !this.state.tiltMode
      )
        this.state = {
          ...this.state,
          tiltMode: true,
          playing: false,
          tilt: {
            ...this.state.tilt,
            progress: this.runtime.getSnapshot().state.wingTilt,
            playing: false,
          },
        };
      this.state = experienceReducer(this.state, action);
    }
    if (this.state.detailView || this.state.exploded) this.internalDrive = false;
    if (action.type === 'set' && action.key === 'time') {
      this.state = {
        ...this.state,
        time: Math.max(0, Math.min(WORLD_FLIGHT_DURATION, this.state.time)),
      };
      this.runtime.seekLocal(this.state.time);
      this.host.clearTrail();
    }
    this.syncLocal();
    const explicitFrame =
      ['inspect', 'joint', 'detail', 'close-detail'].includes(action.type) ||
      (action.type === 'set' && ['cameraView', 'cameraReset'].includes(action.key));
    if (!explicitFrame && !(action.type === 'set' && action.key === 'autoRotate'))
      this.state = { ...this.state, autoRotate: previous.autoRotate };
    if (
      explicitFrame &&
      (this.state.cameraReset !== previous.cameraReset ||
        this.state.cameraView !== previous.cameraView ||
        this.state.inspection !== previous.inspection)
    )
      this.frame();
    if (this.state.detailView === 'systems') void this.loadConcept();
  }
  private manual(patch: StatePatch) {
    if (!this.local('manual')) return;
    const input = prepareManualInput(this.state, this.runtime.getSnapshot(), patch);
    this.state = { ...input.state, autoRotate: this.state.autoRotate };
    if (!this.applyingControl) this.manualPaused = false;
    this.runtime.setLocal(
      { ...input.patch, time: { ...input.patch.time, paused: this.manualPaused } },
      'manual',
    );
  }
  private setInternalDrive(value: boolean) {
    if (this.disposed) return;
    if (value && this.runtime.getSnapshot().control === 'local') {
      if (!this.local()) return;
      this.state = {
        ...this.state,
        tiltMode: true,
        playing: false,
        tilt: {
          ...this.state.tilt,
          progress: this.runtime.getSnapshot().state.wingTilt,
          playing: false,
        },
      };
      this.state = experienceReducer(this.state, { type: 'enter-tilt' });
      this.state = { ...this.state, jointSide: null };
      this.syncLocal();
    }
    this.internalDrive =
      value && !this.state.detailView && !this.runtime.getSnapshot().state.display.exploded;
  }
  private prepareExternal() {
    if (this.unified.lease) throw new Error('Release unified control before Python or JSON replay');
    this.changeMode('flight');
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
    if (this.unified.lease)
      throw new Error('Release unified control through the shared controls first');
    this.loader.cancel();
    const cleanup = this.bridge.close();
    this.state = structuredClone(INITIAL_EXPERIENCE);
    this.internalDrive = false;
    this.changeMode('product');
    this.wireframe = false;
    this.lastControl = 'local';
    this.state = experienceReducer(this.state, { type: 'enter-tilt' });
    this.syncLocal();
    this.frame();
    await cleanup;
  }
  /** Convert demo intent once into the authoritative runtime, never directly into meshes. */
  private syncLocal() {
    const snapshot = this.runtime.getSnapshot();
    if (this.disposed || snapshot.control !== 'local') return;
    const state = this.state;
    const moving = this.mode === 'flight' && !state.tiltMode && !state.detailView;
    const flight = this.flight.sample(state.time);
    let motors: MotorCommands | undefined;
    if (snapshot.driver === 'demo') motors = moving ? flight.motors : newMotorCommands();
    if (state.exploded) motors = newMotorCommands();
    const details = state.detailView && !state.exploded ? state.detailPose : NEUTRAL_DETAIL_POSE;
    this.runtime.setLocal({
      ...(moving
        ? {
            positionM: worldToLegacyPosition(flight.position.toArray()),
            attitude: flight.quaternion.toArray(),
          }
        : this.mode === 'product'
          ? { positionM: worldToLegacyPosition([0, 0, 0]), attitude: [0, 0, 0, 1] }
          : {}),
      wingTilt: moving ? flight.wingTilt : state.tilt.progress,
      ...(motors ? { motors } : {}),
      ...(snapshot.driver === 'demo'
        ? { surfaces: detailSurfaces(details), hatchDeg: details.hatch }
        : {}),
      display: { wireframe: this.wireframe, exploded: state.exploded },
      time: {
        ...(moving && snapshot.driver === 'demo' ? { seconds: state.time } : {}),
        paused: snapshot.driver === 'manual' ? this.manualPaused : !state.playing,
      },
    });
    if (snapshot.driver === 'demo')
      this.runtime.setLocalDemoMotors(
        moving ? this.flight.motors.sample(state.time) : newMotorStates(),
        moving && state.playing ? this.flight.motors.exposure(state.time, this.rate) : null,
      );
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
    const pose = this.runtime.getRenderSample().state;
    const offset = legacyToWorldPosition(pose.positionM);
    const attitude = new THREE.Quaternion().fromArray(pose.attitude).normalize();
    // Concept module is a stationary inspection asset, separate from moving aircraft.
    if (state.detailView !== 'systems') {
      const lift = new THREE.Vector3(0, bodyGroundOffset(this.measurements.groundOffset), 0);
      frame.position.y -= this.measurements.groundOffset;
      frame.target.y -= this.measurements.groundOffset;
      frame.position.applyQuaternion(attitude).add(lift).add(offset);
      frame.target.applyQuaternion(attitude).add(lift).add(offset);
      frame.up.applyQuaternion(attitude);
    }
    this.camera.frame(
      frame,
      state.inspection,
      immediate,
      offset.clone().add(new THREE.Vector3(0, bodyGroundOffset(this.measurements.groundOffset), 0)),
    );
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
        loaded.scene.position.y += 0.18 - bounds.min.y;
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
    this.root.position.copy(legacyToWorldPosition(pose.positionM));
    this.root.quaternion.fromArray(pose.attitude).normalize();
    // Keep the source body origin and historical Python transform exact even when
    // banked: the presentation ground lift is world-up, not a rotated body lever.
    this.body.position
      .set(
        0,
        bodyGroundOffset(this.measurements.groundOffset) +
          cargoPresentationLift(
            this.state.detailView,
            snapshot.control,
            pose.hatchDeg,
            this.measurements.detailLift,
          ),
        0,
      )
      .applyQuaternion(this.root.quaternion.clone().invert());
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
    if (this.guideSide !== this.state.jointSide) {
      this.guide?.dispose();
      this.guideSide = this.state.jointSide;
      this.guide = this.guideSide
        ? createJointGuide(this.rig, this.guideSide, this.host.canvas)
        : null;
      if (this.guide) this.body.add(this.guide.group);
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
        this.state = experienceReducer(structuredClone(INITIAL_EXPERIENCE), { type: 'enter-tilt' });
        this.changeMode('product');
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
        const next = this.state.time + dt * this.rate;
        const time =
          next >= WORLD_FLIGHT_DURATION
            ? this.loop
              ? next % WORLD_FLIGHT_DURATION
              : WORLD_FLIGHT_DURATION
            : next;
        if (time < this.state.time) {
          this.runtime.seekLocal(time);
          this.host.clearTrail();
        }
        this.state = { ...this.state, time, playing: this.loop || time < WORLD_FLIGHT_DURATION };
      }
      this.syncLocal();
      // Flight demo motors are sampled from the same absolute mission time as the pose.
      // Manual/API and replay keep their existing authoritative integration paths.
      if (before.driver === 'manual' && !this.manualPaused)
        this.runtime.stepLocal(dt * (this.state.playing ? this.rate : 1));
    } else if (before.control === 'replay') this.runtime.advanceReplay(dt);
    this.paint();
    this.camera.setAutoRotate(this.state.autoRotate);
    this.camera.setInternal(this.internalDrive);
    this.camera.update(
      dt,
      this.body.getWorldPosition(new THREE.Vector3()).toArray(),
      this.root.quaternion,
    );
    this.panel?.update();
  }
  resize() {
    if (!this.disposed) {
      this.camera.resize();
    }
  }
  setQuality(quality: AircraftQuality) {
    // Shared renderer/shadows are host-owned; model geometry remains unchanged.
    void quality;
  }
  setMode(mode: AircraftMode) {
    if (this.disposed || this.runtime.getSnapshot().control !== 'local' || this.unified.lease)
      return;
    if (mode === 'flight') {
      const enteringFlight = this.mode !== 'flight';
      // Repeated Flight clicks are inert. A paused mission resumes its existing
      // time and chosen view; only an explicit scene transition initializes follow.
      if (!enteringFlight && this.state.playing && !this.state.tiltMode) return;
      this.startFlightAt(enteringFlight ? 0 : this.state.time);
      if (enteringFlight) this.setView('follow');
      return;
    }
    if (!this.local()) return;
    this.changeMode(mode);
    this.internalDrive = false;
    this.state = experienceReducer(this.state, { type: 'enter-tilt' });
    this.state = { ...this.state, playing: false, inspection: false, jointSide: null };
    this.syncLocal();
    this.frame(); // Explicit scene selection may initialize framing; movement never does.
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
    this.host.clearTrail();
    this.manualPaused = false;
    this.state = structuredClone(INITIAL_EXPERIENCE);
    this.internalDrive = false;
    this.wireframe = false;
    if (mode === 'product') this.state = experienceReducer(this.state, { type: 'enter-tilt' });
    this.syncLocal();
  }
  seek(position: number) {
    if (!Number.isFinite(position)) return;
    const snapshot = this.runtime.getSnapshot();
    if (snapshot.control === 'replay') {
      this.runtime.replayAt(Math.max(0, Math.min(snapshot.replayCount - 1, Math.round(position))));
      return;
    }
    if (snapshot.control !== 'local') return;
    if (this.mode === 'product')
      this.dispatch({
        type: 'tilt',
        action: { type: 'scrub', progress: Math.max(0, Math.min(1, position / 100)) },
      });
    else
      this.dispatch({
        type: 'set',
        key: 'time',
        value: Math.max(0, Math.min(WORLD_FLIGHT_DURATION, position)),
      });
  }
  setSpeed(speed: number) {
    if (this.unified.lease && !this.applyingControl) return;
    if (!Number.isFinite(speed) || speed <= 0) return;
    const control = this.runtime.getSnapshot().control;
    if (control === 'external') return;
    if (control === 'replay') {
      if (speed !== 0.1 && speed !== 1) return;
      this.runtime.setReplayRate(speed);
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
    if (this.unified.lease && !this.applyingControl) return;
    if (this.runtime.getSnapshot().control !== 'local') return;
    this.loop = loop;
    this.state = experienceReducer(this.state, {
      type: 'tilt',
      action: { type: 'repeat', enabled: loop },
    });
  }
  setView(view: string) {
    if (this.disposed) return;
    const lower = view.toLowerCase();
    if (['follow', 'wide', 'fpv', 'down'].includes(lower)) {
      this.state = {
        ...this.state,
        inspection: false,
        jointSide: null,
        detailView: null,
        autoRotate: false,
      };
      this.camera.setFlightView(
        lower as 'follow' | 'wide' | 'fpv' | 'down',
        this.body.getWorldPosition(new THREE.Vector3()),
        this.root.quaternion,
      );
      return;
    }
    if (lower === 'joint-l' || lower === 'joint-r') {
      const side = lower === 'joint-l' ? 'L' : 'R';
      if (this.runtime.getSnapshot().control === 'local' && !this.unified.lease)
        this.dispatch({ type: 'joint', side });
      else {
        this.state = { ...this.state, jointSide: side, detailView: null, inspection: true };
        this.frame();
      }
      return;
    }
    const mapped: CameraView = lower.includes('top')
      ? 'top'
      : lower.includes('front')
        ? 'front'
        : lower.includes('side') || lower.includes('left') || lower.includes('right')
          ? 'side'
          : 'perspective';
    // Camera-only commands remain available during external ownership.
    if (this.runtime.getSnapshot().control !== 'local' || this.unified.lease) {
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
    const snapshot = buildTranswingSnapshot(
      this.runtime.getSnapshot(),
      this.runtime.getRenderSample().state,
      this.state,
      this.mode,
      { rate: this.rate, loop: this.loop },
      this.worldState(),
      this.flight.controller.state,
    );
    if (
      this.unified.lease?.controlMode === 'local' &&
      this.runtime.getSnapshot().driver === 'manual'
    )
      snapshot.playing = !this.runtime.getSnapshot().state.time.paused;
    if (this.unified.lease?.controlMode === 'external') {
      snapshot.label = '统一外部控制';
      snapshot.timelineLabel = '外部仿真时间';
    }
    return snapshot;
  }

  controlBlockedReason() {
    if (this.unified.lease) return undefined;
    if (this.loader.loading) return 'Transwing JSON import is pending';
    const snapshot = this.runtime.getSnapshot();
    return snapshot.control !== 'local' ||
      snapshot.connection === 'connecting' ||
      snapshot.connection === 'connected'
      ? 'Release Transwing Python or JSON replay first'
      : undefined;
  }
  setControlLease(lease: Pick<ControlLease, 'controlMode' | 'clock'> | null, _reason?: string) {
    if (this.disposed) {
      if (lease) throw new Error('Aircraft is disposed');
      return;
    }
    if (lease) {
      if (this.loader.loading) throw new Error('Wait for or cancel the pending recording import');
      this.unified.acquire(lease);
      if (lease.controlMode === 'external') {
        this.state = {
          ...this.state,
          playing: false,
          tilt: { ...this.state.tilt, playing: false },
          detailView: null,
          jointSide: null,
          autoRotate: false,
        };
        this.internalDrive = false;
        this.changeMode('flight');
      }
    } else if (this.unified.release()) {
      this.manualPaused = false;
      this.state = experienceReducer(structuredClone(INITIAL_EXPERIENCE), { type: 'enter-tilt' });
      this.internalDrive = false;
      this.wireframe = false;
      this.lastControl = 'local';
      this.changeMode('product');
      this.host.clearTrail();
      this.syncLocal();
    }
  }
  applyControl(command: AircraftControlCommand) {
    if (!this.unified.lease) throw new Error('A unified control lease is required');
    if (this.unified.lease.controlMode === 'external') {
      this.unified.external(command);
      return;
    }
    this.applyingControl = true;
    try {
      switch (command.operation) {
        case 'transport.play':
        case 'transport.pause': {
          const playing = command.operation === 'transport.play';
          if (this.runtime.getSnapshot().driver === 'manual') {
            this.manualPaused = !playing;
            this.runtime.setLocal({ time: { paused: !playing } });
          } else if (this.snapshot().playing !== playing) this.playPause();
          break;
        }
        case 'transport.reset':
          this.restart();
          break;
        case 'transport.seek':
          if (command.payload.unit !== this.snapshot().timeUnit)
            throw new Error('Timeline unit does not match current aircraft mode');
          this.seek(command.payload.position);
          break;
        case 'transport.speed':
          this.setSpeed(command.payload.speed);
          break;
        case 'transport.loop':
          this.setLoop(command.payload.loop);
          break;
        case 'transwing.mechanism': {
          // Validate the entire command atomically before changing local ownership or UI.
          const patch = command.payload;
          applyStatePatch(this.runtime.getSnapshot().state, patch);
          this.manual(patch);
          if (patch.wingTilt !== undefined)
            this.state = { ...this.state, tilt: { ...this.state.tilt, progress: patch.wingTilt } };
          break;
        }
        case 'transwing.motors':
        case 'transwing.surfaces':
          applyStatePatch(this.runtime.getSnapshot().state, command.payload);
          this.manual(command.payload);
          break;
        default:
          throw new Error(`Unsupported locally controlled operation: ${command.operation}`);
      }
    } finally {
      this.applyingControl = false;
    }
  }
  normalizedState(): AdapterAircraftState {
    const runtime = this.runtime.getSnapshot();
    const snapshot = this.snapshot();
    const world = this.worldState();
    return {
      pose: {
        positionM: world.position.toArray(),
        attitude: world.quaternion.toArray(),
        velocityMps: this.unified.velocity ? [...this.unified.velocity] : null,
      },
      clock: {
        authority:
          runtime.control === 'replay'
            ? 'replay'
            : runtime.control === 'external'
              ? 'external'
              : 'host',
        seconds:
          runtime.control === 'local' && this.mode === 'flight'
            ? this.state.time
            : runtime.state.time.seconds,
      },
      controlMode: runtime.control,
      transport: {
        playing: snapshot.playing,
        position: snapshot.time,
        duration: snapshot.duration,
        unit: snapshot.timeUnit ?? 'seconds',
        speed: snapshot.playbackRate ?? null,
        loop: snapshot.loop ?? false,
      },
      model: {
        aircraft: 'transwing',
        rotorCount: 4,
        wingTilt: runtime.state.wingTilt,
        hatchDeg: runtime.state.hatchDeg,
        motors: structuredClone(runtime.state.motors),
        surfaces: { ...runtime.state.surfaces },
      },
    };
  }

  worldState(): AircraftWorldState {
    const snapshot = this.runtime.getSnapshot();
    const pose = this.runtime.getRenderSample().state;
    const demo = snapshot.control === 'local';
    return {
      position: legacyToWorldPosition(pose.positionM),
      quaternion: new THREE.Quaternion().fromArray(pose.attitude).normalize(),
      speedMps:
        demo && this.mode === 'flight' && !this.state.tiltMode
          ? this.flight.controller.speedMps
          : this.unified.velocity && !pose.time.paused
            ? Math.hypot(...this.unified.velocity)
            : 0,
      verticalSpeedMps:
        demo && this.mode === 'flight' && !this.state.tiltMode
          ? this.flight.verticalSpeedMps
          : this.unified.velocity && !pose.time.paused
            ? this.unified.velocity[1]
            : 0,
      time: demo ? this.state.time : pose.time.seconds,
      mode: this.mode,
      routeProgress: demo && this.mode === 'flight' ? this.flight.controller.routeProgress : 0,
      path: this.flight.path,
      route: this.flight.controller.route,
      source: demo ? 'demo' : (snapshot.control as 'external' | 'replay'),
    };
  }
  setRoute(route: keyof typeof routes) {
    if (!this.local()) return;
    this.flight.setRoute(route);
    this.state = { ...this.state, time: 0, playing: false };
    this.runtime.seekLocal(0);
    this.host.clearTrail();
    this.syncLocal();
  }

  describe() {
    return {
      id: this.id,
      source: '2ecb723',
      coordinates: TRANSWING_COORDINATES,
      unifiedControl: this.unified.lease !== null,
      world: this.worldState(),
      runtime: structuredClone(this.runtime.getSnapshot()),
      experience: structuredClone(this.state),
      camera: this.camera.describe(),
      modelBounds: this.measurements.bounds.clone(),
      internalDrive: this.internalDrive,
      rotorExposureIds: this.runtime.getRenderSample().exposure?.activeIds ?? [],
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
  }
}
