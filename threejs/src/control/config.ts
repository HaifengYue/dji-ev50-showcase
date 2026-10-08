import { WORLD_COORDINATES, type ControlConfig } from './contracts';

export function defaultControlConfig(): ControlConfig {
  return {
    transport: 'browser',
    baseURL: null,
    localService: { enabled: false },
    controlMode: 'local',
    clock: 'host',
    units: WORLD_COORDINATES,
    leaseTtlMs: 30000,
  };
}
export function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`${label} has unknown fields`);
}
export function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label} must be finite and in [${min}, ${max}]`);
  return value;
}
/** Configuration is validated atomically and retained only in this gateway instance. */
export function validateControlConfig(
  current: ControlConfig,
  input: unknown,
  origin: string,
): ControlConfig {
  const patch = plainRecord(input, 'config');
  onlyKeys(
    patch,
    ['transport', 'baseURL', 'localService', 'controlMode', 'clock', 'units', 'leaseTtlMs'],
    'config',
  );
  const next = structuredClone(current);
  if ('transport' in patch) {
    if (patch.transport !== 'browser' && patch.transport !== 'local-http')
      throw new Error('transport must be browser or local-http; remote transports are reserved');
    next.transport = patch.transport;
  }
  if ('controlMode' in patch) {
    if (patch.controlMode !== 'local' && patch.controlMode !== 'external')
      throw new Error('controlMode must be local or external');
    next.controlMode = patch.controlMode;
  }
  if ('clock' in patch) {
    if (patch.clock !== 'host' && patch.clock !== 'external')
      throw new Error('clock must be host or external');
    next.clock = patch.clock;
  }
  if ((next.controlMode === 'external') !== (next.clock === 'external'))
    throw new Error('external mode requires external clock; local mode requires host clock');
  if ('leaseTtlMs' in patch) next.leaseTtlMs = finite(patch.leaseTtlMs, 1000, 120000, 'leaseTtlMs');
  if ('units' in patch) {
    const units = plainRecord(patch.units, 'units');
    onlyKeys(units, Object.keys(WORLD_COORDINATES), 'units');
    for (const [key, value] of Object.entries(units))
      if (value !== WORLD_COORDINATES[key as keyof typeof WORLD_COORDINATES])
        throw new Error(`Unsupported unit: ${key}`);
  }
  if ('localService' in patch) {
    const service = plainRecord(patch.localService, 'localService');
    onlyKeys(service, ['enabled'], 'localService');
    if (typeof service.enabled !== 'boolean')
      throw new Error('localService.enabled must be boolean');
    next.localService = { enabled: service.enabled };
  }
  if ('baseURL' in patch) {
    if (patch.baseURL !== null && (typeof patch.baseURL !== 'string' || !patch.baseURL))
      throw new Error('baseURL must be null or an absolute URL');
    next.baseURL = patch.baseURL as string | null;
  }
  if (next.baseURL !== null) {
    let base: URL, page: URL;
    try {
      base = new URL(next.baseURL);
      page = new URL(origin);
    } catch {
      throw new Error('baseURL and page origin must be valid absolute URLs');
    }
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.origin !== page.origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error(
        'baseURL must be same-origin loopback HTTP(S), without credentials, query or fragment',
      );
    if (!next.localService.enabled)
      throw new Error('baseURL requires explicit localService.enabled');
    next.baseURL = base.href.replace(/\/$/, '');
  } else if (next.localService.enabled) throw new Error('localService.enabled requires baseURL');
  if (next.transport === 'local-http' && (!next.localService.enabled || !next.baseURL))
    throw new Error('local-http requires an explicitly enabled same-origin loopback service');
  return next;
}
