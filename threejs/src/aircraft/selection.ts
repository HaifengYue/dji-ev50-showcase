/** A disposable aircraft is owned by exactly one selection controller. */
export type DisposableAircraft = { dispose(): void };

export type AircraftSelectionOptions<T extends DisposableAircraft> = {
  /** Return a fresh instance. Honour abort when possible; late results are still cleaned up. */
  load(id: string, signal: AbortSignal): Promise<T>;
  onPending?(id: string): void;
  onReady?(id: string, instance: T): void;
  onError?(id: string, error: unknown): void;
};

export type AircraftSelection<T extends DisposableAircraft> = {
  /** Resolves when ready, failed, or superseded. It never rejects. */
  select(id: string): Promise<void>;
  /** Terminal and idempotent. Future selections are ignored. */
  dispose(): void;
  readonly current: T | null;
  readonly currentId: string | null;
  readonly pendingId: string | null;
  readonly error: unknown | null;
};

type PendingSelection = {
  id: string;
  generation: number;
  controller: AbortController;
  promise: Promise<void>;
  finish(): void;
};

/**
 * Owns asynchronous aircraft replacement independently of rendering/UI code.
 * A replacement clears and disposes the previous aircraft before loading. Repeated
 * pending selections share a promise; selecting the ready aircraft is a no-op.
 * Failed selections can be retried. Cancellation settles immediately even if a
 * loader ignores its signal, while its eventual result remains owned and disposed.
 * State is updated before user hooks so synchronous, reentrant selections are safe.
 * Teardown is best effort: one throwing dispose/error hook cannot strand ownership.
 */
export function createAircraftSelection<T extends DisposableAircraft>(
  options: AircraftSelectionOptions<T>,
): AircraftSelection<T> {
  let current: T | null = null;
  let currentId: string | null = null;
  let pending: PendingSelection | null = null;
  let error: unknown | null = null;
  let generation = 0;
  let disposed = false;
  const disposedInstances = new WeakSet<T>();
  const settled = Promise.resolve();

  function release(instance: T | null) {
    if (!instance || disposedInstances.has(instance)) return;
    disposedInstances.add(instance);
    try {
      instance.dispose();
    } catch {
      // Dispose is terminal: never retry it or let one broken adapter retain the host.
    }
  }

  function isLatest(request: PendingSelection) {
    return !disposed && generation === request.generation;
  }

  function fail(request: PendingSelection, cause: unknown) {
    if (isLatest(request)) {
      pending = null;
      error = cause;
      try {
        options.onError?.(request.id, cause);
      } catch {
        // Consumer notification failures must not create an unhandled rejection.
      }
    }
    request.finish();
  }

  function accept(request: PendingSelection, instance: T) {
    if (!isLatest(request)) {
      release(instance);
      request.finish();
      return;
    }
    pending = null;
    current = instance;
    currentId = request.id;
    try {
      options.onReady?.(request.id, instance);
    } catch (cause) {
      if (isLatest(request)) {
        current = null;
        currentId = null;
        release(instance);
        fail(request, cause);
      }
    } finally {
      request.finish();
    }
  }

  return {
    select(id) {
      if (disposed) return settled;
      if (pending?.id === id) return pending.promise;
      if (current && currentId === id) return settled;

      const previousPending = pending;
      const previousCurrent = current;
      let finish!: () => void;
      const request: PendingSelection = {
        id,
        generation: ++generation,
        controller: new AbortController(),
        promise: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        finish: () => finish(),
      };
      // Claim the new generation before any teardown can call back into select().
      pending = request;
      current = null;
      currentId = null;
      error = null;
      previousPending?.finish();
      previousPending?.controller.abort();
      release(previousCurrent);
      if (!isLatest(request)) return request.promise;

      try {
        options.onPending?.(id);
        if (isLatest(request)) {
          Promise.resolve(options.load(id, request.controller.signal)).then(
            (instance) => accept(request, instance),
            (cause: unknown) => fail(request, cause),
          );
        }
      } catch (cause) {
        fail(request, cause);
      }
      return request.promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      const previousPending = pending;
      const previousCurrent = current;
      pending = null;
      current = null;
      currentId = null;
      error = null;
      previousPending?.finish();
      previousPending?.controller.abort();
      release(previousCurrent);
    },
    get current() {
      return current;
    },
    get currentId() {
      return currentId;
    },
    get pendingId() {
      return pending?.id ?? null;
    },
    get error() {
      return error;
    },
  };
}
