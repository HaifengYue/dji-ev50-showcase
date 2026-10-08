import type { UnifiedControlGateway } from './gateway';
import type { ControlResponse } from './contracts';

type Result = { id: string; epoch: number; sequence: number; response: ControlResponse };
/** A single explicitly enabled same-origin loopback transport. Results survive retries
 * and airframe switching; delivery retries never call gateway.request again. */
export class LocalHttpBridge {
  private readonly viewerId = `hangar_${crypto.randomUUID().replaceAll('-', '')}`;
  private active = '';
  private generation = 0;
  private abort: AbortController | null = null;
  private after = 0;
  private outbox = new Map<number, Result>();
  private status = 'browser only';
  private delivering = false;
  constructor(private gateway: UnifiedControlGateway) {}
  describe() {
    return { status: this.status, enabled: !!this.active, pendingResults: this.outbox.size };
  }
  sync() {
    const config = this.gateway.getConfig();
    const key =
      config.transport === 'local-http' && config.localService.enabled
        ? (config.baseURL ?? '')
        : '';
    if (key === this.active || this.delivering || this.outbox.size) return;
    this.stop();
    if (!key) return;
    this.active = key;
    this.abort = new AbortController();
    const generation = ++this.generation;
    void this.run(key, generation, this.abort.signal);
  }
  private async run(base: string, generation: number, signal: AbortSignal) {
    const current = () => this.generation === generation && !signal.aborted;
    const call = async (route: string, method = 'GET', data?: unknown) => {
      const url = new URL(`/api/hangar/v1${route}`, base);
      url.searchParams.set('viewerId', this.viewerId);
      const response = await fetch(url, {
        method,
        signal,
        redirect: 'error',
        headers: data === undefined ? {} : { 'content-type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      if (!response.ok) throw new Error(`Local API ${response.status}`);
      return response.json();
    };
    while (current()) {
      try {
        await call('/viewer', 'POST', { viewerId: this.viewerId });
        const heartbeat = setInterval(() => {
          if (current())
            void call('/viewer', 'POST', { viewerId: this.viewerId }).catch(() => {
              if (current()) this.gateway.disconnect();
            });
        }, 3000);
        try {
          while (current()) {
            for (const [sequence, result] of this.outbox) {
              await call('/results', 'POST', result);
              if (!current()) return;
              if (this.outbox.get(sequence) === result) this.outbox.delete(sequence);
            }
            await call('/state', 'POST', {
              state: this.gateway.getState(),
              capabilities: await this.gateway.request({ operation: 'system.capabilities' }),
              control: await this.gateway.request({ operation: 'control.state' }),
            });
            const result = await call(`/commands?after=${this.after}`);
            if (!current()) return;
            this.status = 'connected';
            for (const command of result.data.commands as {
              sequence: number;
              request: { id: string; epoch?: number };
            }[]) {
              if (!current()) return;
              if (command.sequence <= this.after) continue;
              this.delivering = true;
              const response = await this.gateway.request(command.request);
              const original = {
                id: command.request.id,
                epoch: command.request.epoch ?? 0,
                sequence: command.sequence,
                response,
              };
              this.outbox.set(command.sequence, original);
              this.after = command.sequence;
              if (!current()) return;
              await call('/results', 'POST', original);
              if (this.outbox.get(command.sequence) === original)
                this.outbox.delete(command.sequence);
              this.delivering = false;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } finally {
          clearInterval(heartbeat);
          this.delivering = false;
        }
      } catch (error) {
        if (!current()) return;
        this.status = error instanceof Error ? error.message : String(error);
        this.gateway.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  stop() {
    const base = this.active;
    this.active = '';
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    this.status = 'browser only';
    if (base) {
      this.gateway.disconnect();
      const url = new URL('/api/hangar/v1/viewer', base);
      url.searchParams.set('viewerId', this.viewerId);
      void fetch(url, { method: 'DELETE', keepalive: true, redirect: 'error' }).catch(() => {});
    }
  }
}
