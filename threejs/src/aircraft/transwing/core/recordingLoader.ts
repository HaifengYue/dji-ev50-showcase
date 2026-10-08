import { parseRecording, SimulationRuntime } from './simulation';
import { SimulationBridge } from './simulationBridge';
/** 文件、公开Python示例共用原子导入；最后一次明确操作获胜。 */
export class RecordingLoader {
  private generation = 0;
  private abort: AbortController | null = null;
  loading = false;
  constructor(
    private runtime: SimulationRuntime,
    private bridge: SimulationBridge,
  ) {}
  cancel() {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.loading = false;
  }
  async load(
    read: (signal: AbortSignal) => Promise<string>,
    beforeApply: () => void,
    autoplay = false,
  ) {
    this.cancel();
    const generation = this.generation;
    this.abort = new AbortController();
    this.loading = true;
    try {
      const text = await read(this.abort.signal);
      if (generation !== this.generation || this.runtime.getSnapshot().disposed) return false;
      parseRecording(text);
      // 验证成功后才释放外部控制；坏文件不会打断正在运行的Python会话。
      const cleanup = await this.bridge.close();
      if (generation !== this.generation || this.runtime.getSnapshot().disposed) return false;
      beforeApply();
      this.runtime.replay(text);
      if (autoplay) this.runtime.playReplay(true);
      if (cleanup.backendReleased === false)
        this.runtime.setConnection(
          'offline',
          '已进入离线回放，但未确认原 Python 会话释放；它可能仍持有控制直到租约到期',
        );
      return true;
    } catch (error) {
      if (generation !== this.generation || this.runtime.getSnapshot().disposed) return false;
      throw error;
    } finally {
      if (generation === this.generation) {
        this.abort = null;
        this.loading = false;
      }
    }
  }
}
export async function readPythonExample(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  url = 'transwing/examples/python-full-flow.json',
) {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`Python示例加载失败（${response.status}），可改用导入JSON`);
  const length = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 1024 * 1024) throw new Error('记录最大为 1 MiB');
  if (!response.body) {
    const text = await response.text();
    parseRecording(text);
    return text;
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 1024 * 1024) {
      await reader.cancel();
      throw new Error('记录最大为 1 MiB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
