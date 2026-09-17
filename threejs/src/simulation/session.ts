import {
  exportMavlinkJsonl,
  MAX_LOG_FRAMES,
  MavlinkLiveDecoder,
  normalizeFrame,
  RecordingFormat,
  sampleRecording,
  TelemetryBuffer,
  TelemetryFrame,
  TelemetryReplay,
} from './telemetry';

export type SimulationSource = 'demo' | 'external' | 'replay';
const nowSeconds = () => performance.now() / 1000;

/** The transport receives graphics states only. It never sends control packets. */
export class VisualSession {
  readonly buffer = new TelemetryBuffer();
  readonly replay = new TelemetryReplay();
  source: SimulationSource = 'demo';
  paused = false;
  frame: TelemetryFrame | null = null;
  private socket: WebSocket | null = null;
  private transport = 'disconnected';
  private recording: TelemetryFrame[] = [];
  private recordingActive = false;
  private recordingFull = false;
  private recordingStartedAt: number | null = null;
  private recordingLastAt = -Infinity;
  private readonly mavlink = new MavlinkLiveDecoder();
  private lastError = '';
  constructor(private readonly changed: (source: SimulationSource) => void) {}

  select(source: SimulationSource) {
    if (!['demo', 'external'].includes(source))
      throw new Error('Use replay.load to select a recording');
    this.closeSocket();
    this.source = source;
    this.paused = false;
    this.buffer.reset();
    this.frame = null;
    this.mavlink.reset();
    this.recordingActive = false;
    this.lastError = '';
    this.changed(source);
  }
  ingest(input: unknown, now = nowSeconds()) {
    // Validate before switching modes so malformed input cannot stop a mission.
    const validated = normalizeFrame(input);
    if (this.source !== 'external') this.select('external');
    const accepted = this.buffer.push(validated, now);
    this.capture(accepted, now);
    this.lastError = '';
    return this.state(now);
  }
  connect(address: unknown) {
    if (typeof address !== 'string') throw new Error('WebSocket URL is required');
    const url = new URL(address);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Use a ws:// or wss:// URL without credentials');
    if (location.protocol === 'https:' && url.protocol !== 'wss:')
      throw new Error('HTTPS pages require wss://; use a local HTTP page for ws://');
    const socket = new WebSocket(url);
    this.select('external');
    this.socket = socket;
    this.transport = 'connecting';
    socket.onopen = () => {
      if (this.socket === socket) this.transport = 'connected';
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 65536)
          throw new Error('Expected a JSON text frame under 64 KiB');
        const frame = this.mavlink.push(JSON.parse(event.data));
        if (frame) this.ingest(frame);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) this.lastError = 'WebSocket connection failed';
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.transport = 'disconnected';
        this.socket = null;
      }
    };
    return this.state();
  }
  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.transport = 'disconnected';
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }
  disconnect() {
    this.closeSocket();
    return this.state();
  }
  load(input: unknown) {
    this.replay.load(input);
    this.closeSocket();
    this.source = 'replay';
    this.paused = false;
    this.recordingActive = false;
    this.frame = this.replay.sample();
    this.lastError = '';
    this.changed('replay');
    return this.state();
  }
  tick(dt: number, now = nowSeconds()) {
    if (this.source === 'external' && !this.paused) this.frame = this.buffer.sample(now);
    if (this.source === 'replay') this.frame = this.replay.tick(this.paused ? 0 : dt);
    return this.frame;
  }
  pause(value: boolean) {
    this.paused = value;
    if (this.source === 'replay')
      this.replay.playing = !value && this.replay.time < this.replay.duration;
  }
  startRecording() {
    this.recording = [];
    this.recordingActive = true;
    this.recordingFull = false;
    this.recordingStartedAt = null;
    this.recordingLastAt = -Infinity;
    return this.state();
  }
  stopRecording() {
    this.recordingActive = false;
    return this.state();
  }
  /** Captures either local demo or received telemetry at a bounded 20 Hz. */
  capture(input: unknown, now = nowSeconds()) {
    if (!this.recordingActive || this.recordingFull) return;
    if (now - this.recordingLastAt < 1 / 20) return;
    const source = normalizeFrame(input);
    if (this.recordingStartedAt === null) this.recordingStartedAt = now;
    const frame: TelemetryFrame = {
      ...source,
      sequence: this.recording.length,
      time: now - this.recordingStartedAt,
    };
    this.recording.push(frame);
    this.recordingLastAt = now;
    if (this.recording.length >= MAX_LOG_FRAMES) {
      this.recordingActive = false;
      this.recordingFull = true;
    }
  }
  exportRecording(input?: unknown) {
    const format = (input as { format?: unknown } | undefined)?.format ?? 'ev50-json';
    if (format === 'mavlink-jsonl') return exportMavlinkJsonl(this.recording);
    if (format !== 'ev50-json') throw new Error('Unsupported recording format');
    return {
      version: 1,
      frame: 'SCENE',
      format: 'ev50-json',
      description: 'Normalized visual states, not a physics model',
      frames: structuredClone(this.recording),
    };
  }
  state(now = nowSeconds()) {
    return {
      version: '1.0.0',
      source: this.source,
      paused: this.paused || (this.source === 'replay' && !this.replay.playing),
      transport: this.transport,
      ...this.buffer.status(now),
      frame: this.frame ? normalizeFrame(this.frame) : null,
      replay: { time: this.replay.time, duration: this.replay.duration },
      recording: {
        active: this.recordingActive,
        full: this.recordingFull,
        count: this.recording.length,
        limit: MAX_LOG_FRAMES,
      },
      lastError: this.lastError,
    };
  }
  request(operation: string, payload: unknown): unknown {
    switch (operation) {
      case 'simulation.state':
        return this.state();
      case 'simulation.frame':
        return this.ingest(payload);
      case 'simulation.source':
        this.select((payload as { source: SimulationSource })?.source);
        return this.state();
      case 'simulation.connect':
        return this.connect((payload as { url?: unknown })?.url);
      case 'simulation.disconnect':
        return this.disconnect();
      case 'simulation.replay.load':
        return this.load(payload);
      case 'simulation.replay.sample':
        return this.load(sampleRecording());
      case 'simulation.replay.seek': {
        if (this.source !== 'replay') throw new Error('No replay is active');
        this.replay.seek((payload as { time: number })?.time);
        this.frame = this.replay.sample();
        return this.state();
      }
      case 'simulation.pause':
        this.pause(true);
        return this.state();
      case 'simulation.resume':
        this.pause(false);
        return this.state();
      case 'simulation.record.start':
        return this.startRecording();
      case 'simulation.record.stop':
        return this.stopRecording();
      case 'simulation.record.export':
        return this.exportRecording(payload as { format?: RecordingFormat } | undefined);
      default:
        throw new Error(`Unsupported simulation operation: ${operation}`);
    }
  }
}
