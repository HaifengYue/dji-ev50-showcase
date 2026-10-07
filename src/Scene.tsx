import {
  Suspense,
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  Grid,
  useGLTF,
  Html,
  Environment,
  Lightformer,
  Line,
} from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { gsap } from "gsap";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { SimulationRuntime } from "./simulation";
import { modelAssetUrl } from "./modelAssetRevision";
import { createRotorExposure } from "./rotorExposure";
import {
  createInternalDriveInspection,
  getInternalDriveInspectionFrame,
} from "./internalDriveInspection";
import { SCENE_LIGHTING, SCENE_TONE_MAPPING_EXPOSURE } from "./sceneLighting";
import {
  AIRCRAFT_SHADOW,
  aircraftShadowRadius,
  updateAircraftShadow,
} from "./sceneShadows";
import {
  CAMERA_NAVIGATION,
  CAMERA_CLIP_DEFAULTS,
  syncCameraDepthRange,
} from "./cameraNavigation";
import {
  createModelRig,
  applyModelPose,
  applySurfacePose,
  applyMotorPose,
  measureModelRig,
  getWingJoint,
  type ModelRig,
} from "./rig";
import {
  createInspectionCamera,
  getInspectionFrame,
  getPresentationFrame,
  getJointInspectionFrame,
  getDetailInspectionFrame,
  applyCameraFrame,
  translateCameraFrame,
  type CameraView,
} from "./inspection";
import {
  NEUTRAL_DETAIL_POSE,
  type DetailView,
  type DetailPose,
} from "./details";
export type { CameraView } from "./inspection";
export type Variant = "xp4";
type SceneProps = {
  runtime: SimulationRuntime;
  variant: Variant;
  time: number;
  tiltProgress: number | null;
  wireframe: boolean;
  internalDriveInspection: boolean;
  exploded: boolean;
  cameraView: CameraView;
  cameraReset: number;
  inspection: boolean;
  jointSide: "L" | "R" | null;
  detailView: DetailView | null;
  detailPose: DetailPose;
  showAxes: boolean;
  flightView: boolean;
  autoRotate: boolean;
  lowQuality: boolean;
  onLoaded: () => void;
  onCloseDetail: () => void;
  environment: "hangar" | "sky";
};
function Model({
  runtime,
  variant,
  time,
  tiltProgress,
  wireframe,
  internalDriveInspection,
  exploded,
  inspection,
  jointSide,
  detailView,
  detailPose,
  showAxes,
  onLoaded,
  onBounds,
}: SceneProps & {
  onBounds: (measurements: ReturnType<typeof measureModelRig>) => void;
}) {
  const { scene } = useGLTF(modelAssetUrl(variant), "/draco/", true, (loader) =>
    loader.setMeshoptDecoder(MeshoptDecoder),
  );
  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone();
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material])
          material.dithering = true;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);
  const rig = useMemo(() => createModelRig(clone), [clone]);
  const measurements = useMemo(() => measureModelRig(rig), [rig]);
  const driveInspection = useMemo(
    () => createInternalDriveInspection(clone),
    [clone],
  );
  useLayoutEffect(() => {
    driveInspection.setActive(internalDriveInspection);
    return () => driveInspection.setActive(false);
  }, [driveInspection, internalDriveInspection]);
  const exposure = useRef<ReturnType<typeof createRotorExposure> | null>(null);
  useLayoutEffect(() => {
    exposure.current = createRotorExposure(rig);
    return () => {
      exposure.current?.dispose();
      exposure.current = null;
    };
  }, [rig]);
  const groundOffset =
    measurements.groundOffset +
    (detailView === "cargo" ? measurements.detailLift : 0);
  const progress = runtime.getSnapshot().state.wingTilt;
  const root = useRef<THREE.Group>(null);
  const lastWireframe = useRef<boolean | null>(null);
  const paint = () => {
    const snapshot = runtime.getSnapshot();
    const sample = runtime.getRenderSample();
    const pose = sample.state;
    if (root.current) {
      root.current.position.set(
        pose.positionM[0],
        groundOffset + pose.positionM[1],
        pose.positionM[2],
      );
      root.current.quaternion.fromArray(pose.attitude).normalize();
      root.current.updateMatrixWorld(true);
    }
    applyModelPose(rig, pose.wingTilt, pose.display.exploded);
    applyMotorPose(rig, sample.actuators);
    applySurfacePose(rig, pose.surfaces, pose.hatchDeg);
    if (lastWireframe.current !== pose.display.wireframe) {
      lastWireframe.current = pose.display.wireframe;
      clone.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials)
          if ("wireframe" in material)
            (material as THREE.MeshStandardMaterial).wireframe =
              pose.display.wireframe;
      });
    }
    // 外部主GLB已应用权威端点后才ACK；快门层仅显示该步已有轨迹。
    // JSON中间采样没有外部ACK，也不改写记录中的权威命令终态。
    runtime.markApplied(snapshot.revision);
    exposure.current?.update(sample.exposure);
  };
  // 模型载入前收到的最新受控快照在首帧前应用，SSE不会另起渲染时钟。
  useLayoutEffect(paint);
  useLayoutEffect(() => {
    onBounds(measurements);
    onLoaded();
    runtime.setReady(true);
    paint();
    return () => {
      if (!runtime.getSnapshot().disposed) runtime.setReady(false);
    };
  }, [measurements, onBounds, onLoaded, runtime]);
  useEffect(
    () => () => {
      clone.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    },
    [clone],
  );
  useFrame(paint);
  return (
    <group
      ref={root}
      visible={detailView !== "systems"}
      position={[0, groundOffset, 0]}
    >
      <primitive object={clone} />
      {jointSide && showAxes && (
        <JointGuide rig={rig} side={jointSide} progress={progress} />
      )}
    </group>
  );
}
/** 辅助图直接读取与动画相同的轴和角度；金色图层是说明叠加，不是实体零件。 */
function JointGuide({
  rig,
  side,
  progress,
}: {
  rig: ModelRig;
  side: "L" | "R";
  progress: number;
}) {
  const guide = useMemo(() => {
    const joint = getWingJoint(rig, side);
    if (!joint) return null;
    const { position, axis, direction, angle } = joint;
    const radial = new THREE.Vector3(0, 1, 0)
      .cross(axis)
      .normalize()
      .multiplyScalar(0.66);
    const at = (fraction: number) =>
      radial
        .clone()
        .applyAxisAngle(axis, direction * angle * fraction)
        .add(position);
    return {
      position,
      axisPoints: [
        position.clone().addScaledVector(axis, -0.78),
        position.clone().addScaledVector(axis, 0.78),
      ],
      arcPoints: Array.from({ length: 49 }, (_, i) => at(i / 48)),
      at,
    };
  }, [rig, side]);
  if (!guide) return null;
  return (
    <group>
      <Line
        points={guide.axisPoints}
        color="#f2bf70"
        lineWidth={2}
        dashed
        dashSize={0.08}
        gapSize={0.045}
        depthTest={false}
        renderOrder={10}
      />
      <Line
        points={guide.arcPoints}
        color="#d7edb0"
        lineWidth={2}
        transparent
        opacity={0.72}
        depthTest={false}
        renderOrder={10}
      />
      <Line
        points={[guide.position, guide.at(progress)]}
        color="#edf6dd"
        lineWidth={1.2}
        depthTest={false}
        renderOrder={10}
      />
      <mesh position={guide.at(progress)} renderOrder={11}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshBasicMaterial color="#f5f7e9" depthTest={false} />
      </mesh>
      <Html
        zIndexRange={[2, 0]}
        position={guide.axisPoints[1]}
        center
        className="joint-axis-label"
        style={{ pointerEvents: "none" }}
      >
        倾斜旋转轴
      </Html>
      <Html
        zIndexRange={[2, 0]}
        position={guide.at(0)}
        center
        className="joint-degree-label"
        style={{ pointerEvents: "none" }}
      >
        0°
      </Html>
      <Html
        zIndexRange={[2, 0]}
        position={guide.at(1)}
        center
        className="joint-degree-label"
        style={{ pointerEvents: "none" }}
      >
        120°
      </Html>
    </group>
  );
}
/** 可选文件失效只影响独立模块，静态面板和主飞机仍可退出恢复。 */
export class ConceptBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Html center>
        <div className="concept-error" role="status">
          <strong>概念模块暂时无法载入</strong>
          <p>主机体仍可正常检查。</p>
          <button onClick={this.props.onClose}>返回主机体</button>
        </div>
      </Html>
    ) : (
      this.props.children
    );
  }
}
/** 独立概念文件按需加载，不在主机体中假造拆机位置。 */
function ConceptSystems({
  onBounds,
}: {
  onBounds: (bounds: THREE.Box3) => void;
}) {
  const { scene } = useGLTF(
    "/models/nacelle-system-concept.glb?v=10",
    "/draco/",
    true,
    (loader) => loader.setMeshoptDecoder(MeshoptDecoder),
  );
  const clone = useMemo(() => scene.clone(true), [scene]);
  const bounds = useMemo(() => {
    const result = new THREE.Box3().setFromObject(clone);
    const shift = -0.42 - result.min.y;
    clone.position.y += shift;
    clone.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(clone);
  }, [clone]);
  useLayoutEffect(() => onBounds(bounds), [bounds, onBounds]);
  return <primitive object={clone} />;
}
function AircraftSun({
  runtime,
  lowQuality,
  lighting,
  measurements,
  detailView,
}: {
  runtime: SimulationRuntime;
  lowQuality: boolean;
  lighting: (typeof SCENE_LIGHTING)["hangar"];
  measurements: ReturnType<typeof measureModelRig>;
  detailView: DetailView | null;
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const radius = useMemo(() => {
    const bounds = measurements.bounds.clone();
    for (const detail of Object.values(measurements.detailBounds))
      bounds.union(detail);
    return aircraftShadowRadius(bounds, measurements.groundOffset);
  }, [measurements]);
  const update = () => {
    if (!light.current) return;
    const pose = runtime.getRenderSample().state;
    anchor.fromArray(pose.positionM);
    anchor.y +=
      measurements.groundOffset +
      (detailView === "cargo" ? measurements.detailLift : 0);
    updateAircraftShadow(
      light.current,
      lighting.sun.position,
      anchor,
      radius,
      pose.display.exploded,
    );
  };
  useLayoutEffect(update);
  useFrame(update);
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        {...lighting.sun}
        target={target}
        castShadow={!lowQuality}
        shadow-mapSize={[AIRCRAFT_SHADOW.mapSize, AIRCRAFT_SHADOW.mapSize]}
      />
    </>
  );
}
function Ground({
  environment,
  lowQuality,
  runtime,
  measurements,
  detailView,
}: {
  environment: "hangar" | "sky";
  lowQuality: boolean;
  runtime: SimulationRuntime;
  measurements: ReturnType<typeof measureModelRig>;
  detailView: DetailView | null;
}) {
  const sky = environment === "sky";
  const lighting = SCENE_LIGHTING[environment];
  return (
    <>
      {/* 冷灰色中亮度展台区分浅色机体与白色界面，并保留表面明暗层次。 */}
      <color attach="background" args={[lighting.background]} />
      <fog attach="fog" args={[lighting.background, 30, 78]} />
      <ambientLight intensity={lighting.ambient} />
      <hemisphereLight {...lighting.hemisphere} />
      <AircraftSun
        runtime={runtime}
        lowQuality={lowQuality}
        lighting={lighting}
        measurements={measurements}
        detailView={detailView}
      />
      <pointLight {...lighting.coolFill} />
      <pointLight {...lighting.warmFill} />
      <Environment resolution={lowQuality ? 128 : 256}>
        <Lightformer
          intensity={lighting.topReflection}
          position={[0, 10, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[15, 10, 1]}
        />
        <Lightformer
          intensity={lighting.sideReflection}
          color="#cfe7ff"
          position={[-10, 4, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[8, 12, 1]}
        />
      </Environment>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.63, 0]}
        receiveShadow
      >
        <planeGeometry args={[180, 180]} />
        <meshStandardMaterial
          color={sky ? "#aabfcb" : "#a4b5c6"}
          roughness={0.82}
          metalness={0.12}
        />
      </mesh>
      <Grid
        position={[0, -0.615, 0]}
        args={[100, 100]}
        cellSize={2}
        cellThickness={0.42}
        cellColor="#879eb3"
        sectionSize={10}
        sectionThickness={0.72}
        sectionColor="#5d819f"
        fadeDistance={40}
        infiniteGrid
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
        <ringGeometry args={[5.7, 5.75, 96]} />
        <meshBasicMaterial color="#567f9f" transparent opacity={0.42} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh
          key={side}
          position={[side * 7, -0.59, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.07, 25]} />
          <meshBasicMaterial color="#598aac" />
        </mesh>
      ))}
      {Array.from({ length: 15 }, (_, i) => (
        <mesh
          key={i}
          position={[0, -0.585, (i - 7) * 5]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.15, 1.5]} />
          <meshBasicMaterial color="#dce8f3" transparent opacity={0.65} />
        </mesh>
      ))}
      {!sky && (
        <group>
          {Array.from({ length: 7 }, (_, i) => (
            <group key={i} position={[0, 0, -10 - i * 7]}>
              <mesh position={[-17, 6, 0]}>
                <boxGeometry args={[0.5, 13, 0.5]} />
                <meshStandardMaterial color="#98adbf" />
              </mesh>
              <mesh position={[17, 6, 0]}>
                <boxGeometry args={[0.5, 13, 0.5]} />
                <meshStandardMaterial color="#98adbf" />
              </mesh>
              <mesh position={[0, 12, 0]}>
                <boxGeometry args={[34, 0.4, 0.4]} />
                <meshStandardMaterial color="#a8bac9" />
              </mesh>
              <mesh position={[0, 11.7, 0]}>
                <boxGeometry args={[12, 0.05, 0.1]} />
                <meshBasicMaterial color="#eef7ff" />
              </mesh>
            </group>
          ))}
        </group>
      )}
      {!lowQuality && (
        <ContactShadows
          position={[0, -0.58, 0]}
          opacity={0.42}
          scale={26}
          blur={2.8}
          far={12}
          resolution={256}
          color="#24364b"
        />
      )}
      {sky && (
        <group position={[0, 0, -48]}>
          {Array.from({ length: 12 }, (_, i) => (
            <mesh
              key={i}
              position={[(i - 6) * 11, -1, -Math.abs(i - 6) * 3]}
              rotation={[0, i, 0]}
            >
              <coneGeometry args={[11, 5 + (i % 4), 4]} />
              <meshStandardMaterial color="#90abba" roughness={1} />
            </mesh>
          ))}
        </group>
      )}
    </>
  );
}
function CameraRig({
  runtime,
  view,
  reset,
  autoRotate,
  inspection,
  measurements,
  exploded,
  jointSide,
  flightView,
  tiltProgress,
  detailView,
  systemBounds,
  internalDriveInspection,
}: {
  runtime: SimulationRuntime;
  view: CameraView;
  reset: number;
  autoRotate: boolean;
  inspection: boolean;
  measurements: ReturnType<typeof measureModelRig>;
  exploded: boolean;
  jointSide: "L" | "R" | null;
  flightView: boolean;
  tiltProgress: number | null;
  detailView: DetailView | null;
  systemBounds: THREE.Box3 | null;
  internalDriveInspection: boolean;
}) {
  const { get, set, size, scene } = useThree();
  const [controlsReady, setControlsReady] = useState(false);
  const orbitControls = useRef<OrbitControlsImpl>(null);
  const target = useRef(new THREE.Vector3(0, 1.5, 0));
  const lastSimulationPosition = useRef(new THREE.Vector3());
  const externalControl = runtime.getSnapshot().control !== "local";
  const cameras = useMemo(
    () => ({
      flight: Object.assign(
        new THREE.PerspectiveCamera(
          39,
          1,
          CAMERA_CLIP_DEFAULTS.near,
          CAMERA_CLIP_DEFAULTS.far,
        ),
        { manual: true },
      ),
      inspection: createInspectionCamera(),
    }),
    [],
  );
  const activeCamera = inspection ? cameras.inspection : cameras.flight;
  useEffect(() => {
    const previous = get().camera;
    const fromPosition = previous.position.clone();
    const fromQuaternion = previous.quaternion.clone();
    const fromTarget = target.current.clone();
    let fromDistance = fromPosition.distanceTo(fromTarget);
    const fromHeight =
      previous instanceof THREE.OrthographicCamera
        ? (previous.top - previous.bottom) / previous.zoom
        : 2 * fromDistance * Math.tan(THREE.MathUtils.degToRad(19.5));
    if (!inspection && previous instanceof THREE.OrthographicCamera) {
      fromDistance =
        fromHeight / (2 * Math.tan(THREE.MathUtils.degToRad(19.5)));
      fromPosition
        .set(0, 0, fromDistance)
        .applyQuaternion(fromQuaternion)
        .add(fromTarget);
    }
    const aspect = size.width / Math.max(size.height, 1);
    const staticFolded = !flightView && tiltProgress === null;
    const framingBounds = (
      staticFolded && !inspection
        ? measurements.foldedBounds
        : measurements.bounds
    ).clone();
    if (exploded) {
      framingBounds.min.x -= 1.4;
      framingBounds.max.x += 1.4;
    }
    const joint = jointSide ? measurements.joints[jointSide] : null;
    const detailBounds =
      detailView === "systems"
        ? systemBounds
        : detailView
          ? measurements.detailBounds[detailView]
          : null;
    const driveFrame = internalDriveInspection
      ? getInternalDriveInspectionFrame(
          measurements.internalDriveBounds,
          measurements.jointBounds,
          aspect,
        )
      : null;
    const frame =
      driveFrame ??
      (inspection
        ? detailBounds && !detailBounds.isEmpty()
          ? getDetailInspectionFrame(detailBounds, detailView!, aspect)
          : joint && jointSide
            ? getJointInspectionFrame(
                joint.position
                  .clone()
                  .add(new THREE.Vector3(0, measurements.groundOffset, 0)),
                jointSide,
                aspect,
                measurements.jointBounds[jointSide],
              )
            : getInspectionFrame(framingBounds, view, aspect)
        : getPresentationFrame(framingBounds, aspect, flightView));
    const offset = externalControl
      ? new THREE.Vector3(...runtime.getSnapshot().state.positionM)
      : new THREE.Vector3();
    frame.position.add(offset);
    frame.target.add(offset);
    lastSimulationPosition.current.copy(offset);
    const destination = new THREE.PerspectiveCamera();
    if (!inspection) {
      cameras.flight.aspect = aspect;
      cameras.flight.updateProjectionMatrix();
    } else {
      cameras.inspection.left = (-fromHeight * aspect) / 2;
      cameras.inspection.right = (fromHeight * aspect) / 2;
      cameras.inspection.top = fromHeight / 2;
      cameras.inspection.bottom = -fromHeight / 2;
      cameras.inspection.zoom = 1;
      cameras.inspection.updateProjectionMatrix();
    }
    destination.position.copy(frame.position);
    destination.up.copy(frame.up);
    destination.lookAt(frame.target);
    const toQuaternion = destination.quaternion.clone();
    const toDistance = frame.position.distanceTo(frame.target);
    const reduced =
      externalControl ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const progress = { value: 0 };
    setControlsReady(false);
    activeCamera.position.copy(fromPosition);
    activeCamera.quaternion.copy(fromQuaternion);
    activeCamera.up.copy(previous.up);
    set({ camera: activeCamera });
    const finish = () => {
      applyCameraFrame(activeCamera, frame, aspect);
      target.current.copy(frame.target);
      setControlsReady(true);
    };
    if (reduced) {
      finish();
      return;
    }
    const tween = gsap.to(progress, {
      value: 1,
      duration: 1.05,
      ease: "power2.inOut",
      onUpdate: () => {
        const t = progress.value;
        target.current.lerpVectors(fromTarget, frame.target, t);
        activeCamera.quaternion.slerpQuaternions(
          fromQuaternion,
          toQuaternion,
          t,
        );
        activeCamera.position
          .set(0, 0, THREE.MathUtils.lerp(fromDistance, toDistance, t))
          .applyQuaternion(activeCamera.quaternion)
          .add(target.current);
        activeCamera.up.set(0, 1, 0).applyQuaternion(activeCamera.quaternion);
        if (inspection) {
          const height = THREE.MathUtils.lerp(fromHeight, frame.height, t);
          cameras.inspection.left = (-height * aspect) / 2;
          cameras.inspection.right = (height * aspect) / 2;
          cameras.inspection.top = height / 2;
          cameras.inspection.bottom = -height / 2;
          cameras.inspection.updateProjectionMatrix();
        }
        activeCamera.updateMatrixWorld(true);
      },
      onComplete: finish,
    });
    return () => {
      tween.kill();
    };
  }, [
    view,
    reset,
    runtime,
    externalControl,
    inspection,
    measurements,
    exploded,
    jointSide,
    detailView,
    systemBounds,
    internalDriveInspection,
    flightView,
    tiltProgress === null,
    activeCamera,
    cameras,
    get,
    set,
    size.width,
    size.height,
  ]);
  // 外部位移只平移镜头和目标，保持用户选择的观察方位与缩放，不启动第二个仿真时钟。
  useFrame(() => {
    syncCameraDepthRange(activeCamera, target.current, scene.fog);
    if (!externalControl || !controlsReady) return;
    const position = new THREE.Vector3(
      ...runtime.getSnapshot().state.positionM,
    );
    const delta = position.clone().sub(lastSimulationPosition.current);
    if (delta.lengthSq() === 0) return;
    translateCameraFrame(activeCamera, target.current, delta);
    const controls = get().controls as unknown as {
      target?: THREE.Vector3;
      update?: () => void;
    } | null;
    controls?.target?.copy(target.current);
    controls?.update?.();
    lastSimulationPosition.current.copy(position);
  });
  // 镜头移动期间卸下轨道控制，避免其阻尼和 GSAP 同时改写镜头。
  return controlsReady ? (
    <OrbitControls
      ref={orbitControls}
      key={`${inspection}-${view}-${reset}-${exploded}-${jointSide}-${detailView}-${internalDriveInspection}`}
      camera={activeCamera}
      target={target.current}
      makeDefault
      {...CAMERA_NAVIGATION}
      maxPolarAngle={
        inspection || internalDriveInspection ? Math.PI : Math.PI * 0.48
      }
      onChange={() => {
        // 平移/光标定点缩放会改变控制器的目标，供切换视角及外部位移继续沿用。
        if (orbitControls.current)
          target.current.copy(orbitControls.current.target);
      }}
      enableRotate={!inspection}
      autoRotate={!inspection && !internalDriveInspection && autoRotate}
      autoRotateSpeed={0.45}
      enableDamping={!inspection}
      dampingFactor={0.06}
    />
  ) : null;
}
export default function Scene(props: SceneProps) {
  const [measurements, setMeasurements] = useState<
    ReturnType<typeof measureModelRig>
  >(() => ({
    groundOffset: 0,
    bounds: new THREE.Box3(
      new THREE.Vector3(-6, -0.6, -4),
      new THREE.Vector3(6, 3, 4),
    ),
    foldedBounds: new THREE.Box3(
      new THREE.Vector3(-1.7, -0.6, -3),
      new THREE.Vector3(1.7, 2.5, 2.8),
    ),
    joints: { L: null, R: null },
    jointBounds: { L: new THREE.Box3(), R: new THREE.Box3() },
    internalDriveBounds: new THREE.Box3(),
    detailBounds: {
      wing: new THREE.Box3(),
      tail: new THREE.Box3(),
      cargo: new THREE.Box3(),
      sensors: new THREE.Box3(),
      motors: new THREE.Box3(),
      systems: new THREE.Box3(),
    },
    detailLift: 0,
  }));
  const [systemBounds, setSystemBounds] = useState<THREE.Box3 | null>(null);
  return (
    <Canvas
      shadows={!props.lowQuality}
      dpr={props.lowQuality ? [1, 1] : [1, 1.7]}
      camera={{ position: [12, 8, 14], fov: 39, ...CAMERA_CLIP_DEFAULTS }}
      gl={{
        antialias: !props.lowQuality,
        alpha: false,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: SCENE_TONE_MAPPING_EXPOSURE,
      }}
    >
      <Ground
        environment={props.runtime.getSnapshot().state.display.environment}
        lowQuality={props.lowQuality}
        runtime={props.runtime}
        measurements={measurements}
        detailView={props.detailView}
      />
      <Suspense
        fallback={
          <Html center>
            <div className="scene-loader">
              <span />
              正在装配飞行器…
            </div>
          </Html>
        }
      >
        <Model {...props} onBounds={setMeasurements} />
      </Suspense>
      {props.detailView === "systems" && (
        <ConceptBoundary onClose={props.onCloseDetail}>
          <Suspense
            fallback={
              <Html center>
                <div className="concept-error" role="status">
                  <strong>正在载入独立概念模块…</strong>
                  <button onClick={props.onCloseDetail}>返回主机体</button>
                </div>
              </Html>
            }
          >
            <ConceptSystems onBounds={setSystemBounds} />
          </Suspense>
        </ConceptBoundary>
      )}
      <CameraRig
        runtime={props.runtime}
        view={props.cameraView}
        reset={props.cameraReset}
        autoRotate={props.autoRotate}
        inspection={props.inspection && !props.internalDriveInspection}
        internalDriveInspection={props.internalDriveInspection}
        measurements={measurements}
        jointSide={props.jointSide}
        flightView={props.flightView}
        tiltProgress={props.tiltProgress}
        exploded={props.exploded}
        detailView={props.detailView}
        systemBounds={systemBounds}
      />
    </Canvas>
  );
}
