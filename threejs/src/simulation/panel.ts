import { ApiRequest, ApiResponse } from '../api/contracts';
import { VisualSession } from './session';
import { SceneSettings } from './scene-details';

type PageApi = { request: (request: ApiRequest) => ApiResponse };
const saveFile = (data: unknown, name: string, type: string) => {
  const url = URL.createObjectURL(
    new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export function simulationPanel(
  api: PageApi,
  session: VisualSession,
  getSceneSettings: () => SceneSettings,
) {
  const panel = document.createElement('details');
  panel.className = 'tool-section simulation-tools';
  panel.id = 'simulation-tools';
  panel.innerHTML = `
    <summary>视景仿真 <span class="sim-badge" id="sim-badge">本地</span></summary>
    <label class="field">遥测端点<select id="sim-endpoint" disabled><option value="local">本地 MAVLink 测试服务</option><option value="external">外部 MAVLink WebSocket</option></select></label>
    <div class="sim-connection"><label class="field">MAVLink 风格 WebSocket<input id="sim-url" type="url" placeholder="ws://127.0.0.1:8765" value="ws://127.0.0.1:8765" spellcheck="false" readonly disabled></label>
    <div class="sim-buttons"><button id="sim-connect" disabled>连接</button><button id="sim-disconnect" disabled>断开</button></div></div>
    <div class="sim-buttons"><button id="sim-ulog" disabled>本地 ULog 回放</button><button id="sim-sample" disabled>示例日志回放</button><button id="sim-import" disabled>导入记录</button><button id="sim-record" disabled>开始记录</button><button id="sim-export" disabled>导出记录</button></div>
    <label class="field">日志格式<select id="sim-log-format" disabled><option value="ev50-json">EV50 JSON（无损回放）</option><option value="mavlink-jsonl">MAVLink JSONL（交换）</option></select></label>
    <input id="sim-file" type="file" accept="application/json,.json,.jsonl" hidden>
    <details class="sim-diagnostics"><summary>链路诊断</summary><output id="sim-status" class="sim-status" role="status" aria-live="polite">等待模型加载</output><output id="sim-message" class="sim-message" role="status" aria-live="polite"></output></details>
    <p class="sim-hint">本地服务与外部设备使用同一 MAVLink 风格状态通道；仅驱动本页视景。记录可导出为无损 JSON 或 JSONL。</p>`;
  const scenePanel = document.createElement('details');
  scenePanel.className = 'tool-section';
  scenePanel.id = 'scene-tools';
  scenePanel.innerHTML = `
    <summary>场景与传感器</summary>
    <label class="field">能见距离<select id="scene-visibility" disabled><option value="7200">全景清晰 · 7200 m</option><option value="3600">标准远景 · 3600 m</option><option value="1200">薄雾 · 1200 m</option><option value="400">浓雾 · 400 m</option></select></label>
    <label class="field">风向袋风速 <span id="wind-readout">4 m/s</span><input id="scene-wind" type="range" min="0" max="15" step=".5" value="4" disabled></label>
    <label class="field">来风方向<select id="scene-wind-direction" disabled><option value="0">北</option><option value="30" selected>北偏东 30°</option><option value="90">东</option><option value="180">南</option><option value="270">西</option></select></label>
    <label class="toggle"><input id="scene-references" type="checkbox" disabled>坐标与相机挂点</label>
    <label class="toggle"><input id="scene-trail" type="checkbox" checked disabled>飞行轨迹</label>
    <div class="capture-actions"><button id="sim-metadata" disabled>导出场景 / 相机参数</button></div>
    <p class="sim-hint">机鼻与下视相机可在“观察视角”切换。风只影响风向袋显示。</p>`;
  document.querySelector('.right-tools')!.prepend(panel, scenePanel);
  const element = <E extends HTMLElement>(id: string) => document.getElementById(id) as E;
  const message = (text: string) => {
    element('sim-message').textContent = text;
  };
  const request = (operation: string, payload?: unknown) => {
    const result = api.request({ operation, payload });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  };
  const action = (run: () => void) => {
    try {
      run();
      message('');
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    }
  };
  element<HTMLSelectElement>('sim-endpoint').onchange = (e) => {
    const local = (e.target as HTMLSelectElement).value === 'local';
    const input = element<HTMLInputElement>('sim-url');
    if (local) input.value = 'ws://127.0.0.1:8765';
    input.readOnly = local;
  };
  element('sim-connect').onclick = () =>
    action(() => {
      request('simulation.connect', { url: element<HTMLInputElement>('sim-url').value.trim() });
    });
  element('sim-disconnect').onclick = () =>
    action(() => {
      request('simulation.disconnect');
    });
  element('sim-sample').onclick = () =>
    action(() => {
      request('simulation.replay.sample');
    });
  element('sim-ulog').onclick = async () => {
    try {
      const response = await fetch(new URL('flight-replay.json', document.baseURI));
      if (!response.ok) throw new Error('本地 ULog 回放文件不可用');
      request('simulation.replay.load', await response.text());
      message('已通过视景回放接口加载本地 ULog');
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    }
  };
  element('sim-import').onclick = () => element<HTMLInputElement>('sim-file').click();
  element<HTMLInputElement>('sim-file').onchange = async (e) => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('记录文件不能超过 16 MiB');
      request('simulation.replay.load', await file.text());
      message(`已加载 ${file.name}`);
    } catch (error) {
      message(error instanceof Error ? error.message : String(error));
    }
  };
  element('sim-record').onclick = () =>
    action(() => {
      request(
        session.state().recording.active ? 'simulation.record.stop' : 'simulation.record.start',
      );
    });
  element('sim-export').onclick = () =>
    action(() => {
      const format = element<HTMLSelectElement>('sim-log-format').value;
      saveFile(
        request('simulation.record.export', { format }),
        format === 'mavlink-jsonl' ? 'ev50-mavlink-telemetry.jsonl' : 'ev50-visual-telemetry.json',
        format === 'mavlink-jsonl' ? 'application/x-ndjson' : 'application/json',
      );
    });
  element('sim-metadata').onclick = () =>
    action(() => {
      saveFile(
        {
          version: 1,
          scene: request('scene.describe'),
          aircraft: request('aircraft.describe'),
          camera: request('camera.describe'),
          state: request('flight.state'),
        },
        'ev50-visual-metadata.json',
        'application/json',
      );
    });
  element<HTMLSelectElement>('scene-visibility').onchange = (e) =>
    action(() => {
      request('scene.configure', { visibility: Number((e.target as HTMLSelectElement).value) });
    });
  element<HTMLInputElement>('scene-wind').oninput = (e) =>
    action(() => {
      request('scene.configure', { windSpeed: Number((e.target as HTMLInputElement).value) });
    });
  element<HTMLSelectElement>('scene-wind-direction').onchange = (e) =>
    action(() => {
      request('scene.configure', {
        windFromDegrees: Number((e.target as HTMLSelectElement).value),
      });
    });
  element<HTMLInputElement>('scene-references').onchange = (e) =>
    action(() => {
      request('scene.configure', { references: (e.target as HTMLInputElement).checked });
    });
  element<HTMLInputElement>('scene-trail').onchange = (e) =>
    action(() => {
      request('scene.configure', { trail: (e.target as HTMLInputElement).checked });
    });
  return {
    update(ready: boolean, clearance: number) {
      if (!ready) return;
      const state = session.state(),
        external = state.source === 'external';
      const label =
        state.source === 'demo'
          ? '本地'
          : state.source === 'replay'
            ? '回放'
            : state.waiting
              ? '等待'
              : state.stale
                ? '断流'
                : state.paused
                  ? '暂停'
                  : '遥测';
      element('sim-badge').textContent = label;
      panel.dataset.stale = String(external && state.stale);
      element<HTMLButtonElement>('sim-disconnect').disabled = state.transport === 'disconnected';
      element<HTMLButtonElement>('sim-record').disabled = false;
      element('sim-record').textContent = state.recording.active ? '停止记录' : '开始记录';
      element<HTMLButtonElement>('sim-export').disabled = state.recording.count < 2;
      const age = state.ageSeconds === null ? '—' : `${(state.ageSeconds * 1000).toFixed(0)} ms`;
      element('sim-status').textContent = external
        ? `${state.transport} · 数据龄 ${age}\n接收 ${state.accepted} / 拒绝 ${state.rejected} / 缺帧 ${state.gaps}\n${state.waiting ? '等待首帧' : state.stale ? '状态已冻结，等待新数据' : '按遥测原始位姿显示'}`
        : state.source === 'replay'
          ? `回放 ${state.replay.time.toFixed(1)} / ${state.replay.duration.toFixed(1)} s`
          : '本地演示 · 可记录、导入或连接统一 MAVLink 状态通道';
      element('sim-status').textContent +=
        `\n原点净空下界 ${clearance.toFixed(1)} m · 已录 ${state.recording.count} 帧${state.recording.full ? '（达到上限，已停止）' : ''}`;
      if (state.lastError) message(state.lastError);
      const settings = getSceneSettings();
      element('wind-readout').textContent = `${settings.windSpeed} m/s`;
      element<HTMLInputElement>('scene-wind').value = String(settings.windSpeed);
      element<HTMLInputElement>('scene-references').checked = settings.references;
      element<HTMLInputElement>('scene-trail').checked = settings.trail;
      element<HTMLSelectElement>('scene-visibility').value = String(settings.visibility);
      element<HTMLSelectElement>('scene-wind-direction').value = String(settings.windFromDegrees);
      element<HTMLSelectElement>('sim-log-format').disabled = false;
    },
  };
}
