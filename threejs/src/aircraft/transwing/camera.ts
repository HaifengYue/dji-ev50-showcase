import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AircraftHost } from '../types';
import { trackingCameraPose, type TranswingFlightView } from './flightCamera';
import {
  CAMERA_CLIP_DEFAULTS,
  CAMERA_NAVIGATION,
  resizeCameraProjection,
  syncCameraDepthRange,
} from './core/cameraNavigation';
import {
  applyCameraFrame,
  createInspectionCamera,
  translateCameraFrame,
  type getInspectionFrame,
} from './core/inspection';

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export type CameraFrame = ReturnType<typeof getInspectionFrame>;
/** Camera motion is sampled by the host's update, never a second RAF/tween clock. */
export class TranswingCamera {
  readonly perspective = new THREE.PerspectiveCamera(
    39,
    1,
    CAMERA_CLIP_DEFAULTS.near,
    CAMERA_CLIP_DEFAULTS.far,
  );
  readonly inspection = createInspectionCamera();
  active: Camera = this.perspective;
  readonly target = new THREE.Vector3();
  private controls: OrbitControls;
  private elapsed = 0;
  private transition: {
    frame: CameraFrame;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    target: THREE.Vector3;
    height: number;
    distance: number;
    toQuaternion: THREE.Quaternion;
  } | null = null;
  private disposed = false;
  private orbit = false;
  private internal = false;
  private lastExternal = new THREE.Vector3();
  view: 'free' | 'inspection' | TranswingFlightView = 'free';
  constructor(private host: AircraftHost) {
    this.controls = this.makeControls(this.active);
    host.setCamera(this.active);
  }
  get aspect() {
    return this.host.canvas.clientWidth / Math.max(1, this.host.canvas.clientHeight);
  }
  private makeControls(camera: Camera) {
    const controls = new OrbitControls(camera, this.host.canvas);
    Object.assign(controls, CAMERA_NAVIGATION);
    controls.maxPolarAngle = Math.PI;
    controls.maxDistance = 5200;
    controls.dampingFactor = 0.06;
    controls.autoRotateSpeed = 0.45;
    controls.target.copy(this.target);
    controls.enableRotate = camera === this.perspective;
    controls.enableDamping = camera === this.perspective;
    controls.addEventListener('change', () => this.target.copy(controls.target));
    return controls;
  }
  frame(
    frame: CameraFrame,
    orthographic: boolean,
    immediate = false,
    externalPosition = new THREE.Vector3(),
  ) {
    if (this.disposed) return;
    this.view = orthographic ? 'inspection' : 'free';
    frame = {
      ...frame,
      position: frame.position.clone(),
      target: frame.target.clone(),
      up: frame.up.clone(),
    };
    const previous = this.active;
    const fromPosition = previous.position.clone();
    const fromQuaternion = previous.quaternion.clone();
    const fromTarget = this.target.clone();
    let distance = fromPosition.distanceTo(fromTarget);
    const height =
      previous instanceof THREE.OrthographicCamera
        ? (previous.top - previous.bottom) / previous.zoom
        : 2 * distance * Math.tan(THREE.MathUtils.degToRad(19.5));
    if (!orthographic && previous instanceof THREE.OrthographicCamera) {
      distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(19.5)));
      fromPosition.set(0, 0, distance).applyQuaternion(fromQuaternion).add(fromTarget);
    }
    this.controls.dispose();
    this.active = orthographic ? this.inspection : this.perspective;
    this.active.position.copy(fromPosition);
    this.active.quaternion.copy(fromQuaternion);
    this.active.up.copy(previous.up);
    if (orthographic) {
      this.inspection.top = height / 2;
      this.inspection.bottom = -height / 2;
      this.inspection.left = (-height * this.aspect) / 2;
      this.inspection.right = (height * this.aspect) / 2;
      this.inspection.zoom = 1;
    }
    this.controls = this.makeControls(this.active);
    this.host.setCamera(this.active);
    this.lastExternal.copy(externalPosition);
    const destination = new THREE.PerspectiveCamera();
    destination.position.copy(frame.position);
    destination.up.copy(frame.up);
    destination.lookAt(frame.target);
    this.transition = {
      frame,
      position: fromPosition,
      quaternion: fromQuaternion,
      target: fromTarget,
      height,
      distance,
      toQuaternion: destination.quaternion.clone(),
    };
    this.elapsed = 0;
    this.controls.enabled = false;
    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.finish();
  }
  private finish() {
    if (!this.transition) return;
    const frame = this.transition.frame;
    applyCameraFrame(this.active, frame, this.aspect);
    this.target.copy(frame.target);
    this.controls.target.copy(frame.target);
    this.transition = null;
    this.controls.enabled = true;
    this.controls.update();
  }
  setAutoRotate(value: boolean) {
    this.orbit = value;
  }
  setInternal(value: boolean) {
    this.internal = value;
  }
  resetExternalAnchor(position: readonly [number, number, number]) {
    this.lastExternal.fromArray(position);
  }
  setFlightView(view: TranswingFlightView, position: THREE.Vector3, quaternion: THREE.Quaternion) {
    const pose = trackingCameraPose(view, position, quaternion);
    const distance = pose.position.distanceTo(pose.target);
    this.frame(
      { ...pose, distance, height: 2 * distance * Math.tan(THREE.MathUtils.degToRad(19.5)) },
      false,
    );
    this.view = view;
    this.lastExternal.copy(position);
  }
  update(
    dt: number,
    externalPosition: readonly [number, number, number] | null,
    attitude = new THREE.Quaternion(),
  ) {
    if (this.disposed) return;
    const tracking = !['free', 'inspection'].includes(this.view);
    if (tracking && externalPosition) {
      const pose = trackingCameraPose(
        this.view as TranswingFlightView,
        new THREE.Vector3(...externalPosition),
        attitude,
      );
      if (this.transition) {
        Object.assign(this.transition.frame, pose);
        const targetCamera = new THREE.PerspectiveCamera();
        targetCamera.position.copy(pose.position);
        targetCamera.up.copy(pose.up);
        targetCamera.lookAt(pose.target);
        this.transition.toQuaternion.copy(targetCamera.quaternion);
      } else {
        this.active.position.copy(pose.position);
        this.active.up.copy(pose.up);
        this.active.lookAt(pose.target);
        this.target.copy(pose.target);
        this.controls.target.copy(pose.target);
        this.active.updateMatrixWorld(true);
      }
      this.lastExternal.fromArray(externalPosition);
    }
    // Free observation is world-fixed, including external/Python motion. Only an
    // explicitly chosen inspection view translates its existing offset with the rig.
    if (externalPosition && this.view === 'inspection') {
      const current = new THREE.Vector3(...externalPosition);
      const delta = current.clone().sub(this.lastExternal);
      if (delta.lengthSq() !== 0) {
        if (this.transition) {
          // Translation is independent of explicit framing. Move the entire path,
          // including its start and target, so a moving aircraft never loses travel.
          this.transition.position.add(delta);
          this.transition.target.add(delta);
          this.transition.frame.position.add(delta);
          this.transition.frame.target.add(delta);
        } else {
          translateCameraFrame(this.active, this.target, delta);
          this.controls.target.copy(this.target);
        }
      }
      this.lastExternal.copy(current);
    }
    if (this.transition) {
      this.elapsed += dt;
      const p = Math.min(1, this.elapsed / 1.05);
      const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const transition = this.transition;
      this.target.lerpVectors(transition.target, transition.frame.target, t);
      this.active.quaternion.slerpQuaternions(transition.quaternion, transition.toQuaternion, t);
      const distance = THREE.MathUtils.lerp(transition.distance, transition.frame.distance, t);
      this.active.position
        .set(0, 0, distance)
        .applyQuaternion(this.active.quaternion)
        .add(this.target);
      this.active.up.set(0, 1, 0).applyQuaternion(this.active.quaternion);
      if (this.active instanceof THREE.OrthographicCamera) {
        const height = THREE.MathUtils.lerp(transition.height, transition.frame.height, t);
        this.active.left = (-height * this.aspect) / 2;
        this.active.right = (height * this.aspect) / 2;
        this.active.top = height / 2;
        this.active.bottom = -height / 2;
        this.active.updateProjectionMatrix();
      }
      this.active.updateMatrixWorld(true);
      if (p === 1) this.finish();
    }
    this.controls.enabled = !this.transition && !tracking;
    this.controls.autoRotate =
      this.orbit && !this.internal && this.view === 'free' && this.active === this.perspective;
    if (!this.transition && !tracking) this.controls.update(dt);
    // Camera clipping is local; never write shared host fog/background.
    syncCameraDepthRange(this.active, this.target);
    if (this.active.far < 9000) {
      this.active.far = 9000;
      this.active.updateProjectionMatrix();
    }
  }
  resize() {
    resizeCameraProjection(this.active, this.aspect);
  }
  describe() {
    return {
      type: this.active.type,
      view: this.view,
      position: this.active.position.toArray(),
      target: this.target.toArray(),
      zoom: this.active.zoom,
      transitioning: !!this.transition,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.transition = null;
    this.controls.dispose();
  }
}
