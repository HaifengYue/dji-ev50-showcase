import * as THREE from 'three';
import type { ModelRig } from './rig';
import type { MotorExposure } from './simulation';
import { createBladeExposureProfile, createExposureGeometry } from './rotorExposureProfile';

/** Bounded presentation contrast, not physical opacity, thrust or measured RPM.
 * The dark body reads against sky; a soft pale rim reads against darker terrain.
 * All detail is gated by actual shutter coverage and vanishes when exposure stops.
 */
export const ROTOR_EXPOSURE_PRESENTATION = Object.freeze({
  carbonColor: 0x14232c,
  rimColor: 0xd0e9f4,
  contrast: 4,
  fillFloor: 0.1,
  maxFillAlpha: 0.24,
  rimAlpha: 0.28,
  edgeAlpha: 0.12,
  textureAlpha: 0.055,
  maxAlpha: 0.42,
  angularSegments: 96,
  radialStride: 4,
  renderOrder: 20,
});

/** Monotone contrast transfer; raw, normalized angular coverage stays independent. */
export function rotorExposureDisplayAlpha(
  coverage: number,
  contrast: number = ROTOR_EXPOSURE_PRESENTATION.contrast,
) {
  return 1 - Math.pow(1 - THREE.MathUtils.clamp(coverage, 0, 1), contrast);
}
const smooth = (lo: number, hi: number, value: number) => {
  const t = THREE.MathUtils.clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
/** CPU reference for the shader's display-only layer. radialProgress spans the
 * real blade root-to-tip envelope. recentCoverage uses the last 3 known intervals,
 * never an invented slower phase, angle texture or future motor trajectory.
 */
export function rotorExposureStyle(
  coverage: number,
  recentCoverage: number,
  radialProgress: number,
  grazing = 0,
) {
  const p = ROTOR_EXPOSURE_PRESENTATION;
  const support = smooth(0, 0.006, coverage);
  const feather = smooth(0, 0.06, radialProgress) * (1 - smooth(0.97, 1, radialProgress));
  const rim = smooth(0.86, 0.94, radialProgress) * (1 - smooth(0.975, 1, radialProgress));
  const recent = rotorExposureDisplayAlpha(recentCoverage);
  const fill = Math.min(p.maxFillAlpha, p.fillFloor + rotorExposureDisplayAlpha(coverage) * 0.3);
  const edge = THREE.MathUtils.clamp(grazing, 0, 1) ** 2;
  return {
    alpha: Math.min(
      p.maxAlpha,
      (fill +
        p.rimAlpha * rim +
        p.edgeAlpha * edge * (0.35 + 0.65 * rim) +
        p.textureAlpha * recent * (1 - rim)) *
        support *
        feather,
    ),
    lightMix: THREE.MathUtils.clamp(rim * (0.76 + 0.24 * recent), 0, 1),
  };
}

export const ROTOR_EXPOSURE_VERTEX_SHADER = /* glsl */ `
  attribute vec2 rotorXY;
  attribute vec2 bladeArc;
  uniform vec3 rotorAxis;
  varying vec2 vRotorXY;
  varying vec2 vBladeArc;
  varying vec3 vViewDirection;
  varying vec3 vRotorAxis;
  void main() {
    vRotorXY = rotorXY;
    vBladeArc = bladeArc;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDirection = -viewPosition.xyz;
    vRotorAxis = normalize(normalMatrix * rotorAxis);
    gl_Position = projectionMatrix * viewPosition;
  }
`;
export const ROTOR_EXPOSURE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 phaseBounds[15];
  uniform vec2 radialRange;
  uniform vec3 carbonColor;
  uniform vec3 rimColor;
  uniform float displayContrast;
  uniform float fillFloor;
  uniform float maxFillAlpha;
  uniform float rimAlpha;
  uniform float edgeAlpha;
  uniform float textureAlpha;
  uniform float maxAlpha;
  varying vec2 vRotorXY;
  varying vec2 vBladeArc;
  varying vec3 vViewDirection;
  varying vec3 vRotorAxis;
  const float PI = 3.141592653589793;
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
  float displayAlpha(float value) {
    return 1.0 - pow(1.0 - clamp(value, 0.0, 1.0), displayContrast);
  }
  void main() {
    float angle = atan(vRotorXY.y, vRotorXY.x) - vBladeArc.x;
    float width = max(0.0, vBladeArc.y - vBladeArc.x);
    float rawCoverage = 0.0;
    float recentCoverage = 0.0;
    // Exact normalized integral of known intervals. The last three intervals add
    // a small real swept-blade detail; no second phase clock or random stripes.
    for (int i = 0; i < 15; i++) {
      float value = coverage(angle, width, phaseBounds[i]);
      rawCoverage += value / 15.0;
      if (i >= 12) recentCoverage += value / 3.0;
    }
    float support = smoothstep(0.0, 0.006, rawCoverage);
    float radial = (length(vRotorXY) - radialRange.x) / (radialRange.y - radialRange.x);
    float feather = smoothstep(0.0, 0.06, radial) * (1.0 - smoothstep(0.97, 1.0, radial));
    float rim = smoothstep(0.86, 0.94, radial) * (1.0 - smoothstep(0.975, 1.0, radial));
    float recent = displayAlpha(recentCoverage);
    float fill = min(maxFillAlpha, fillFloor + displayAlpha(rawCoverage) * 0.3);
    float grazing = pow(1.0 - abs(dot(normalize(vRotorAxis), normalize(vViewDirection))), 2.0);
    float alpha = min(maxAlpha, (fill + rimAlpha * rim + edgeAlpha * grazing * (0.35 + 0.65 * rim)
      + textureAlpha * recent * (1.0 - rim)) * support * feather);
    if (alpha < 0.0001) discard;
    float lightMix = clamp(rim * (0.76 + 0.24 * recent), 0.0, 1.0);
    gl_FragColor = vec4(mix(carbonColor, rimColor, lightMix), alpha);
    #include <colorspace_fragment>
  }
`;

/** Known-history shutter display only. Never advances any authoritative motor state. */
export function createRotorExposure(rig: ModelRig) {
  const presentation = ROTOR_EXPOSURE_PRESENTATION;
  const rotors = rig.props.map((prop) => {
    const sources = ['A', 'B'].map((leaf) => {
      const object = rig.scene.getObjectByName(`Blade_${prop.id}_${leaf}`);
      if (!object) throw new Error(`快门显示缺少实体桨叶 ${prop.id}_${leaf}`);
      return object;
    });
    const profile = createBladeExposureProfile(rig, prop);
    const material = new THREE.ShaderMaterial({
      vertexShader: ROTOR_EXPOSURE_VERTEX_SHADER,
      fragmentShader: ROTOR_EXPOSURE_FRAGMENT_SHADER,
      uniforms: {
        phaseBounds: { value: Array.from({ length: 15 }, () => new THREE.Vector2()) },
        rotorAxis: { value: profile.axis.clone() },
        radialRange: {
          value: new THREE.Vector2(profile.rows[0].radius, profile.rows.at(-1)!.radius),
        },
        carbonColor: { value: new THREE.Color(presentation.carbonColor) },
        rimColor: { value: new THREE.Color(presentation.rimColor) },
        displayContrast: { value: presentation.contrast },
        fillFloor: { value: presentation.fillFloor },
        maxFillAlpha: { value: presentation.maxFillAlpha },
        rimAlpha: { value: presentation.rimAlpha },
        edgeAlpha: { value: presentation.edgeAlpha },
        textureAlpha: { value: presentation.textureAlpha },
        maxAlpha: { value: presentation.maxAlpha },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(
      createExposureGeometry(profile, presentation.angularSegments, presentation.radialStride),
      material,
    );
    mesh.name = `Exposure_${prop.id}_Continuous`;
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = presentation.renderOrder;
    mesh.userData.presentationOnly = true;
    mesh.userData.normalizedShutterCoverage = true;
    mesh.userData.displayContrast = presentation.contrast;
    mesh.userData.maxDisplayAlpha = presentation.maxAlpha;
    mesh.userData.profile = profile.rows;
    mesh.userData.geometryBudget = {
      vertices: mesh.geometry.getAttribute('position').count,
      triangles: mesh.geometry.index!.count / 3,
    };
    prop.object.add(mesh);
    // Reused storage, including phase unwrap: no geometry/material/array allocation per frame.
    return { prop, sources, mesh, material, phases: new Float64Array(16) };
  });
  return {
    update(exposure: MotorExposure | null) {
      for (const { prop, sources, mesh, material, phases } of rotors) {
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
        phases[15] = 0;
        // Unwrap the received positive motor scalar, then apply the actual GLB spinSign.
        for (let i = 14; i >= 0; i--) {
          const delta =
            (((exposure.samples[i + 1][prop.id].phase - exposure.samples[i][prop.id].phase) %
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
    /** Structural budget only; renderer.info remains the source for measured frame counters. */
    describe() {
      return {
        style: 'bounded-contrast-swept-blade',
        alphaCeiling: presentation.maxAlpha,
        layers: rotors.map(({ prop, mesh }) => ({
          id: prop.id,
          visible: mesh.visible,
          vertices: mesh.geometry.getAttribute('position').count,
          triangles: mesh.geometry.index!.count / 3,
          maxAlpha: presentation.maxAlpha,
        })),
        activeIds: rotors.filter(({ mesh }) => mesh.visible).map(({ prop }) => prop.id),
        visibleTriangles: rotors.reduce(
          (sum, { mesh }) => sum + (mesh.visible ? mesh.geometry.index!.count / 3 : 0),
          0,
        ),
        visibleLayerDrawsPerMainPass: rotors.filter(({ mesh }) => mesh.visible).length,
        visibleLayerTrianglesPerMainPass: rotors.reduce(
          (sum, { mesh }) => sum + (mesh.visible ? mesh.geometry.index!.count / 3 : 0),
          0,
        ),
      };
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
