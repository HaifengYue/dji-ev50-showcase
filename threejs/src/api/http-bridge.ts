import { ApiRequest, ApiResponse } from './contracts';

type PageApi = { readonly ready: boolean; request(request: ApiRequest): ApiResponse };
type QueuedCommand = { sequence: number; id: string; operation: string; payload?: unknown };
type PendingResult = { id: string; sequence: number; body: string };
type BridgeDelivery = { after: number; outbox: Map<number, PendingResult> };

// The result belongs to its original command, not whichever aircraft is selected later.
// Keep acknowledged execution identity across mount boundaries; never re-execute to retry ACK.
const deliveries = new Map<string, BridgeDelivery>();
const resetOnResume = new Set<string>();
const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const asJson = async (response: Response) => {
  const result = (await response.json()) as { ok?: boolean; data?: unknown };
  if (!response.ok) throw new Error(`Bridge request failed: ${response.status}`);
  return result.data;
};

/** Optional local HTTP bridge selected with ?apiBridge=http://127.0.0.1:8787. */
export function startHttpBridge(api: PageApi) {
  const configured = new URLSearchParams(window.location.search).get('apiBridge');
  if (!configured) return;
  let base: URL;
  try {
    base = new URL(configured, window.location.href);
  } catch {
    console.warn('EV50 API bridge URL is invalid');
    return;
  }
  if (!['http:', 'https:'].includes(base.protocol)) {
    console.warn('EV50 API bridge must use HTTP(S)');
    return;
  }
  base.pathname = base.pathname.replace(/\/$/, '');
  const key = base.href;
  const delivery = deliveries.get(key) ?? { after: 0, outbox: new Map<number, PendingResult>() };
  deliveries.set(key, delivery);
  const controller = new AbortController();
  // A resumed bridge defines one cut-off from its first command batch. New commands
  // arriving after that barrier are not discarded merely because an ACK was delayed.
  let discardThrough: number | null = resetOnResume.has(key) ? null : -1;
  let stopped = false;
  const request = async (path: string, options: RequestInit = {}) =>
    asJson(
      await fetch(new URL(path, base), {
        ...options,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...options.headers },
      }),
    );
  async function flushResults() {
    for (const result of delivery.outbox.values()) {
      if (stopped) return;
      await request('/api/v1/bridge/results', { method: 'POST', body: result.body });
      if (stopped) return;
      // A late prior generation's completion must not remove another pending result.
      if (delivery.outbox.get(result.sequence) === result) delivery.outbox.delete(result.sequence);
    }
  }
  const snapshot = async () => {
    if (stopped || !api.ready) return;
    const state = api.request({ operation: 'flight.state' }),
      settings = api.request({ operation: 'settings.get' }),
      routes = api.request({ operation: 'mission.list' });
    if (!stopped && state.ok && settings.ok && routes.ok)
      await request('/api/v1/bridge/state', {
        method: 'POST',
        body: JSON.stringify({ state: state.data, settings: settings.data, routes: routes.data }),
      });
  };
  const poll = async () => {
    while (!stopped) {
      try {
        await flushResults();
        if (stopped) break;
        const data = (await request(`/api/v1/bridge/commands?after=${delivery.after}`)) as {
          commands: QueuedCommand[];
        };
        if (stopped) break;
        if (discardThrough === null) {
          discardThrough = Math.max(
            delivery.after,
            ...data.commands.map((command) => command.sequence),
          );
          resetOnResume.delete(key);
        }
        for (const command of data.commands) {
          if (stopped) break;
          if (command.sequence <= delivery.after) continue;
          const response: ApiResponse =
            command.sequence <= discardThrough
              ? {
                  id: command.id,
                  operation: command.operation,
                  ok: false,
                  error: {
                    code: 'STALE_SELECTION',
                    message: 'Aircraft selection changed; issue a new command after EV50 is ready',
                  },
                }
              : api.request({
                  id: command.id,
                  operation: command.operation,
                  payload: command.payload,
                });
          const result = {
            id: command.id,
            sequence: command.sequence,
            body: JSON.stringify({ id: command.id, sequence: command.sequence, response }),
          };
          delivery.outbox.set(command.sequence, result);
          delivery.after = command.sequence;
          await flushResults();
        }
        if (stopped) break;
        await snapshot();
        await wait(50);
      } catch (error) {
        if (stopped) break;
        console.warn('EV50 API bridge disconnected; retrying pending results', error);
        await wait(1000);
      }
    }
  };
  void poll();
  console.info(`EV50 API bridge connected: ${base}`);
  return () => {
    stopped = true;
    resetOnResume.add(key);
    controller.abort();
  };
}
