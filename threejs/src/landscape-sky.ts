import * as T from 'three';

/** One distant background pass. Clouds are baked once and sampled in world directions. */
export function landscapeSky() {
  const width = 256,
    height = 128;
  const pixels = new Uint8Array(width * height * 4);
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + 50) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (u: number, v: number, frequency: number) => {
    const x = u * frequency,
      y = v * frequency;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const a = fx * fx * (3 - 2 * fx),
      b = fy * fy * (3 - 2 * fy);
    const h = (dx: number, dy: number) => hash((ix + dx + frequency) % frequency, iy + dy);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(h(0, 0), h(1, 0), a),
      T.MathUtils.lerp(h(0, 1), h(1, 1), a),
      b,
    );
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      const density = noise(u, v, 12) * 0.58 + noise(u, v, 24) * 0.28 + noise(u, v, 48) * 0.14;
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(density * 255);
      pixels[i + 3] = 255;
    }
  const texture = new T.DataTexture(pixels, width, height);
  texture.wrapS = T.RepeatWrapping;
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  const geometry = new T.PlaneGeometry(2, 2);
  const material = new T.ShaderMaterial({
    uniforms: {
      uCloud: { value: texture },
      uInverseProjection: { value: new T.Matrix4() },
      uCameraWorld: { value: new T.Matrix4() },
      uOrthographic: { value: false },
      uGolden: { value: 0 },
      uZenith: { value: new T.Color(0x328bd7) },
      uHorizon: { value: new T.Color(0x95cce9) },
    },
    vertexShader: `varying vec2 vScreen;
      void main() { vScreen = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uCloud;
      uniform mat4 uInverseProjection, uCameraWorld;
      uniform bool uOrthographic;
      uniform float uGolden;
      uniform vec3 uZenith, uHorizon;
      varying vec2 vScreen;
      void main() {
        vec4 farPoint = uInverseProjection * vec4(vScreen, 1.0, 1.0);
        vec3 viewRay = normalize(farPoint.xyz / farPoint.w);
        // Parallel rays originate at different points on a finite, distant cloud dome.
        if (uOrthographic) viewRay = normalize(vec3(farPoint.xy, -10000.0));
        vec3 direction = normalize(mat3(uCameraWorld) * viewRay);
        float elevation = max(0.0, direction.y);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(elevation * 2.0, 0.0, 1.0), 0.6));
        vec2 uv = vec2(atan(direction.z, direction.x) / 6.2831853 + 0.5, elevation * 0.85 + 0.12);
        float density = texture2D(uCloud, uv).r;
        float clouds = smoothstep(0.48, 0.65, density) * smoothstep(0.008, 0.07, elevation);
        float light = smoothstep(0.45, 0.66, texture2D(uCloud, uv + vec2(0.0, 0.012)).r);
        vec3 cloudColor = mix(vec3(0.73, 0.81, 0.88), vec3(1.0), light);
        sky = mix(sky, cloudColor, clouds * 0.94);
        sky = mix(sky, sky * vec3(1.03, 0.99, 0.94), uGolden * 0.35);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'Blue_Sky_And_Soft_White_Clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10000;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    material.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    material.uniforms.uCameraWorld.value.copy(camera.matrixWorld);
    material.uniforms.uOrthographic.value =
      (camera as T.OrthographicCamera).isOrthographicCamera === true;
  };
  let disposed = false;
  return {
    mesh,
    bufferBytes: pixels.byteLength + 140,
    setSky(golden: boolean) {
      material.uniforms.uGolden.value = golden ? 1 : 0;
    },
    dispose() {
      if (disposed) return;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      disposed = true;
    },
  };
}
