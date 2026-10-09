import type { UnifiedControlGateway } from './gateway';
import type { LocalHttpBridge } from './localHttpBridge';

/** Configuration is a view of the gateway, never a second configuration store. */
export function controlPanel(gateway: UnifiedControlGateway, bridge: LocalHttpBridge) {
  const panel = document.createElement('details');
  panel.className = 'tool-section';
  panel.id = 'unified-control';
  panel.innerHTML = `<summary>统一 API 控制</summary>
    <label class="field">控制端点<input id="control-base" type="url" readonly spellcheck="false"></label>
    <div class="capture-actions"><button id="control-enable">连接本机服务</button><button id="control-disable">断开 / 释放</button></div>
    <label class="toggle"><input id="control-consumed" type="checkbox">已保存全部结果，允许清理旧会话</label>
    <button id="control-reset-session" disabled>轮换命令会话</button>
    <output id="control-capacity" class="sim-status"></output>
    <output id="control-status" class="sim-status" role="status"></output>
    <p class="sim-hint">同一端点服务 EV50 / SkyTrans。外部控制独占位姿与时钟；仅用于本机视觉开发，不连接实体飞行器。</p>`;
  document.querySelector('.right-tools')!.prepend(panel);
  const base = panel.querySelector<HTMLInputElement>('#control-base')!;
  const status = panel.querySelector<HTMLOutputElement>('#control-status')!;
  const enable = panel.querySelector<HTMLButtonElement>('#control-enable')!;
  const disable = panel.querySelector<HTMLButtonElement>('#control-disable')!;
  const consumed = panel.querySelector<HTMLInputElement>('#control-consumed')!;
  const reset = panel.querySelector<HTMLButtonElement>('#control-reset-session')!;
  const capacity = panel.querySelector<HTMLOutputElement>('#control-capacity')!;
  let resettable = false;
  let lastCapacityRead = -Infinity;
  consumed.onchange = () => {
    reset.disabled = !consumed.checked || !resettable;
  };
  reset.onclick = async () => {
    if (!consumed.checked) return;
    reset.disabled = true;
    const state = gateway.getState();
    const result = await gateway.request({
      id: `ui_reset_${crypto.randomUUID()}`,
      operation: 'control.resetSession',
      aircraft: state.aircraft,
      generation: state.generation,
      epoch: state.commandEpoch,
      owner: 'local-ui',
      payload: { acknowledgeCompletedResults: true },
    });
    error = result.ok ? '' : result.error.message;
    if (result.ok) consumed.checked = false;
    lastCapacityRead = -Infinity;
  };
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  base.value = local ? location.origin : '仅本机同源服务可连接';
  enable.disabled = !local;
  let error = '';
  const configure = async (enabled: boolean) => {
    if (!enabled) gateway.disconnect();
    const state = gateway.getState();
    const result = await gateway.request({
      id: `ui_config_${crypto.randomUUID()}`,
      operation: 'config.update',
      aircraft: state.aircraft,
      generation: state.generation,
      epoch: state.commandEpoch,
      owner: 'local-ui',
      payload: {
        transport: enabled ? 'local-http' : 'browser',
        baseURL: enabled ? location.origin : null,
        localService: { enabled },
      },
    });
    error = result.ok
      ? ''
      : !enabled && result.error.code === 'CAPACITY_EXCEEDED'
        ? '控制权已释放；缓存已满。请保存结果并轮换命令会话，再断开服务。'
        : result.error.message;
    bridge.sync();
  };
  enable.onclick = () => void configure(true);
  disable.onclick = () => void configure(false);
  if (local && new URLSearchParams(location.search).get('control') === 'local')
    void configure(true);
  return {
    update() {
      if (performance.now() - lastCapacityRead > 500) {
        lastCapacityRead = performance.now();
        void gateway.request({ operation: 'control.state' }).then((result) => {
          if (!result.ok) return;
          const value = result.data as {
            commandEpoch: number;
            retained: number;
            capacity: number;
            remaining: number;
            canResetSession: boolean;
          };
          resettable = value.canResetSession;
          reset.disabled = !resettable || !consumed.checked;
          capacity.textContent = `命令会话 ${value.commandEpoch} · 网关剩余 ${value.remaining}/${value.capacity} · 轮换前需释放控制并保存全部结果`;
        });
      }
      const lease = gateway.getLease();
      if (lease) reset.disabled = true;
      const config = gateway.getConfig();
      enable.disabled = !local || config.localService.enabled;
      disable.disabled = !lease && !config.localService.enabled;
      status.textContent =
        error ||
        `${lease ? `${lease.aircraft} · ${lease.owner} · ${lease.clock === 'external' ? '外部步进时钟' : '本地演示时钟'}` : '本地界面控制'}\n${bridge.describe().status} · ${config.units.position} / ${config.units.time} / XYZW`;
    },
  };
}
