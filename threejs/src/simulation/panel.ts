import { ApiRequest, ApiResponse } from '../api/contracts';
import { VisualSession } from './session';
import { SceneSettings } from './scene-details';

type PageApi = { request: (request: ApiRequest) => ApiResponse };
const saveJson = (data: unknown, name: string) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
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
    <label class="field">状态来源<select id="sim-source" disabled><option value="demo">演示控制器</option><option value="external">外部遥测</option><option value="replay" disabled>记录回放</option></select></label>
    <div class="sim-connection"><label class="field">遥测 WebSocket<input id="sim-url" type="url" placeholder="ws://127.0.0.1:8765" value="ws://127.0.0.1:8765" spellcheck="false" disabled></label>
    <div class="sim-buttons"><button id="sim-connect" disabled>连接</button><button id="sim-disconnect" disabled>断开</button></div></div>
    <div class="sim-buttons"><button id="sim-sample" disabled>示例回放</button><button id="sim-import" disabled>导入记录</button><button id="sim-record" disabled>记录遥测</button><button id="sim-export" disabled>导出记录</button></div>
    <input id="sim-file" type="file" accept="application/json,.json" hidden>
    <output id="sim-status" class="sim-status" role="status" aria-live="polite">等待模型加载</output>
    <output id="sim-message" class="sim-message" role="status" aria-live="polite"></output>
    <p class="sim-hint">仅接收视景状态。示例回放为合成轨迹。</p>`;
  const scenePanel = document.createElement('details');
  scenePanel.className = 'tool-section';
  scenePanel.id = 'scene-tools';
  scenePanel.innerHTML = `
    <summary>场景与传感器</summary>
    <label class="field">能见距离<select id="scene-visibility" disabled><option value="3200">清晰 · 3200 m</option><option value="1200">薄雾 · 1200 m</option><option value="400">浓雾 · 400 m</option></select></label>
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
  element<HTMLSelectElement>('sim-source').onchange = (e) =>
    action(() => {
      request('simulation.source', { source: (e.target as HTMLSelectElement).value });
    });
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
  element('sim-import').onclick = () => element<HTMLInputElement>('sim-file').click();
  element<HTMLInputElement>('sim-file').onchange = async (e) => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('记录文件不能超过 16 MiB');
      request('simulation.replay.load', JSON.parse(await file.text()));
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
      saveJson(request('simulation.record.export'), 'ev50-visual-telemetry.json');
    });
  element('sim-metadata').onclick = () =>
    action(() => {
      saveJson(
        {
          version: 1,
          scene: request('scene.describe'),
          aircraft: request('aircraft.describe'),
          camera: request('camera.describe'),
          state: request('flight.state'),
        },
        'ev50-visual-metadata.json',
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
      element<HTMLSelectElement>('sim-source').value = state.source;
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
      element<HTMLButtonElement>('sim-record').disabled = !external;
      element('sim-record').textContent = state.recording.active ? '停止记录' : '记录遥测';
      element<HTMLButtonElement>('sim-export').disabled = state.recording.count < 2;
      const age = state.ageSeconds === null ? '—' : `${(state.ageSeconds * 1000).toFixed(0)} ms`;
      element('sim-status').textContent = external
        ? `${state.transport} · 数据龄 ${age}\n接收 ${state.accepted} / 拒绝 ${state.rejected} / 缺帧 ${state.gaps}\n${state.waiting ? '等待首帧' : state.stale ? '状态已冻结，等待新数据' : '按遥测原始位姿显示'}`
        : state.source === 'replay'
          ? `回放 ${state.replay.time.toFixed(1)} / ${state.replay.duration.toFixed(1)} s`
          : '演示控制器 · 可切换示例回放检查接口';
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
    },
  };
}
