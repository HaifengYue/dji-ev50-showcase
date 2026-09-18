import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Options = {
  canvas: HTMLCanvasElement;
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  scene: T.Scene;
  sun: T.DirectionalLight;
  hemisphere: T.HemisphereLight;
  setSky: (golden: boolean) => void;
  showProduct: () => void;
};

const views = {
  hero: [8, 3.6, 10],
  front: [0, 0.9, 13],
  side: [11, 1.3, 0],
  top: [0, 13, 0.001],
} satisfies Record<string, [number, number, number]>;

/** Presentation controls are deliberately separate from the flight controller. */
export function presentation(options: Options) {
  const { canvas, camera, controls, scene, sun, hemisphere } = options;
  const element = <E extends HTMLElement>(id: string) => {
    const result = document.getElementById(id);
    if (!result) throw new Error(`Missing presentation element: ${id}`);
    return result as E;
  };
  const view = element<HTMLSelectElement>('product-view');
  const orbit = element<HTMLInputElement>('auto-orbit');
  const lighting = element<HTMLSelectElement>('lighting');
  const save = element<HTMLButtonElement>('save-image');
  const record = element<HTMLButtonElement>('record-video');
  const immersive = element<HTMLButtonElement>('immersive');
  const exitImmersive = element<HTMLButtonElement>('exit-immersive');
  const stopImmersive = element<HTMLButtonElement>('stop-recording');
  const tools = element<HTMLButtonElement>('tools-toggle');
  const captureStatus = element<HTMLOutputElement>('capture-status');
  const captureDownload = element<HTMLAnchorElement>('capture-download');
  const sunOffset = new T.Vector3(-35, 65, 25);
  const fogColor = new T.Color();
  let ready = false;
  let pendingImage = false;
  let aspectScale = 1;
  let appliedLighting = '';
  let mode: 'product' | 'flight' = 'product';
  let lastDownloadUrl: string | undefined;
  let leaving = false;
  type Recording = {
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    timer?: number;
    startedAt: number;
    reason: string;
    error: boolean;
  };
  let activeRecording: Recording | undefined;

  function report(message: string) {
    captureStatus.textContent = message;
  }

  function download(blob: Blob, extension: string) {
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    lastDownloadUrl = URL.createObjectURL(blob);
    captureDownload.href = lastDownloadUrl;
    captureDownload.download = `EV50_${stamp}.${extension}`;
    captureDownload.hidden = false;
    captureDownload.textContent = `下载 ${extension.toUpperCase()} 文件`;
    captureDownload.click();
  }

  function disableOrbit() {
    orbit.checked = false;
    controls.autoRotate = false;
  }

  function placeView(name: keyof typeof views) {
    disableOrbit();
    // Flush the previous drag's damping before placing an exact preset.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update(0);
    aspectScale = Math.max(1, 1.05 / camera.aspect);
    camera.position.fromArray(views[name]).multiplyScalar(aspectScale);
    controls.target.set(0, 0.65, 0);
    controls.update(0);
    controls.enableDamping = damping;
    view.value = name;
  }

  view.onchange = () => {
    if (!ready) return;
    const name = view.value as keyof typeof views;
    if (!Object.hasOwn(views, name)) return;
    options.showProduct();
    placeView(name);
  };
  orbit.onchange = () => {
    if (!ready || !orbit.checked) return;
    options.showProduct();
    orbit.checked = true;
  };
  controls.autoRotateSpeed = 0.65;
  controls.addEventListener('start', disableOrbit);

  function setImmersive(enabled: boolean) {
    document.body.classList.toggle('immersive', enabled);
    immersive.setAttribute('aria-pressed', String(enabled));
    if (enabled) exitImmersive.focus();
    else (immersive.getClientRects().length ? immersive : tools).focus();
  }
  immersive.onclick = () => setImmersive(!document.body.classList.contains('immersive'));
  exitImmersive.onclick = () => setImmersive(false);
  tools.onclick = () => {
    const open = document.body.classList.toggle('tools-open');
    tools.setAttribute('aria-expanded', String(open));
    tools.textContent = open ? '收起设置' : '展示设置';
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.body.classList.remove('tools-open');
      tools.setAttribute('aria-expanded', 'false');
      tools.textContent = '展示设置';
      if (document.body.classList.contains('immersive')) setImmersive(false);
    }
  });

  save.onclick = () => {
    if (!ready || pendingImage) return;
    pendingImage = true;
    save.disabled = true;
    report('正在生成当前画面…');
  };

  const canRecord =
    typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
  function cleanupRecording(session: Recording) {
    window.clearTimeout(session.timer);
    session.stream.getTracks().forEach((track) => track.stop());
    session.chunks.length = 0;
    if (activeRecording === session) activeRecording = undefined;
    document.body.classList.remove('recording');
    record.textContent = '录制视频';
    record.setAttribute('aria-pressed', 'false');
    record.disabled = !ready || !canRecord;
    stopImmersive.disabled = false;
  }

  function stopRecording(reason = '') {
    const session = activeRecording;
    if (!session) return;
    session.reason = reason;
    window.clearTimeout(session.timer);
    record.disabled = stopImmersive.disabled = true;
    record.textContent = '正在保存…';
    if (session.recorder.state !== 'inactive') {
      try {
        session.recorder.stop();
      } catch (error) {
        cleanupRecording(session);
        report(`录制停止失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  record.onclick = () => {
    if (activeRecording) {
      stopRecording();
      return;
    }
    if (!ready || !canRecord) return;
    let stream: MediaStream | undefined;
    try {
      const mimeType = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('浏览器没有可用的视频编码器');
      stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
      const session: Recording = {
        recorder,
        stream,
        chunks: [],
        startedAt: performance.now(),
        reason: '',
        error: false,
      };
      activeRecording = session;
      recorder.ondataavailable = (event) => {
        if (event.data.size) session.chunks.push(event.data);
      };
      recorder.onerror = () => {
        session.error = true;
        stopRecording('编码器发生错误');
      };
      recorder.onstop = () => {
        try {
          if (!leaving) {
            if (session.error) report('视频编码失败，请降低画质后重试。');
            else if (!session.chunks.length) report('未生成视频帧，请重新录制。');
            else {
              const blob = new Blob(session.chunks, { type: recorder.mimeType || mimeType });
              const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
              download(blob, extension);
              const seconds = ((performance.now() - session.startedAt) / 1000).toFixed(1);
              report(
                `${session.reason ? session.reason + '；' : ''}已生成 ${seconds} 秒 ${extension.toUpperCase()}，可再次下载。`,
              );
            }
          }
        } catch (error) {
          report(`视频保存失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          cleanupRecording(session);
        }
      };
      recorder.start(1000);
      session.timer = window.setTimeout(() => stopRecording('达到 200 秒录制上限'), 200_000);
      record.textContent = '停止并保存';
      record.setAttribute('aria-pressed', 'true');
      document.body.classList.add('recording');
      report('录制中 · 仅三维画面 / 无音频 · 最长 200 秒');
    } catch (error) {
      if (activeRecording) cleanupRecording(activeRecording);
      else stream?.getTracks().forEach((track) => track.stop());
      report(`无法录制：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  stopImmersive.onclick = () => stopRecording();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRecording('页面转入后台，录制已停止');
  });
  canvas.addEventListener('webglcontextlost', () => {
    ready = false;
    save.disabled = record.disabled = true;
    stopRecording('图形设备连接中断');
  });
  window.addEventListener('pagehide', () => {
    leaving = true;
    stopRecording();
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  });
  window.addEventListener('pageshow', () => {
    leaving = false;
  });

  return {
    sunOffset,
    setReady() {
      ready = true;
      record.disabled = !canRecord;
      if (!canRecord) report('当前浏览器不支持画面录制，仍可保存 PNG。');
    },
    resetProductView() {
      placeView('hero');
    },
    resizeProductView() {
      const next = Math.max(1, 1.05 / camera.aspect);
      camera.position
        .sub(controls.target)
        .multiplyScalar(next / aspectScale)
        .add(controls.target);
      aspectScale = next;
      controls.update(0);
    },
    update(nextMode: 'product' | 'flight', freeCamera: boolean) {
      mode = nextMode;
      controls.autoRotate =
        ready && mode === 'product' && freeCamera && orbit.checked && !document.hidden;
      const golden = mode === 'flight' && lighting.value === 'golden';
      const key = `${mode}:${golden}`;
      if (key !== appliedLighting) {
        appliedLighting = key;
        sunOffset.set(...((golden ? [-65, 30, 25] : [-35, 65, 25]) as [number, number, number]));
        sun.color.setHex(golden ? 0xffd5a0 : 0xffefd4);
        sun.intensity = golden ? 2.25 : 2.4;
        hemisphere.color.setHex(golden ? 0xc6d5ec : 0xd6e9ff);
        hemisphere.groundColor.setHex(golden ? 0x786052 : 0x58624a);
        hemisphere.intensity = golden ? 1.1 : 1.3;
        fogColor.setHex(golden ? 0xd3baa2 : 0xa4becb);
        options.setSky(golden);
      }
      // Mode buttons can replace the fog object even when its preset is unchanged.
      if (mode === 'flight') {
        if (scene.fog) scene.fog.color.copy(fogColor);
        if (scene.background instanceof T.Color) scene.background.copy(fogColor);
      }
    },
    afterRender() {
      if (!pendingImage) return;
      pendingImage = false;
      // Snapshot immediately after the render; preserveDrawingBuffer stays off.
      try {
        canvas.toBlob((blob) => {
          try {
            if (!blob) throw new Error('浏览器未生成图像');
            if (!leaving) {
              download(blob, 'png');
              report(`已生成 ${canvas.width} × ${canvas.height} PNG，包含三维画面。`);
            }
          } catch (error) {
            report(`截图失败：${error instanceof Error ? error.message : String(error)}`);
          } finally {
            save.disabled = !ready;
          }
        }, 'image/png');
      } catch (error) {
        save.disabled = !ready;
        report(`截图失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    getState() {
      return {
        view: view.value,
        autoOrbit: controls.autoRotate,
        lighting: mode === 'product' ? 'studio' : lighting.value,
        recording: activeRecording?.recorder.state ?? 'inactive',
        cameraPosition: camera.position.toArray(),
      };
    },
  };
}
