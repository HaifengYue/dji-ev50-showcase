import {
  CONTROL_PROTOCOL,
  WORLD_COORDINATES,
  type AircraftControlCommand,
  type AircraftOperation,
  type ControlConfig,
  type ControlContext,
  type ControlErrorCode,
  type ControlLease,
  type ControlRequest,
  type ControlResponse,
  type UnifiedAircraftState,
  type UnifiedControlHost,
} from './contracts';
import {
  defaultControlConfig,
  finite,
  onlyKeys,
  plainRecord,
  validateControlConfig,
} from './config';
import { COMMON_OPERATIONS, MODEL_OPERATIONS, validateAircraftCommand } from './validation';
import { normalizeAircraftId, normalizeAircraftOperation } from '../aircraft/identity';

export class ControlError extends Error {
  constructor(
    readonly code: ControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}
const READS = ['system.capabilities', 'aircraft.state', 'config.get', 'control.state'];
const MANAGEMENT = [
  'config.update',
  'control.acquire',
  'control.renew',
  'control.release',
  'control.disconnect',
  'control.resetSession',
];
const fail = (code: ControlErrorCode, message: string): never => {
  throw new ControlError(code, message);
};
const token = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 128)
    throw new Error(`${label} must be a nonempty string of at most 128 characters`);
  return value;
};
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function snapshot<T>(value: T): T {
  return freeze(structuredClone(value));
}
/** Canonical JSON rejects lossy values instead of accidentally deduplicating them. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 30) throw new Error('Request nesting exceeds 30 levels');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + Array.from(value, (v) => canonical(v, depth + 1)).join(',') + ']';
  const object = plainRecord(value, 'JSON value');
  return (
    '{' +
    Object.keys(object)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(object[k], depth + 1))
      .join(',') +
    '}'
  );
}
type Pending = {
  request: ControlRequest;
  command: AircraftControlCommand;
  resolve: (response: ControlResponse) => void;
};
type Remembered = { fingerprint: string; promise: Promise<ControlResponse> };
export type GatewayOptions = {
  origin: string;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  maxPending?: number;
  maxRemembered?: number;
};

/** One selected instance, one lease, one application per rendered frame. No network side effects. */
export class UnifiedControlGateway {
  private config = defaultControlConfig();
  private lease: ControlLease | null = null;
  private queue: Pending[] = [];
  private applying: Pending | null = null;
  private remembered = new Map<string, Remembered>();
  private aliasResponses = new WeakMap<
    Promise<ControlResponse>,
    Map<string, Promise<ControlResponse>>
  >();
  private commandEpoch = 0;
  private lastReset: {
    fingerprint: string;
    request: ControlRequest;
    response: ControlResponse;
  } | null = null;
  private selection: ControlContext;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private serial = 0;
  private lastFrame = -1;
  private lastExternalTime: number | null = null;
  private disposed = false;
  private lastRelease: { leaseId: string; code: ControlErrorCode; reason: string } | null = null;
  private lifecycleError: string | null = null;
  private readonly now: () => number;
  constructor(
    private readonly host: UnifiedControlHost,
    private readonly options: GatewayOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.selection = { ...host.getContext() };
  }
  getConfig(): ControlConfig {
    return snapshot(this.config);
  }
  getLease(): ControlLease | null {
    this.synchronize();
    return this.lease ? snapshot(this.lease) : null;
  }
  getState(): UnifiedAircraftState {
    this.synchronize();
    const context = this.host.getContext(),
      capabilities = this.host.getCapabilities();
    if (capabilities.aircraft !== context.aircraft)
      fail('HOST_ERROR', 'Capabilities do not match the selected aircraft');
    const state = context.ready ? this.host.getState() : null;
    if (
      state &&
      (state.model.aircraft !== context.aircraft ||
        state.model.rotorCount !== capabilities.rotorCount)
    )
      fail('HOST_ERROR', 'Adapter state does not match aircraft capabilities');
    return snapshot({
      protocol: CONTROL_PROTOCOL,
      commandEpoch: this.commandEpoch,
      aircraft: context.aircraft,
      generation: context.generation,
      ready: context.ready,
      coordinates: WORLD_COORDINATES,
      body: capabilities.body,
      lease: this.lease,
      state,
    });
  }
  request(input: unknown): Promise<ControlResponse> {
    let requestedOperation: unknown;
    try {
      requestedOperation = plainRecord(input, 'request').operation;
    } catch {
      // The validated path below produces the original structured error.
    }
    const pending = this.requestNormalized(input);
    if (
      typeof requestedOperation !== 'string' ||
      normalizeAircraftOperation(requestedOperation) === requestedOperation
    )
      return pending;
    // Only response spelling differs; repeated aliases still return the same promise.
    let responses = this.aliasResponses.get(pending);
    if (!responses) {
      responses = new Map();
      this.aliasResponses.set(pending, responses);
    }
    let response = responses.get(requestedOperation);
    if (!response) {
      const operation = requestedOperation;
      response = pending.then((value) => snapshot({ ...value, operation }));
      responses.set(operation, response);
    }
    return response;
  }
  private requestNormalized(input: unknown): Promise<ControlResponse> {
    let request: ControlRequest = { operation: 'unknown' };
    try {
      const object = plainRecord(input, 'request');
      onlyKeys(
        object,
        ['id', 'epoch', 'operation', 'aircraft', 'generation', 'owner', 'leaseId', 'payload'],
        'request',
      );
      request = { ...object, operation: token(object.operation, 'operation') } as ControlRequest;
      // Canonicalize before copying so undefined, nonfinite numbers and exotic objects are rejected.
      const rawFingerprint = canonical(object);
      if (rawFingerprint.length > 65536) throw new Error('Request exceeds 64 KiB');
      if (request.aircraft !== undefined) {
        const aircraft = normalizeAircraftId(request.aircraft);
        if (aircraft) request.aircraft = aircraft;
      }
      request.operation = normalizeAircraftOperation(request.operation);
      // Equivalent old/new spellings share the same idempotency record.
      const fingerprint = canonical(request);
      request = snapshot(request);
      const epoch = request.epoch === undefined ? 0 : request.epoch;
      if (!Number.isSafeInteger(epoch) || epoch < 0)
        throw new Error('epoch must be a nonnegative safe integer');
      if (READS.includes(request.operation)) {
        this.synchronize();
        if (request.epoch !== undefined) this.requireEpoch(epoch);
        this.optionalTarget(request);
        return Promise.resolve(this.success(request, this.read(request.operation)));
      }
      token(request.id, 'id');
      if (
        request.operation === 'control.resetSession' &&
        this.lastReset?.fingerprint === fingerprint
      )
        return Promise.resolve(this.lastReset.response);
      this.requireEpoch(epoch);
      const old = this.remembered.get(request.id!);
      if (old)
        return old.fingerprint === fingerprint
          ? old.promise
          : Promise.resolve(
              this.failure(
                request,
                'ID_CONFLICT',
                'Command id was already used for a different request',
              ),
            );
      if (this.remembered.size >= (this.options.maxRemembered ?? 10000)) {
        // A full outcome ledger must never trap an active owner. Validate before
        // the single bounded emergency release slot; invalid attempts retain nothing.
        if (
          !['control.release', 'control.disconnect', 'control.resetSession'].includes(
            request.operation,
          )
        )
          return Promise.resolve(
            this.failure(
              request,
              'CAPACITY_EXCEEDED',
              'Command history is full; release control, consume outcomes, then explicitly reset the session',
            ),
          );
        try {
          this.synchronize();
          this.requiredTarget(request);
          if (request.operation === 'control.resetSession') this.validateSessionReset(request);
          else {
            this.requireLease(request);
            onlyKeys(plainRecord(request.payload ?? {}, 'payload'), [], request.operation);
          }
        } catch (error) {
          return Promise.resolve(this.fromError(request, error));
        }
      }
      let resolve!: (response: ControlResponse) => void;
      const promise = new Promise<ControlResponse>((done) => {
        resolve = done;
      });
      this.remembered.set(request.id!, { fingerprint, promise });
      try {
        this.synchronize();
        if (this.disposed) fail('DISCONNECTED', 'Gateway is disposed');
        this.requiredTarget(request);
        if (MANAGEMENT.includes(request.operation)) {
          const response = this.manage(request);
          if (request.operation === 'control.resetSession' && response.ok)
            this.lastReset = { fingerprint, request, response };
          resolve(response);
        } else {
          const command = this.validate(request);
          if (this.queue.length + Number(!!this.applying) >= (this.options.maxPending ?? 256))
            fail('CAPACITY_EXCEEDED', 'Too many commands await a rendered frame');
          this.queue.push({ request, command, resolve });
        }
      } catch (error) {
        resolve(this.fromError(request, error));
      }
      return promise;
    } catch (error) {
      return Promise.resolve(this.fromError(request, error, 'INVALID_REQUEST'));
    }
  }
  /** Call immediately before the selected aircraft's update, not after rendering. */
  beforeFrame(): void {
    this.synchronize();
    if (this.applying || this.disposed) return;
    const next = this.queue.shift();
    if (!next) return;
    try {
      this.requiredTarget(next.request);
      const command = this.validate(next.request);
      // Revalidate units and timeline at execution, after earlier queued commands.
      if (
        command.operation === 'transport.seek' &&
        command.payload.unit !== this.host.getState().transport.unit
      )
        fail('VALIDATION_FAILED', 'Seek unit does not match the active timeline');
      if (command.operation === 'clock.step' && !this.host.getState().transport.playing)
        fail('VALIDATION_FAILED', 'External clock is paused; use transport.play before clock.step');
      this.applying = next;
      this.host.apply(command);
      // A host callback may synchronously invalidate selection or disconnect.
      if (this.applying !== next) return;
      if (command.operation === 'aircraft.pose' && command.payload.timeSeconds !== undefined)
        this.lastExternalTime = command.payload.timeSeconds;
      if (command.operation === 'clock.step')
        this.lastExternalTime = this.host.getState().clock.seconds;
    } catch (error) {
      if (this.applying === next) this.applying = null;
      next.resolve(this.fromError(next.request, error, 'HOST_ERROR'));
    }
  }
  /** Call only after a successful actual host render. A monotonically increasing frame is required. */
  afterRender(frame: number): void {
    this.synchronize();
    if (!Number.isSafeInteger(frame) || frame <= this.lastFrame) return;
    this.lastFrame = frame;
    const pending = this.applying;
    if (!pending) return;
    this.applying = null;
    try {
      this.requiredTarget(pending.request);
      this.requireLease(pending.request);
      pending.resolve(this.success(pending.request, this.getState(), frame));
    } catch (error) {
      pending.resolve(this.fromError(pending.request, error, 'HOST_ERROR'));
    }
  }
  /** Call at selection start, before disposing the old adapter. */
  invalidateSelection(): void {
    this.release('STALE_SELECTION', 'Aircraft selection changed');
    this.selection = { ...this.host.getContext() };
  }
  /** A transport disconnection releases ownership and cancels all unacknowledged work. */
  disconnect(): void {
    this.release('DISCONNECTED', 'Control transport disconnected');
  }
  dispose(): void {
    this.disconnect();
    this.disposed = true;
  }
  private read(operation: string): unknown {
    switch (operation) {
      case 'config.get':
        return this.getConfig();
      case 'control.state':
        return {
          lease: this.getLease(),
          pending: this.queue.length + Number(!!this.applying),
          lifecycleError: this.lifecycleError,
          commandEpoch: this.commandEpoch,
          lastReset: this.lastReset
            ? { request: this.lastReset.request, response: this.lastReset.response }
            : null,
          capacity: this.options.maxRemembered ?? 10000,
          retained: this.remembered.size,
          remaining: Math.max(0, (this.options.maxRemembered ?? 10000) - this.remembered.size),
          canResetSession: !this.lease && !this.queue.length && !this.applying,
        };
      case 'aircraft.state':
        return this.getState();
      default:
        return {
          protocol: CONTROL_PROTOCOL,
          commandEpoch: this.commandEpoch,
          transport: this.config.transport,
          implementedTransports: ['browser', 'local-http'],
          reservedTransports: ['remote-http', 'websocket'],
          operations: [...READS, ...MANAGEMENT],
          aircraft: this.host.getCapabilities(),
          coordinates: WORLD_COORDINATES,
          appliedAck: 'after-host-render',
          deduplication: {
            scope: 'command-epoch',
            capacity: this.options.maxRemembered ?? 10000,
            eviction: false,
            resetOperation: 'control.resetSession',
            retainedResetReceipts: 1,
          },
        };
    }
  }
  private requireEpoch(epoch: number) {
    if (epoch !== this.commandEpoch)
      fail('STALE_SESSION', `Command epoch changed; current epoch is ${this.commandEpoch}`);
  }
  private validateSessionReset(request: ControlRequest) {
    const payload = plainRecord(request.payload, 'reset payload');
    onlyKeys(payload, ['acknowledgeCompletedResults'], 'reset payload');
    if (payload.acknowledgeCompletedResults !== true)
      throw new Error('resetSession requires acknowledgeCompletedResults: true');
    if (this.lease || this.queue.length || this.applying)
      fail(
        'CONTROL_BUSY',
        'Release control and wait for pending commands before resetting the session',
      );
    if (this.commandEpoch >= Number.MAX_SAFE_INTEGER)
      fail('CAPACITY_EXCEEDED', 'Command epoch is exhausted; reload the page');
  }
  private optionalTarget(request: ControlRequest) {
    const context = this.host.getContext();
    if (request.aircraft !== undefined && request.aircraft !== context.aircraft)
      fail('AIRCRAFT_MISMATCH', 'Request aircraft is not selected');
    if (request.generation !== undefined && request.generation !== context.generation)
      fail('STALE_SELECTION', 'Selection generation changed');
  }
  private requiredTarget(request: ControlRequest) {
    if (request.aircraft !== 'ev50' && request.aircraft !== 'skytrans')
      throw new Error('aircraft is required');
    if (!Number.isSafeInteger(request.generation) || request.generation! < 0)
      throw new Error('generation must be a nonnegative safe integer');
    token(request.owner, 'owner');
    this.optionalTarget(request);
  }
  private requireLease(request: ControlRequest): ControlLease {
    if (!this.lease) {
      if (request.leaseId && request.leaseId === this.lastRelease?.leaseId)
        fail(this.lastRelease.code, this.lastRelease.reason);
      fail('LEASE_REQUIRED', 'Acquire control before commanding this aircraft');
    }
    const lease = this.lease!;
    if (lease.owner !== request.owner) fail('OWNER_MISMATCH', 'Lease owner does not match');
    if (lease.leaseId !== request.leaseId) fail('LEASE_MISMATCH', 'Lease id does not match');
    return lease;
  }
  private validate(request: ControlRequest): AircraftControlCommand {
    const context = this.host.getContext();
    if (!context.ready) fail('NOT_READY', 'Selected aircraft is not ready');
    if (context.blockedReason) fail('CONTROL_BUSY', context.blockedReason);
    const lease = this.requireLease(request),
      op = request.operation as AircraftOperation;
    if (
      (op.startsWith('ev50.') && context.aircraft !== 'ev50') ||
      (op.startsWith('skytrans.') && context.aircraft !== 'skytrans')
    )
      fail('AIRCRAFT_MISMATCH', 'Model-specific commands cannot cross aircraft types');
    if (
      ![...COMMON_OPERATIONS, ...MODEL_OPERATIONS].includes(op) ||
      !this.host.getCapabilities().operations.includes(op)
    )
      fail('OPERATION_UNSUPPORTED', `Unsupported operation: ${op}`);
    if ((op === 'aircraft.pose' || op === 'clock.step') && lease.controlMode !== 'external')
      fail('MODE_MISMATCH', 'Pose and clock commands require an external-clock lease');
    if (
      lease.controlMode === 'external' &&
      op.startsWith('transport.') &&
      !['transport.play', 'transport.pause'].includes(op)
    )
      fail(
        'MODE_MISMATCH',
        'External-clock leases support play/pause only; use explicit pose time or clock.step',
      );
    const command = validateAircraftCommand(op, request.payload);
    if (
      command.operation === 'aircraft.pose' &&
      command.payload.timeSeconds !== undefined &&
      this.lastExternalTime !== null &&
      command.payload.timeSeconds < this.lastExternalTime
    )
      fail('CLOCK_REGRESSION', 'External clock cannot regress within a lease');
    return command;
  }
  private manage(request: ControlRequest): ControlResponse {
    const p = plainRecord(request.payload ?? {}, 'payload');
    if (request.operation === 'control.resetSession') {
      this.validateSessionReset(request);
      this.remembered.clear();
      this.commandEpoch++;
      return this.success(request, { commandEpoch: this.commandEpoch });
    }
    if (request.operation === 'config.update') {
      if (this.lease)
        fail('CONTROL_BUSY', 'Release the current lease before changing configuration');
      this.config = validateControlConfig(this.config, p, this.options.origin);
      return this.success(request, this.getConfig());
    }
    if (request.operation === 'control.acquire') {
      onlyKeys(p, ['ttlMs', 'controlMode', 'clock'], 'acquire');
      const context = this.host.getContext();
      if (!context.ready) fail('NOT_READY', 'Selected aircraft is not ready');
      if (context.blockedReason) fail('CONTROL_BUSY', context.blockedReason);
      if (this.lease)
        fail('CONTROL_BUSY', 'Another lease is active; renew or release it explicitly');
      const configPatch: Record<string, unknown> = {};
      if ('controlMode' in p) configPatch.controlMode = p.controlMode;
      if ('clock' in p) configPatch.clock = p.clock;
      const nextConfig = validateControlConfig(this.config, configPatch, this.options.origin);
      const ttl = 'ttlMs' in p ? finite(p.ttlMs, 1000, 120000, 'ttlMs') : nextConfig.leaseTtlMs;
      const lease: ControlLease = {
        leaseId: `lease-${context.generation}-${++this.serial}`,
        owner: request.owner!,
        aircraft: context.aircraft,
        generation: context.generation,
        controlMode: nextConfig.controlMode,
        clock: nextConfig.clock,
        expiresAt: this.now() + ttl,
      };
      this.host.leaseChanged?.(snapshot(lease), 'acquired');
      this.config = nextConfig;
      this.lease = lease;
      this.lastExternalTime =
        lease.clock === 'external' ? this.host.getState().clock.seconds : null;
      this.lifecycleError = null;
      this.armTimer();
      return this.success(request, snapshot(lease));
    }
    const lease = this.requireLease(request);
    if (request.operation === 'control.renew') {
      onlyKeys(p, ['ttlMs'], 'renew');
      const ttl = 'ttlMs' in p ? finite(p.ttlMs, 1000, 120000, 'ttlMs') : this.config.leaseTtlMs;
      this.lease = { ...lease, expiresAt: this.now() + ttl };
      this.armTimer();
      return this.success(request, snapshot(this.lease));
    }
    onlyKeys(p, [], request.operation);
    this.release(
      request.operation === 'control.disconnect' ? 'DISCONNECTED' : 'LEASE_REQUIRED',
      request.operation === 'control.disconnect'
        ? 'Control transport disconnected'
        : 'Control lease released',
    );
    if (this.lifecycleError) fail('HOST_ERROR', this.lifecycleError);
    return this.success(request, { released: true });
  }
  private synchronize(): void {
    const context = this.host.getContext();
    if (
      context.aircraft !== this.selection.aircraft ||
      context.generation !== this.selection.generation
    ) {
      this.release('STALE_SELECTION', 'Aircraft selection changed');
      this.selection = { ...context };
    } else if (this.lease && this.now() >= this.lease.expiresAt)
      this.release('LEASE_EXPIRED', 'Control lease expired');
  }
  private release(code: ControlErrorCode, reason: string): void {
    const old = this.lease;
    this.lease = null;
    this.lastExternalTime = null;
    if (old) this.lastRelease = { leaseId: old.leaseId, code, reason };
    if (this.timer !== null) {
      (this.options.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
    const pending = [...(this.applying ? [this.applying] : []), ...this.queue];
    this.applying = null;
    this.queue = [];
    for (const item of pending) item.resolve(this.failure(item.request, code, reason));
    if (old) {
      try {
        this.host.leaseChanged?.(null, reason);
      } catch (error) {
        this.lifecycleError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  private armTimer(): void {
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer);
    if (!this.lease) return;
    this.timer = (this.options.setTimer ?? setTimeout)(
      () => {
        this.timer = null;
        this.synchronize();
        if (this.lease) this.armTimer();
      },
      Math.max(1, this.lease.expiresAt - this.now()),
    );
  }
  private success(request: ControlRequest, data: unknown, frame?: number): ControlResponse {
    return snapshot({
      protocol: CONTROL_PROTOCOL,
      id: request.id,
      operation: request.operation,
      ok: true,
      ack: frame === undefined ? { status: 'completed' } : { status: 'applied', frame },
      data,
    });
  }
  private failure(
    request: ControlRequest,
    code: ControlErrorCode,
    message: string,
  ): ControlResponse {
    return snapshot({
      protocol: CONTROL_PROTOCOL,
      id: request.id,
      operation: request.operation,
      ok: false,
      error: { code, message },
    });
  }
  private fromError(
    request: ControlRequest,
    error: unknown,
    fallback: ControlErrorCode = 'VALIDATION_FAILED',
  ) {
    return this.failure(
      request,
      error instanceof ControlError ? error.code : fallback,
      error instanceof Error ? error.message : String(error),
    );
  }
}
