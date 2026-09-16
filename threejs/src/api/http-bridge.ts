import { ApiRequest, ApiResponse } from './contracts';

type PageApi = { readonly ready: boolean; request(request: ApiRequest): ApiResponse };
type QueuedCommand = { sequence: number; id: string; operation: string; payload?: unknown };

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const asJson = async (response: Response) => {
  const result = (await response.json()) as { ok?: boolean; data?: unknown };
  if (!response.ok) throw new Error(`Bridge request failed: ${response.status}`);
  return result.data;
};

/** Connects a page to the optional local HTTP bridge selected with ?apiBridge=http://127.0.0.1:8787. */
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
  let after = 0,
    stopped = false;
  const request = async (path: string, options: RequestInit = {}) =>
    asJson(
      await fetch(new URL(path, base), {
        ...options,
        headers: { 'content-type': 'application/json', ...options.headers },
      }),
    );
  const snapshot = async () => {
    if (!api.ready) return;
    const state = api.request({ operation: 'flight.state' }),
      settings = api.request({ operation: 'settings.get' }),
      routes = api.request({ operation: 'mission.list' });
    if (state.ok && settings.ok && routes.ok)
      await request('/api/v1/bridge/state', {
        method: 'POST',
        body: JSON.stringify({ state: state.data, settings: settings.data, routes: routes.data }),
      });
  };
  const poll = async () => {
    while (!stopped) {
      try {
        const data = (await request(`/api/v1/bridge/commands?after=${after}`)) as {
          commands: QueuedCommand[];
        };
        for (const command of data.commands) {
          const response = api.request({
            id: command.id,
            operation: command.operation,
            payload: command.payload,
          });
          await request('/api/v1/bridge/results', {
            method: 'POST',
            body: JSON.stringify({ id: command.id, sequence: command.sequence, response }),
          });
          after = command.sequence;
        }
        await snapshot();
        await wait(50);
      } catch (error) {
        console.warn('EV50 API bridge disconnected; retrying', error);
        await wait(1000);
      }
    }
  };
  void poll();
  console.info(`EV50 API bridge connected: ${base}`);
  return () => {
    stopped = true;
  };
}
