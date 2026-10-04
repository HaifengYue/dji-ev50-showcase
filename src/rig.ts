import {
  newMotorState,
  stepMotor,
  type MotorCommands,
  type MotorId,
  type MotorStates,
} from "./motors";
import * as THREE from "three";
import {
  DETAIL_LIMITS,
  normalizeDetailPose,
  type DetailControl,
  type DetailPose,
  type DetailView,
} from "./details";

export const GROUND_HEIGHT = -0.6;
const UP = new THREE.Vector3(0, 1, 0);
const FOLD_AXIS = new THREE.Vector3(0, 0, 1);
export const REAR_INDEX_START = 0.75;
export const REAR_FOLD_START = 0.85;
const ROTATION = new THREE.Quaternion();
const BODY_POINT = new THREE.Vector3();
const WING_POINT = new THREE.Vector3();
const BRACE_DIRECTION = new THREE.Vector3();
const WING_REFERENCE = new THREE.Vector3();
const EYE_NORMAL = new THREE.Vector3();
const BRACE_X = new THREE.Vector3();
const BRACE_Z = new THREE.Vector3();
const BRACE_BASIS = new THREE.Matrix4();

type RestNode = {
  object: THREE.Object3D;
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
};

export function createModelRig(scene: THREE.Object3D) {
  const nodes = new Map<string, RestNode>();
  scene.traverse((object) => {
    nodes.set(object.name, {
      object,
      quaternion: object.quaternion.clone(),
      position: object.position.clone(),
    });
  });
  const wings = [
    {
      name: "WingPivot_L",
      axis: new THREE.Vector3(1, 1, 1).normalize(),
      side: -1,
    },
    {
      name: "WingPivot_R",
      axis: new THREE.Vector3(-1, 1, 1).normalize(),
      side: 1,
    },
  ].map((wing) => ({ ...wing, rest: nodes.get(wing.name) }));
  const blades = [...nodes.values()].filter(({ object }) =>
    /^BladeFold_(L|R)_(Front|Rear)_[AB]$/.test(object.name),
  );
  scene.updateMatrixWorld(true);
  const props = [...nodes.values()]
    .filter(({ object }) => /^Prop_/.test(object.name))
    .map((rest) => {
      const suffix = rest.object.name.slice("Prop_".length);
      const start = nodes.get(`MotorAxisStart_${suffix}`)?.object;
      const end = nodes.get(`MotorAxisEnd_${suffix}`)?.object;
      if (!start || !end)
        throw new Error(`旋翼 ${suffix} 缺少独立电机轴线参考节点`);
      // 轴线参考随动力舱运动，但不随桨转；从真实轴端点换算至桨的原始局部坐标。
      const from = start.getWorldPosition(new THREE.Vector3());
      const axis = end.getWorldPosition(new THREE.Vector3()).sub(from);
      if (axis.lengthSq() < 1e-12)
        throw new Error(`旋翼 ${suffix} 的电机轴线长度无效`);
      const offset = rest.object
        .getWorldPosition(new THREE.Vector3())
        .sub(from);
      if (offset.cross(axis.clone().normalize()).length() > 1e-4)
        throw new Error(`旋翼 ${suffix} 的桨毂中心偏离电机轴线`);
      axis.transformDirection(rest.object.matrixWorld.clone().invert());
      // 正相位是电机标量；演示旋向与叶片手性由同一GLB契约指定。
      // 沿MotorAxisEnd正端看向Start，绕正轴+角为CCW，负角为CW。
      // 旧基线不带此契约时保留旧方向，便于同机位回归，不冒充V15。
      const spinSign = rest.object.userData.spinSign ?? 1;
      if (spinSign !== 1 && spinSign !== -1)
        throw new Error(`旋翼 ${suffix} 的演示旋向无效`);
      if (
        rest.object.userData.rotorContractVersion >= 15 &&
        (rest.object.userData.spinSign !== spinSign ||
          rest.object.userData.handedness !== spinSign ||
          rest.object.userData.directionIsIllustrative !== true ||
          ["A", "B"].some(
            (leaf) =>
              nodes.get(`Blade_${suffix}_${leaf}`)?.object.userData
                .geometryHandedness !== spinSign,
          ))
      )
        throw new Error(`旋翼 ${suffix} 的旋向与几何手性契约不一致`);
      return {
        ...rest,
        quaternion: rest.quaternion.clone().normalize(),
        axis,
        spinSign,
        id: suffix as MotorId,
        motor: newMotorState(),
        phase: 0,
      };
    });
  const details = [...nodes.values()]
    .filter(
      ({ object }) =>
        /^ControlPivot_/.test(object.name) || object.name === "CargoHoodPivot",
    )
    .map((rest) => {
      const cargo = rest.object.name === "CargoHoodPivot";
      const suffix = rest.object.name.slice("ControlPivot_".length);
      const group: DetailControl = cargo
        ? "hatch"
        : suffix.startsWith("Tail_")
          ? "tail"
          : suffix.endsWith("Inboard")
            ? "inboard"
            : "outboard";
      const prefix = cargo ? "CargoHoodAxis" : "ControlAxis";
      const postfix = cargo ? "" : `_${suffix}`;
      const start = nodes.get(`${prefix}Start${postfix}`)?.object;
      const end = nodes.get(`${prefix}End${postfix}`)?.object;
      if (!start || !end)
        throw new Error(`${rest.object.name} 缺少独立细节铰轴参考节点`);
      if (start.parent === rest.object || end.parent === rest.object)
        throw new Error(`${rest.object.name} 的轴线参考不得随活动面旋转`);
      const from = start.getWorldPosition(new THREE.Vector3());
      const axis = end.getWorldPosition(new THREE.Vector3()).sub(from);
      if (axis.lengthSq() < 1e-12)
        throw new Error(`${rest.object.name} 的细节轴线长度无效`);
      axis.normalize();
      const offset = rest.object
        .getWorldPosition(new THREE.Vector3())
        .sub(from);
      if (offset.cross(axis).length() > 1e-4)
        throw new Error(`${rest.object.name} 的原点偏离细节轴线`);
      axis.transformDirection(rest.object.matrixWorld.clone().invert());
      const sign =
        rest.object.userData.detailSign ??
        (cargo || /^(L_|Tail_L)/.test(suffix) ? 1 : -1);
      if (sign !== 1 && sign !== -1)
        throw new Error(`${rest.object.name} 的偏转方向无效`);
      const declared = rest.object.userData.detailRange ?? DETAIL_LIMITS[group];
      if (
        !Array.isArray(declared) ||
        declared.length !== 2 ||
        !declared.every(Number.isFinite) ||
        declared[0] > 0 ||
        declared[1] < 0
      )
        throw new Error(`${rest.object.name} 的细节限位无效`);
      const range = [
        Math.max(declared[0], DETAIL_LIMITS[group][0]),
        Math.min(declared[1], DETAIL_LIMITS[group][1]),
      ] as const;
      return { ...rest, group, axis, sign, range };
    });
  const spreader = nodes.get("BraceSpreader");
  const braces = (["L", "R"] as const).flatMap((side) => {
    const body = nodes.get(`BraceBody_${side}`)?.object;
    const wing = nodes.get(`BraceWing_${side}`)?.object;
    const rod = nodes.get(`BraceRod_${side}`)?.object;
    if (!body || !wing || !rod) return [];
    if (!spreader) throw new Error("连杆模型缺少共用滑架 BraceSpreader");
    const restBody = body.getWorldPosition(new THREE.Vector3());
    const restWing = wing.getWorldPosition(new THREE.Vector3());
    spreader.object.parent?.worldToLocal(restBody);
    spreader.object.parent?.worldToLocal(restWing);
    return [
      {
        side,
        body,
        wing,
        rod,
        restBody,
        length: restWing.distanceTo(restBody),
      },
    ];
  });
  const internalDrive = [
    "Drive_ScrewRotor",
    "Drive_MotorRotor",
    "Drive_PlanetRotor_0",
    "Drive_PlanetRotor_1",
    "Drive_PlanetRotor_2",
  ].flatMap((name) => {
    const rest = nodes.get(name);
    if (!rest) return [];
    const { driveAxis, screwLead, phaseRatio, phaseSign } =
      rest.object.userData;
    if (
      !spreader ||
      !Array.isArray(driveAxis) ||
      driveAxis.length !== 3 ||
      !driveAxis.every(Number.isFinite) ||
      !Number.isFinite(screwLead) ||
      screwLead <= 0 ||
      !Number.isFinite(phaseRatio) ||
      phaseRatio === 0 ||
      phaseSign !== -1 ||
      rest.object.parent === spreader.object
    )
      throw new Error("内部丝杠驱动契约无效");
    const axis = new THREE.Vector3(...(driveAxis as [number, number, number]));
    if (Math.abs(axis.length() - 1) > 1e-6)
      throw new Error("内部驱动轴必须为单位向量");
    return [{ ...rest, axis, screwLead, phaseRatio, phaseSign }];
  });
  if (internalDrive.length > 0 && internalDrive.length !== 5)
    throw new Error("内部驱动缺少电机或丝杠转轴");
  return {
    scene,
    nodes,
    wings,
    blades,
    props,
    braces,
    spreader,
    details,
    internalDrive,
  };
}

/** 固定杆长约束下，取位于翼端后方的滑架分支；不可闭合时拒绝伪造伸缩。 */
export function solveSpreaderZ(
  wing: THREE.Vector3,
  body: THREE.Vector3,
  length: number,
) {
  const transverseSquared = (wing.x - body.x) ** 2 + (wing.y - body.y) ** 2;
  const radicand = length ** 2 - transverseSquared;
  if (!Number.isFinite(radicand) || radicand < -1e-10)
    throw new Error("连杆长度不足以闭合当前翼面姿态");
  return wing.z - Math.sqrt(Math.max(0, radicand));
}

export type ModelRig = ReturnType<typeof createModelRig>;

export function applyModelPose(
  rig: ModelRig,
  unfold: number,
  exploded = false,
  animationDelta = 0,
  rpm: number | MotorCommands = 0,
) {
  // 在改写任何网格前一次验证并计算四机，非法末项也不能部分应用。
  if (
    !Number.isFinite(unfold) ||
    !Number.isFinite(animationDelta) ||
    animationDelta < 0 ||
    animationDelta > 60
  )
    throw new Error("模型姿态或时间步无效");
  if (typeof rpm === "number" && (!Number.isFinite(rpm) || rpm < 0 || rpm > 1))
    throw new Error("演示电机比例无效");
  const nextMotors = rig.props.map((prop) =>
    stepMotor(
      prop.motor,
      typeof rpm === "number"
        ? { targetRpm: rpm * 1800, enabled: rpm > 0 }
        : rpm[prop.id],
      animationDelta,
    ),
  );
  // 每帧从中立细节开始；受控状态随后应用六片独立舵面与舱盖。
  applyDetailPose(rig);
  const progress = THREE.MathUtils.clamp(unfold, 0, 1);
  for (const { rest, axis, side } of rig.wings) {
    if (!rest) continue;
    ROTATION.setFromAxisAngle(axis, (-side * Math.PI * 2 * progress) / 3);
    rest.object.quaternion.copy(rest.quaternion).premultiply(ROTATION);
    rest.object.position.copy(rest.position);
  }
  rig.props.forEach((prop, index) => {
    prop.motor = nextMotors[index];
    prop.phase = prop.motor.phase;
  });
  applyMotorPose(rig);
  rig.scene.updateMatrixWorld(true);
  // 先在装配坐标中求解整翼、滑架和两根刚性杆；每次从原始姿态计算。
  if (rig.spreader && rig.braces.length) {
    const { object, position } = rig.spreader;
    const solutions = rig.braces.map(({ wing, restBody, length }) => {
      wing.getWorldPosition(WING_POINT);
      object.parent?.worldToLocal(WING_POINT);
      return (
        solveSpreaderZ(WING_POINT, restBody, length) - restBody.z + position.z
      );
    });
    if (solutions.some((z) => Math.abs(z - solutions[0]) > 1e-6))
      throw new Error("左右连杆无法在同一滑架位置闭合");
    object.position.copy(position);
    object.position.z =
      solutions.reduce((sum, z) => sum + z, 0) / solutions.length;
    object.updateMatrixWorld(true);
  }
  // V19 同一滑架位移决定丝杠转角，导套/螺母/横梁保持一个刚体。
  // 转动组固定在机身内，不能被误置于平移滑架下。
  for (const drive of rig.internalDrive) {
    const travel = rig.spreader!.position.z - rig.spreader!.object.position.z;
    ROTATION.setFromAxisAngle(
      drive.axis,
      ((drive.phaseSign * 2 * Math.PI * travel) / drive.screwLead) *
        drive.phaseRatio,
    );
    drive.object.quaternion
      .copy(drive.quaternion)
      .multiply(ROTATION)
      .normalize();
    drive.object.position.copy(drive.position);
    drive.object.scale.set(1, 1, 1);
    drive.object.updateMatrixWorld(true);
  }
  for (const { body, wing, rod } of rig.braces) {
    body.getWorldPosition(BODY_POINT);
    wing.getWorldPosition(WING_POINT);
    rod.parent?.worldToLocal(BODY_POINT);
    rod.parent?.worldToLocal(WING_POINT);
    BRACE_DIRECTION.subVectors(WING_POINT, BODY_POINT);
    const distance = BRACE_DIRECTION.length();
    rod.position.copy(BODY_POINT);
    if (distance > 1e-8) {
      BRACE_DIRECTION.divideScalar(distance);
      // 杆眼局部 -Z 对准翼端销轴在杆截面上的投影，避免任意滚转令杆眼横穿销轴。
      // 翼端局部 +Y 是 glTF 销轴方向；先统一到连杆父级坐标，再建立完整正交基。
      WING_REFERENCE.copy(UP);
      wing.localToWorld(WING_REFERENCE);
      rod.parent?.worldToLocal(WING_REFERENCE);
      EYE_NORMAL.subVectors(WING_REFERENCE, WING_POINT);
      EYE_NORMAL.addScaledVector(
        BRACE_DIRECTION,
        -EYE_NORMAL.dot(BRACE_DIRECTION),
      );
      if (EYE_NORMAL.lengthSq() < 1e-12)
        throw new Error("翼端销轴与连杆轴重合，杆眼姿态无法确定");
      EYE_NORMAL.normalize();
      BRACE_X.crossVectors(EYE_NORMAL, BRACE_DIRECTION).normalize();
      BRACE_Z.copy(EYE_NORMAL).negate();
      rod.quaternion.setFromRotationMatrix(
        BRACE_BASIS.makeBasis(BRACE_X, BRACE_DIRECTION, BRACE_Z),
      );
    }
    rod.scale.set(1, 1, 1);
    rod.updateMatrixWorld(true);
  }
  // 拆解仅分离完整机翼；连杆与滑架保留当前装配姿态，端口可见地脱开。
  if (exploded) {
    for (const { rest, side } of rig.wings) {
      if (rest) rest.object.position.x = rest.position.x + side * 1.4;
    }
    rig.scene.updateMatrixWorld(true);
  }
}

/** 四个桨系按同一快照绘制；折叠完全独立于整翼倾转。 */
export function applyMotorPose(rig: ModelRig, states?: MotorStates) {
  for (const prop of rig.props) {
    if (states) prop.motor = { ...states[prop.id] };
    prop.phase = prop.motor.phase;
    ROTATION.setFromAxisAngle(prop.axis, prop.spinSign * prop.phase);
    prop.object.quaternion.copy(prop.quaternion).multiply(ROTATION).normalize();
    for (const blade of rig.blades.filter((item) =>
      item.object.name.startsWith(`BladeFold_${prop.id}_`),
    )) {
      const axis = blade.object.userData.foldAxis;
      const foldAxis =
        Array.isArray(axis) && axis.length === 3 && axis.every(Number.isFinite)
          ? new THREE.Vector3(...(axis as [number, number, number])).normalize()
          : FOLD_AXIS;
      const sign =
        blade.object.userData.foldSign ??
        (blade.object.name.endsWith("_A") ? 1 : -1);
      const angle = blade.object.userData.foldAngleDeg ?? 90;
      if (
        !(sign === 1 || sign === -1) ||
        !Number.isFinite(angle) ||
        angle < 0 ||
        angle > 90 ||
        foldAxis.lengthSq() < 0.5
      )
        throw new Error("折桨节点轴线或行程无效");
      ROTATION.setFromAxisAngle(
        foldAxis,
        THREE.MathUtils.degToRad(sign * angle) * prop.motor.fold,
      );
      blade.object.quaternion
        .copy(blade.quaternion)
        .multiply(ROTATION)
        .normalize();
    }
  }
  rig.scene.updateMatrixWorld(true);
}

/** 外部六舵面与舱盖独立偏转，沿原模型的真实铰轴。 */
export function applySurfacePose(
  rig: ModelRig,
  surfaces: Record<string, number>,
  hatchDeg: number,
) {
  for (const part of rig.details) {
    const key = part.object.name.slice("ControlPivot_".length);
    const degrees = part.group === "hatch" ? hatchDeg : (surfaces[key] ?? 0);
    if (
      !Number.isFinite(degrees) ||
      degrees < part.range[0] ||
      degrees > part.range[1]
    )
      throw new Error("独立舵面超出模型行程");
    ROTATION.setFromAxisAngle(
      part.axis,
      THREE.MathUtils.degToRad(degrees * part.sign),
    );
    part.object.quaternion.copy(part.quaternion).multiply(ROTATION).normalize();
    part.object.position.copy(part.position);
  }
  rig.scene.updateMatrixWorld(true);
}

/** 细节检查独立、绝对限幅驱动；不增加飞行控制律，也不累计局部旋转。 */
export function applyDetailPose(
  rig: ModelRig,
  input: Partial<DetailPose> = {},
) {
  const pose = normalizeDetailPose(input);
  for (const {
    object,
    quaternion,
    position,
    axis,
    group,
    sign,
    range,
  } of rig.details) {
    const degrees = THREE.MathUtils.clamp(pose[group], range[0], range[1]);
    ROTATION.setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees * sign));
    object.quaternion.copy(quaternion).multiply(ROTATION).normalize();
    object.position.copy(position);
  }
  rig.scene.updateMatrixWorld(true);
}

/** 读取真实驱动关节的机体局部轴，不猜测装饰网格朝向。 */
export function getWingJoint(rig: ModelRig, side: "L" | "R") {
  const wing = rig.wings.find((item) => item.name === `WingPivot_${side}`);
  if (!wing?.rest) return null;
  rig.scene.updateMatrixWorld(true);
  const pivot = wing.rest.object;
  const inverse = rig.scene.matrixWorld.clone().invert();
  const parentMatrix = pivot.parent?.matrixWorld ?? new THREE.Matrix4();
  // 使用导出轴心而非上一帧拆解偏移；从拆解转入特写时首帧也与固定轴承对齐。
  const position = wing.rest.position
    .clone()
    .applyMatrix4(parentMatrix)
    .applyMatrix4(inverse);
  const axis = wing.axis
    .clone()
    .transformDirection(parentMatrix)
    .transformDirection(inverse);
  return { position, axis, direction: -wing.side, angle: (Math.PI * 2) / 3 };
}

export function measureModelRig(rig: ModelRig) {
  applyModelPose(rig, 0);
  const groundOffset =
    GROUND_HEIGHT - new THREE.Box3().setFromObject(rig.scene).min.y;
  const foldedBounds = new THREE.Box3().setFromObject(rig.scene);
  foldedBounds.translate(new THREE.Vector3(0, groundOffset, 0));
  const joints = {
    L: getWingJoint(rig, "L"),
    R: getWingJoint(rig, "R"),
  };
  const bounds = new THREE.Box3();
  // 以真实展开网格求四个桨盘包络，独立启停不能漏掉前后桨扫掠。
  for (const prop of rig.props) prop.motor.fold = 0;
  applyMotorPose(rig);
  const sweptRotors = rig.props.map(({ object, axis }) => {
    const inverse = object.matrixWorld.clone().invert();
    const point = new THREE.Vector3();
    let radiusSquared = 0;
    let axialMin = Infinity;
    let axialMax = -Infinity;
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const positions = child.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point
          .fromBufferAttribute(positions, i)
          .applyMatrix4(child.matrixWorld)
          .applyMatrix4(inverse);
        const axial = point.dot(axis);
        axialMin = Math.min(axialMin, axial);
        axialMax = Math.max(axialMax, axial);
        radiusSquared = Math.max(
          radiusSquared,
          point.lengthSq() - axial * axial,
        );
      }
    });
    const radialU = new THREE.Vector3(
      Math.abs(axis.x) < 0.9 ? 1 : 0,
      0,
      Math.abs(axis.x) < 0.9 ? 0 : 1,
    )
      .cross(axis)
      .normalize();
    const radialV = axis.clone().cross(radialU).normalize();
    return {
      object,
      axis,
      radialU,
      radialV,
      radius: Math.sqrt(radiusSquared),
      axialMin,
      axialMax,
    };
  });
  const jointBounds = { L: new THREE.Box3(), R: new THREE.Box3() };
  const internalDriveBounds = new THREE.Box3();
  const driveObjects = [...rig.nodes.values()]
    .filter(({ object }) => /^(?:Drive_|BraceBodyCarriage_)/.test(object.name))
    .map(({ object }) => object);
  const jointObjects = Object.fromEntries(
    (["L", "R"] as const).map((side) => [
      side,
      [...rig.nodes.values()]
        .filter(
          ({ object }) =>
            new RegExp(`^(?:Root|Brace).*_${side}(?:_|$)`).test(object.name) ||
            /^BraceSpreader(?:$|_)/.test(object.name),
        )
        .map(({ object }) => object),
    ]),
  );
  // 同一机体全部转换形态共用稳定取景，切换形态时保持可比比例。
  for (let i = 0; i <= 40; i++) {
    applyModelPose(rig, i / 40);
    bounds.union(new THREE.Box3().setFromObject(rig.scene));
    for (const object of driveObjects)
      internalDriveBounds.union(new THREE.Box3().setFromObject(object));
    for (const rotor of sweptRotors) {
      const linear = new THREE.Matrix3().setFromMatrix4(
        rotor.object.matrixWorld,
      );
      const u = rotor.radialU.clone().applyMatrix3(linear);
      const v = rotor.radialV.clone().applyMatrix3(linear);
      const axial = rotor.axis.clone().applyMatrix3(linear);
      const center = rotor.axis
        .clone()
        .multiplyScalar((rotor.axialMin + rotor.axialMax) / 2)
        .applyMatrix4(rotor.object.matrixWorld);
      const halfHeight = (rotor.axialMax - rotor.axialMin) / 2;
      const extent = new THREE.Vector3(
        ...(["x", "y", "z"] as const).map(
          (coordinate) =>
            rotor.radius * Math.hypot(u[coordinate], v[coordinate]) +
            Math.abs(axial[coordinate]) * halfHeight,
        ),
      );
      bounds.expandByPoint(center.clone().sub(extent));
      bounds.expandByPoint(center.add(extent));
    }
    for (const side of ["L", "R"] as const) {
      for (const object of jointObjects[side])
        jointBounds[side].union(new THREE.Box3().setFromObject(object));
    }
  }
  for (const prop of rig.props) prop.motor = newMotorState();
  applyModelPose(rig, 0);
  const groundTranslation = new THREE.Vector3(0, groundOffset, 0);
  bounds.translate(groundTranslation);
  internalDriveBounds.translate(groundTranslation);
  for (const side of ["L", "R"] as const)
    jointBounds[side].translate(groundTranslation);
  const detailBounds = measureDetailBounds(rig);
  for (const detail of Object.values(detailBounds))
    detail.translate(groundTranslation);
  const detailLift = Number.isFinite(detailBounds.cargo.min.y)
    ? Math.max(0.18, GROUND_HEIGHT + 0.14 - detailBounds.cargo.min.y)
    : 0;
  detailBounds.cargo.translate(new THREE.Vector3(0, detailLift, 0));
  return {
    groundOffset,
    bounds,
    foldedBounds,
    joints,
    jointBounds,
    internalDriveBounds,
    detailBounds,
    detailLift,
  };
}

/** 所有细节镜头来自实际网格及限定行程包络，切换方向时不随每帧推拉镜头。 */
export function measureDetailBounds(rig: ModelRig) {
  const bounds = Object.fromEntries(
    ["wing", "tail", "cargo", "sensors", "motors", "systems"].map((view) => [
      view,
      new THREE.Box3(),
    ]),
  ) as Record<DetailView, THREE.Box3>;
  const match = (view: DetailView, object: THREE.Object3D) => {
    const name = object.name;
    if (view === "wing")
      return (
        /^ControlPivot_R_/.test(name) ||
        (object.userData.detailView === view && /_R_/.test(name))
      );
    if (object.userData.detailView === view) return true;
    if (view === "tail") return /^ControlPivot_Tail_/.test(name);
    if (view === "cargo")
      return name === "CargoHoodPivot" || /^Cargo_(?:hood|latch)/.test(name);
    if (view === "sensors") return /^PitotStaticProbe/.test(name);
    if (view === "motors")
      return /^(?:Nacelle|Motor_cowl|Motor_spindle|Prop)_R_Front$/.test(name);
    return false;
  };
  const objects = [...rig.nodes.values()].map(({ object }) => object);
  applyModelPose(rig, 1);
  for (const [view, bound] of Object.entries(bounds)) {
    for (const object of objects)
      if (match(view as DetailView, object))
        bound.union(new THREE.Box3().setFromObject(object));
    for (const part of rig.details)
      if (match(view as DetailView, part.object))
        expandDetailArcBounds(bound, part);
  }
  applyModelPose(rig, 0);
  return bounds;
}

/** 精确包含每个网格顶点的整个角度区间，而非仅依靠离散姿态样本。 */
function expandDetailArcBounds(
  bounds: THREE.Box3,
  part: ModelRig["details"][number],
) {
  const inverse = part.object.matrixWorld.clone().invert();
  const linear = new THREE.Matrix3().setFromMatrix4(part.object.matrixWorld);
  const origin = part.object.getWorldPosition(new THREE.Vector3());
  const ends = part.range
    .map((angle) => THREE.MathUtils.degToRad(angle * part.sign))
    .sort((a, b) => a - b);
  const local = new THREE.Vector3();
  part.object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positions = child.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      local
        .fromBufferAttribute(positions, index)
        .applyMatrix4(child.matrixWorld)
        .applyMatrix4(inverse);
      const axial = part.axis.clone().multiplyScalar(local.dot(part.axis));
      const cosine = local.clone().sub(axial);
      const sine = part.axis.clone().cross(cosine);
      const center = axial.applyMatrix3(linear).add(origin);
      cosine.applyMatrix3(linear);
      sine.applyMatrix3(linear);
      for (const key of ["x", "y", "z"] as const) {
        const angles = [...ends];
        const extremum = Math.atan2(sine[key], cosine[key]);
        for (let turn = -2; turn <= 2; turn++) {
          const angle = extremum + Math.PI * turn;
          if (angle > ends[0] && angle < ends[1]) angles.push(angle);
        }
        for (const angle of angles) {
          const value =
            center[key] +
            cosine[key] * Math.cos(angle) +
            sine[key] * Math.sin(angle);
          bounds.min[key] = Math.min(bounds.min[key], value);
          bounds.max[key] = Math.max(bounds.max[key], value);
        }
      }
    }
  });
}
