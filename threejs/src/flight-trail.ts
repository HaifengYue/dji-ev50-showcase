import * as T from 'three';
import { groundHeight } from './terrain';

export type TrailQuality = 'Low' | 'Medium' | 'High';
export type TrailGeneration = string | number;
export interface FlightTrailFrame {
  /** The pose owner's simulation time, in seconds. Never wall-clock time. */
  time: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  generation: TrailGeneration;
  enabled: boolean;
  /** Set for a seek, source/route change, teleport or restart, including forward seeks. */
  discontinuity?: boolean;
}
export const TRAIL_PROFILES = {
  Low: { points: 128, lifetime: 14, interval: 1 / 8 },
  Medium: { points: 256, lifetime: 20, interval: 1 / 12 },
  High: { points: 384, lifetime: 24, interval: 1 / 16 },
} as const;
const CAPACITY = TRAIL_PROFILES.High.points;
export const TRAIL_STYLE = Object.freeze({
  initialHalfWidth: 0.6,
  maxHalfWidth: 3.2,
  spreadPerSecond: 0.35,
  hazeAlpha: 0.45,
  coreAlpha: 0.45,
  fadePower: 1.25,
  headFadeStart: 0.04,
  headFadeEnd: 0.18,
});
const MIN_CLEARANCE = TRAIL_STYLE.maxHalfWidth + 0.5;
const MAX_STEP = 48;
const MAX_SPEED = 160;

/**
 * A stylized flight-path cue, not a claim that an electric aircraft produces
 * condensation. This renderer only reads world poses; it never advances time,
 * changes controls, requests animation frames or retains aircraft resources.
 */
export class FlightTrail {
  readonly group = new T.Group();
  readonly geometry = new T.BufferGeometry();
  readonly material: T.ShaderMaterial;
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private readonly samples = new Float64Array(CAPACITY * 3);
  private readonly births = new Float64Array(CAPACITY);
  private readonly positions = new Float32Array(CAPACITY * 2 * 3);
  private readonly tangents = new Float32Array(CAPACITY * 2 * 3);
  private readonly times = new Float32Array(CAPACITY * 2);
  private head = 0;
  private count = 0;
  private lastTime: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private generation: TrailGeneration | null = null;
  private quality: TrailQuality;
  private disposed = false;
  private resetCount = 0;
  private resetReason = 'created';
  private enabled = false;
  private readonly surfaceHeight: (x: number, z: number) => number;

  constructor(
    parent: T.Object3D,
    options: { quality?: TrailQuality; surfaceHeight?: (x: number, z: number) => number } = {},
  ) {
    this.quality = options.quality ?? 'Medium';
    this.surfaceHeight = options.surfaceHeight ?? groundHeight;
    const sides = new Float32Array(CAPACITY * 2);
    const indices = new Uint16Array((CAPACITY - 1) * 6);
    for (let i = 0; i < CAPACITY; i++) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
      if (i < CAPACITY - 1)
        indices.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3], i * 6);
    }
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aTangent',
      new T.BufferAttribute(this.tangents, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'aBirth',
      new T.BufferAttribute(this.times, 1).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute('aSide', new T.BufferAttribute(sides, 1));
    this.geometry.setIndex(new T.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        { uTime: { value: 0 }, uLifetime: { value: TRAIL_PROFILES[this.quality].lifetime } },
      ]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 aTangent;
        attribute float aBirth;
        attribute float aSide;
        uniform float uTime;
        uniform float uLifetime;
        varying float vSide;
        varying float vAge;
        void main() {
          vAge = max(0.0, uTime - aBirth);
          vSide = aSide;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 tangent = mat3(modelViewMatrix) * aTangent;
          // Orthographic rays stay parallel when the trail moves across the view.
          vec3 viewRay = isOrthographic ? vec3(0.0, 0.0, 1.0) : -mvPosition.xyz;
          vec3 side = cross(tangent, viewRay);
          float sideLength = length(side);
          side = sideLength > 0.0001 ? side / sideLength : vec3(1.0, 0.0, 0.0);
          float age = clamp(vAge / uLifetime, 0.0, 1.0);
          float width = mix(${TRAIL_STYLE.initialHalfWidth.toFixed(2)}, ${TRAIL_STYLE.maxHalfWidth.toFixed(2)}, 1.0 - exp(-vAge * ${TRAIL_STYLE.spreadPerSecond.toFixed(2)}));
          mvPosition.xyz += side * aSide * width;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uLifetime;
        varying float vSide;
        varying float vAge;
        void main() {
          float age = clamp(vAge / uLifetime, 0.0, 1.0);
          // A narrow core and soft white haze share one transparent draw call.
          float edge = 1.0 - smoothstep(0.1, 1.0, abs(vSide));
          float core = exp(-vSide * vSide * 18.0);
          float fade = pow(1.0 - age, ${TRAIL_STYLE.fadePower.toFixed(2)}) * smoothstep(${TRAIL_STYLE.headFadeStart.toFixed(2)}, ${TRAIL_STYLE.headFadeEnd.toFixed(2)}, vAge);
          float alpha = (${TRAIL_STYLE.hazeAlpha.toFixed(2)} * edge + ${TRAIL_STYLE.coreAlpha.toFixed(2)} * core) * fade;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(1.35, 1.4, 1.45, alpha);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: T.DoubleSide,
      fog: true,
      toneMapped: true,
    });
    this.mesh = new T.Mesh(this.geometry, this.material);
    this.mesh.name = 'White_Dissipating_Flight_Cue';
    this.mesh.frustumCulled = false;
    this.group.name = 'Flight_Trail';
    this.group.visible = false;
    this.group.add(this.mesh);
    parent.add(this.group);
  }

  reset(reason = 'explicit') {
    if (this.disposed) return;
    this.head = this.count = 0;
    this.lastTime = null;
    this.geometry.setDrawRange(0, 0);
    this.group.visible = false;
    this.resetCount++;
    this.resetReason = reason;
  }

  setQuality(quality: TrailQuality) {
    if (this.disposed || !TRAIL_PROFILES[quality]) return;
    this.quality = quality;
    this.material.uniforms.uLifetime.value = TRAIL_PROFILES[quality].lifetime;
    while (this.count > TRAIL_PROFILES[quality].points) this.dropOldest();
    if (this.lastTime !== null) this.expire(this.lastTime);
    for (let i = 0; i < this.count; i++) {
      const offset = ((this.head + i) % CAPACITY) * 3;
      if (
        !this.hasClearance(this.samples[offset], this.samples[offset + 1], this.samples[offset + 2])
      ) {
        this.reset('quality-clearance');
        return;
      }
      if (i > 0) {
        const previous = ((this.head + i - 1) % CAPACITY) * 3;
        for (let step = 1; step < 4; step++) {
          const t = step / 4;
          if (
            !this.hasClearance(
              this.samples[previous] + (this.samples[offset] - this.samples[previous]) * t,
              this.samples[previous + 1] +
                (this.samples[offset + 1] - this.samples[previous + 1]) * t,
              this.samples[previous + 2] +
                (this.samples[offset + 2] - this.samples[previous + 2]) * t,
            )
          ) {
            this.reset('quality-clearance');
            return;
          }
        }
      }
    }
    this.rebuild();
  }

  update(frame: FlightTrailFrame) {
    if (this.disposed) return;
    const { x, y, z } = frame.position;
    if (!frame.enabled) {
      if (this.enabled || this.count) this.reset('disabled');
      this.enabled = false;
      this.generation = frame.generation;
      return;
    }
    this.enabled = true;
    if (
      !Number.isFinite(frame.time) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      this.reset('invalid-pose');
      return;
    }
    if (frame.discontinuity) this.reset('discontinuity');
    else if (this.generation !== null && frame.generation !== this.generation)
      this.reset('generation');
    this.generation = frame.generation;
    if (this.lastTime !== null) {
      const dt = frame.time - this.lastTime;
      const distance = Math.hypot(x - this.lastX, y - this.lastY, z - this.lastZ);
      if (dt < 0) this.reset('time-reversed');
      else if (dt > 0.6) this.reset('time-jump');
      else if (dt === 0) {
        // Pose changes at a frozen clock are teleports, never new trail samples.
        if (distance > 0.001) this.reset('frozen-pose-change');
        else return;
      } else if (distance > MAX_STEP || distance > MAX_SPEED * dt + 1) this.reset('teleport');
    }
    this.lastTime = frame.time;
    this.lastX = x;
    this.lastY = y;
    this.lastZ = z;
    // Upload local ages, never large absolute timestamps, to GLSL float uniforms.
    this.material.uniforms.uTime.value = 0;
    this.expire(frame.time);
    if (!this.hasClearance(x, y, z)) {
      if (this.count) this.reset('ground-clearance');
      return;
    }
    let append = this.count === 0;
    if (this.count) {
      const newest = (this.head + this.count - 1) % CAPACITY;
      const offset = newest * 3;
      const elapsed = frame.time - this.births[newest];
      const distance = Math.hypot(
        x - this.samples[offset],
        y - this.samples[offset + 1],
        z - this.samples[offset + 2],
      );
      append = elapsed >= TRAIL_PROFILES[this.quality].interval && distance >= 0.25;
      if (append) {
        // Check the whole short segment; never draw through a ridge or a lake bank.
        for (let step = 1; step <= 4; step++) {
          const t = step / 4;
          const sx = this.samples[offset] + (x - this.samples[offset]) * t;
          const sy = this.samples[offset + 1] + (y - this.samples[offset + 1]) * t;
          const sz = this.samples[offset + 2] + (z - this.samples[offset + 2]) * t;
          if (!this.hasClearance(sx, sy, sz)) {
            this.reset('segment-clearance');
            this.lastTime = frame.time;
            break;
          }
        }
      }
    }
    if (append) {
      if (this.count >= TRAIL_PROFILES[this.quality].points) this.dropOldest();
      const index = (this.head + this.count) % CAPACITY;
      this.samples[index * 3] = x;
      this.samples[index * 3 + 1] = y;
      this.samples[index * 3 + 2] = z;
      this.births[index] = frame.time;
      this.count++;
    }
    this.rebuild();
  }

  /** Cover the whole maximum-width ribbon footprint, including steep lateral banks.
   * Nine fixed queries per check; no camera, pose, clock or resource ownership changes. */
  private hasClearance(x: number, y: number, z: number) {
    const radius = TRAIL_STYLE.maxHalfWidth;
    for (let ix = -1; ix <= 1; ix++)
      for (let iz = -1; iz <= 1; iz++) {
        const height = this.surfaceHeight(x + ix * radius, z + iz * radius);
        if (!Number.isFinite(height) || y < height + MIN_CLEARANCE) return false;
      }
    return true;
  }

  private dropOldest() {
    this.head = (this.head + 1) % CAPACITY;
    this.count--;
  }
  private expire(time: number) {
    while (this.count && time - this.births[this.head] >= TRAIL_PROFILES[this.quality].lifetime)
      this.dropOldest();
  }
  private rebuild() {
    for (let i = 0; i < this.count; i++) {
      const index = (this.head + i) % CAPACITY;
      const previous = (this.head + Math.max(0, i - 1)) % CAPACITY;
      const next = (this.head + Math.min(this.count - 1, i + 1)) % CAPACITY;
      for (let side = 0; side < 2; side++) {
        const vertex = i * 2 + side;
        for (let axis = 0; axis < 3; axis++) {
          this.positions[vertex * 3 + axis] = this.samples[index * 3 + axis];
          this.tangents[vertex * 3 + axis] =
            this.samples[next * 3 + axis] - this.samples[previous * 3 + axis];
        }
        this.times[vertex] = this.births[index] - (this.lastTime ?? this.births[index]);
      }
    }
    for (const name of ['position', 'aTangent', 'aBirth'])
      this.geometry.getAttribute(name).needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, this.count - 1) * 6);
    this.group.visible = this.enabled && this.count > 1;
  }

  get diagnostics() {
    let lengthM = 0;
    for (let i = 1; i < this.count; i++) {
      const a = ((this.head + i - 1) % CAPACITY) * 3,
        b = ((this.head + i) % CAPACITY) * 3;
      lengthM += Math.hypot(
        this.samples[b] - this.samples[a],
        this.samples[b + 1] - this.samples[a + 1],
        this.samples[b + 2] - this.samples[a + 2],
      );
    }
    return {
      lifetime: TRAIL_PROFILES[this.quality].lifetime,
      sampleInterval: TRAIL_PROFILES[this.quality].interval,
      historySeconds:
        this.count && this.lastTime !== null ? this.lastTime - this.births[this.head] : 0,
      oldestAge: this.count && this.lastTime !== null ? this.lastTime - this.births[this.head] : 0,
      lengthM,

      pointCount: this.count,
      capacity: CAPACITY,
      activeLimit: TRAIL_PROFILES[this.quality].points,
      lastTime: this.lastTime,
      generation: this.generation,
      quality: this.quality,
      resetCount: this.resetCount,
      resetReason: this.resetReason,
      disposed: this.disposed,
      enabled: this.enabled,
      drawCalls: this.group.visible ? 1 : 0,
      bufferBytes:
        this.samples.byteLength +
        this.births.byteLength +
        this.positions.byteLength +
        this.tangents.byteLength +
        this.times.byteLength +
        this.geometry.getAttribute('aSide').array.byteLength +
        this.geometry.index!.array.byteLength,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.reset('disposed');
    this.enabled = false;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}
