import * as THREE from "three";
import type { ModelRig } from "./rig";
import type { MotorExposure } from "./simulation";
import {
  createBladeExposureProfile,
  createExposureGeometry,
} from "./rotorExposureProfile";

/** 仅为浅色背景的显示补偿；不是物理快门覆盖率或电机参数。 */
export const ROTOR_EXPOSURE_PRESENTATION = {
  carbonColor: 0x202b35,
  contrast: 1.35,
} as const;

/** 保留0/1端点的温和单调映射，不创造新的桨影轮廓或角向纹理。 */
export function rotorExposureDisplayAlpha(
  coverage: number,
  contrast: number = ROTOR_EXPOSURE_PRESENTATION.contrast,
) {
  return 1 - Math.pow(1 - THREE.MathUtils.clamp(coverage, 0, 1), contrast);
}

export const ROTOR_EXPOSURE_VERTEX_SHADER = /* glsl */ `
  attribute vec2 rotorXY;
  attribute vec2 bladeArc;
  varying vec2 vRotorXY;
  varying vec2 vBladeArc;
  void main() {
    vRotorXY = rotorXY;
    vBladeArc = bladeArc;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const ROTOR_EXPOSURE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 phaseBounds[15];
  uniform vec3 carbonColor;
  uniform float displayContrast;
  varying vec2 vRotorXY;
  varying vec2 vBladeArc;
  const float PI = 3.141592653589793;
  // 一片叶片及其180°对置叶片的周期占据函数精确积分。
  float occupied(float angle, float width) {
    float turns = floor(angle / PI);
    return turns * width + min(angle - turns * PI, width);
  }
  float coverage(float angle, float width, vec2 bounds) {
    float lo = min(bounds.x, bounds.y), hi = max(bounds.x, bounds.y);
    float span = hi - lo;
    if (span < 0.000001) return 1.0 - step(width, mod(angle - lo, PI));
    return clamp((occupied(angle - lo, width) - occupied(angle - hi, width)) / span, 0.0, 1.0);
  }
  void main() {
    float angle = atan(vRotorXY.y, vRotorXY.x) - vBladeArc.x;
    float width = max(0.0, vBladeArc.y - vBladeArc.x);
    float alpha = 0.0;
    // 连续积分权威轨迹样本之间的区间，而非逐个绘制采样实体。
    // 每个区间只贡献1/15的时间权重，不累加全透明度的重复叶片。
    for (int i = 0; i < 15; i++) alpha += coverage(angle, width, phaseBounds[i]) / 15.0;
    if (alpha < 0.0001) discard;
    // 原始覆盖率仍归一化。最终alpha是显式显示对比度补偿，不冒充物理曝光。
    float displayAlpha = 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), displayContrast);
    gl_FragColor = vec4(carbonColor, displayAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 连续且按时间归一化的快门曝光；绝不推进或修改电机权威状态。 */
export function createRotorExposure(rig: ModelRig) {
  const rotors = rig.props.map((prop) => {
    const sources = ["A", "B"].map((leaf) => {
      const object = rig.scene.getObjectByName(`Blade_${prop.id}_${leaf}`);
      if (!object) throw new Error(`快门显示缺少实体桨叶 ${prop.id}_${leaf}`);
      return object;
    });
    const profile = createBladeExposureProfile(rig, prop);
    const material = new THREE.ShaderMaterial({
      vertexShader: ROTOR_EXPOSURE_VERTEX_SHADER,
      fragmentShader: ROTOR_EXPOSURE_FRAGMENT_SHADER,
      uniforms: {
        phaseBounds: {
          value: Array.from({ length: 15 }, () => new THREE.Vector2()),
        },
        carbonColor: {
          value: new THREE.Color(ROTOR_EXPOSURE_PRESENTATION.carbonColor),
        },
        displayContrast: { value: ROTOR_EXPOSURE_PRESENTATION.contrast },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(createExposureGeometry(profile), material);
    mesh.name = `Exposure_${prop.id}_Continuous`;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.presentationOnly = true;
    mesh.userData.normalizedShutterCoverage = true;
    mesh.userData.displayContrast = ROTOR_EXPOSURE_PRESENTATION.contrast;
    mesh.userData.profile = profile.rows;
    prop.object.add(mesh);
    return { prop, sources, mesh, material };
  });
  return {
    update(exposure: MotorExposure | null) {
      for (const { prop, sources, mesh, material } of rotors) {
        const active =
          !!exposure?.activeIds.includes(prop.id) &&
          exposure.samples.length === 16 &&
          prop.motor.fold === 0 &&
          prop.motor.rpm > 0;
        sources.forEach((source) => {
          source.visible = !active;
        });
        mesh.visible = active;
        if (!active || !exposure) continue;
        const phases = new Array<number>(16);
        phases[15] = 0;
        // 每个历史区间都小于半圈：先用正向电机标量解开相位环绕，
        // 再采用实际资产契约的有符号旋转方向。
        for (let i = 14; i >= 0; i--) {
          const delta =
            (((exposure.samples[i + 1][prop.id].phase -
              exposure.samples[i][prop.id].phase) %
              (Math.PI * 2)) +
              Math.PI * 2) %
            (Math.PI * 2);
          phases[i] = phases[i + 1] - delta;
        }
        for (let i = 0; i < 15; i++)
          material.uniforms.phaseBounds.value[i].set(
            prop.spinSign * phases[i],
            prop.spinSign * phases[i + 1],
          );
      }
      rig.scene.updateMatrixWorld(true);
    },
    dispose() {
      for (const { sources, mesh, material } of rotors) {
        sources.forEach((source) => {
          source.visible = true;
        });
        mesh.removeFromParent();
        mesh.geometry.dispose();
        material.dispose();
      }
    },
  };
}
