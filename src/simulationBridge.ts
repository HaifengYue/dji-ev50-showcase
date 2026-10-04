import { PROTOCOL, SimulationRuntime } from "./simulation";
export function isLocalBridgeOrigin(url: string) {
  try {
    const parsed = new URL(url);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
type EventStream = {
  addEventListener: (
    type: string,
    listener: (event: MessageEvent) => void,
  ) => void;
  onerror: ((event: Event) => unknown) | null;
  close: () => void;
};
export type BridgeDependencies = {
  origin: string;
  fetch: typeof fetch;
  eventSource: (url: string) => EventStream;
  viewerId: string;
  cleanupTimeoutMs?: number;
};
export type BridgeCloseResult = {
  backendReleased: boolean | null;
  viewerRemoved: boolean;
};
/** 只访问当前本机页面同源路径，不跨源探测用户电脑或接受 postMessage 控制。 */
export class SimulationBridge {
  private stream: EventStream | null = null;
  private abort: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private generation = 0;
  private pendingAck: number | null = null;
  private cleanup: Promise<unknown> = Promise.resolve();
  constructor(
    private runtime: SimulationRuntime,
    private dependencies: BridgeDependencies,
  ) {}
  private async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    keepalive = false,
  ) {
    const response = await this.dependencies.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      keepalive,
    });
    if (!response.ok) throw new Error(`本地桥拒绝请求（${response.status}）`);
    return response.json();
  }
  private async acknowledge() {
    const revision = this.pendingAck,
      generation = this.generation;
    if (revision === null || !this.active) return;
    try {
      await this.post(
        "/api/v1/ack",
        {
          viewerId: this.dependencies.viewerId,
          revision,
          applied: true,
          motors:
            this.runtime.getSnapshot().revision === revision
              ? this.runtime.getSnapshot().actuators
              : undefined,
        },
        this.abort?.signal,
      );
      if (this.generation === generation && this.pendingAck === revision)
        this.pendingAck = null;
    } catch {
      if (
        this.active &&
        this.generation === generation &&
        !this.runtime.getSnapshot().disposed
      )
        this.runtime.setConnection(
          "error",
          "模型已应用，但本地桥回执未送达；重连后重试",
        );
    }
  }
  async connect() {
    if (this.active) return;
    const request = ++this.generation;
    await this.cleanup;
    if (
      this.active ||
      request !== this.generation ||
      this.runtime.getSnapshot().disposed
    )
      return;
    if (!isLocalBridgeOrigin(this.dependencies.origin)) {
      this.runtime.setConnection(
        "offline",
        "这是远程静态预览，不能连接你电脑上的 Python。请用本机 Python 启动器打开同源页面，或导入 JSON 记录。",
      );
      return;
    }
    this.active = true;
    const generation = request;
    this.abort = new AbortController();
    this.runtime.connect();
    try {
      const response = await this.dependencies.fetch("/api/v1/health", {
        signal: this.abort.signal,
      });
      if (!response.ok) throw new Error("当前页面未运行同源 Python 桥");
      const health = await response.json();
      if (
        health.protocol !== PROTOCOL ||
        health.service !== "transwing-local-bridge"
      )
        throw new Error("当前页面的本地桥协议不匹配");
      if (!this.active || generation !== this.generation) return;
      const reportReady = () =>
        this.post(
          "/api/v1/viewers",
          {
            viewerId: this.dependencies.viewerId,
            ready: this.runtime.getSnapshot().ready,
          },
          this.abort?.signal,
        );
      await reportReady();
      if (!this.active || generation !== this.generation) return;
      this.unsubscribe = this.runtime.onEvent((event) => {
        if (!this.active) return;
        if (event.type === "ready") void reportReady().catch(() => {});
        if (event.type === "applied" && event.revision >= 0) {
          this.pendingAck = event.revision;
          void this.acknowledge();
        }
        if (event.type === "dispose") void this.close(false);
      });
      const stream = this.dependencies.eventSource(
        `/api/v1/events?viewerId=${encodeURIComponent(this.dependencies.viewerId)}`,
      );
      this.stream = stream;
      stream.addEventListener("state", (event) => {
        if (!this.active || generation !== this.generation) return;
        let rejectedRevision: number | undefined;
        try {
          const message = JSON.parse(event.data);
          if (Number.isSafeInteger(message.revision) && message.revision >= 0)
            rejectedRevision = message.revision;
          const accepted = this.runtime.accept(message);
          if (
            accepted &&
            message.op === "interrupt" &&
            message.state.owner === "ui"
          ) {
            void this.close(true, false);
            this.runtime.setConnection(
              "offline",
              message.reason === "lease_expired"
                ? "Python 控制租约已过期，已回到本地并安全复位"
                : "Python 已释放控制，已回到本地并安全复位",
            );
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : "数据无效";
          this.runtime.setConnection("error", `已拒绝整条输入：${detail}`);
          if (
            rejectedRevision !== undefined &&
            this.runtime.getSnapshot().ready
          )
            void this.post(
              "/api/v1/ack",
              {
                viewerId: this.dependencies.viewerId,
                revision: rejectedRevision,
                applied: false,
                error: detail.slice(0, 500),
              },
              this.abort?.signal,
            ).catch(() => {});
        }
      });
      stream.addEventListener("heartbeat", () => {
        if (this.active) void this.acknowledge();
      });
      stream.onerror = () => {
        if (this.active)
          this.runtime.setConnection(
            "error",
            "同源连接中断，画面已冻结；正在等待事件流重连",
          );
      };
      this.runtime.setConnection("connected");
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      this.active = false;
      this.abort?.abort();
      this.stream?.close();
      this.unsubscribe?.();
      this.runtime.resetLocal();
      this.runtime.setConnection(
        "error",
        error instanceof Error ? error.message : "本地 Python 桥连接失败",
      );
    }
  }
  private async boundedCleanup<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ) {
    const abort = new AbortController();
    const timeout = Math.max(
      1,
      Math.min(1000, this.dependencies.cleanupTimeoutMs ?? 1000),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(abort.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error("本地桥清理超时"));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async close(reset = true, notifyServer = true): Promise<BridgeCloseResult> {
    const wasActive = this.active;
    this.active = false;
    const generation = ++this.generation;
    this.pendingAck = null;
    this.stream?.close();
    this.stream = null;
    this.abort?.abort();
    this.abort = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // 立即交还控制；迟到的DELETE或interrupt不得抹掉用户随后开始的新操作。
    if (reset && !this.runtime.getSnapshot().disposed)
      this.runtime.resetLocal();
    const result: BridgeCloseResult = {
      backendReleased: wasActive && !notifyServer ? true : null,
      viewerRemoved: !wasActive,
    };
    if (wasActive) {
      // interrupt依赖viewer存在，因此必须先确认/结束这次尝试，再删除viewer。
      this.cleanup = (async () => {
        try {
          if (notifyServer) {
            await this.boundedCleanup((signal) =>
              this.post(
                "/api/v1/interrupt",
                { viewerId: this.dependencies.viewerId },
                signal,
                true,
              ),
            );
            result.backendReleased = true;
          }
        } catch {
          result.backendReleased = false;
        } finally {
          try {
            await this.boundedCleanup(async (signal) => {
              const response = await this.dependencies.fetch(
                `/api/v1/viewers/${encodeURIComponent(this.dependencies.viewerId)}`,
                { method: "DELETE", signal, keepalive: true },
              );
              if (!response.ok && response.status !== 404)
                throw new Error(`查看器清理未确认（${response.status}）`);
            });
            result.viewerRemoved = true;
          } catch {
            result.viewerRemoved = false;
          }
        }
        if (
          generation === this.generation &&
          !this.runtime.getSnapshot().disposed &&
          this.runtime.getSnapshot().control === "local"
        ) {
          if (result.backendReleased === false)
            this.runtime.setConnection(
              "offline",
              "已在本地退出并复位，但未确认 Python 会话释放；它可能继续持有控制直到租约到期",
            );
          else if (!result.viewerRemoved)
            this.runtime.setConnection(
              "offline",
              "外部会话已释放，但查看器连接清理尚未确认",
            );
        }
        return result;
      })();
      await this.cleanup;
    }
    return result;
  }
}
