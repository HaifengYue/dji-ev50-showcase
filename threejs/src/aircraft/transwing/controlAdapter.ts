import type { AircraftControlCommand, ControlLease } from '../../control/contracts';
import { SimulationRuntime, applyStatePatch, PROTOCOL, type StatePatch } from './core/simulation';
import { worldToLegacyPosition } from './worldFlight';

type Lease = Pick<ControlLease, 'controlMode' | 'clock'>;
/** Maps the common external world-pose contract to the unchanged deterministic
 * Transwing protocol. The host frame loop may apply/render, never advance this clock.
 */
export class TranswingControlAdapter {
  lease: Lease | null = null;
  velocity: [number, number, number] | null = null;
  constructor(readonly runtime: SimulationRuntime) {}
  acquire(lease: Lease) {
    const before = this.runtime.getSnapshot();
    if (
      before.control !== 'local' ||
      before.connection === 'connecting' ||
      before.connection === 'connected'
    )
      throw new Error('Release Python or JSON replay before acquiring unified control');
    if ((lease.controlMode === 'external') !== (lease.clock === 'external'))
      throw new Error('Transwing supports local/host and external/external ownership only');
    if (this.lease) throw new Error('Unified control is already acquired');
    if (lease.controlMode === 'external') {
      const state = {
        ...structuredClone(before.state),
        owner: 'external' as const,
        time: { ...before.state.time, seconds: 0, paused: true },
      };
      this.runtime.connect();
      this.runtime.accept({ protocol: PROTOCOL, revision: 0, op: 'snapshot', state });
    }
    this.lease = { ...lease };
    this.velocity = lease.controlMode === 'external' ? [0, 0, 0] : null;
  }
  release() {
    if (!this.lease) return false;
    this.lease = null;
    this.velocity = null;
    if (!this.runtime.getSnapshot().disposed) this.runtime.resetLocal();
    return true;
  }
  external(command: AircraftControlCommand) {
    if (this.lease?.controlMode !== 'external' || this.lease.clock !== 'external')
      throw new Error('An external-clock control lease is required');
    const before = this.runtime.getSnapshot();
    if (before.control !== 'external') throw new Error('External runtime ownership was lost');
    let patch: StatePatch;
    let velocity = this.velocity;
    let op: 'set' | 'step' | 'pause' = 'set';
    switch (command.operation) {
      case 'aircraft.pose': {
        const input = command.payload;
        if (input.velocityMps !== undefined) {
          if (
            input.velocityMps.length !== 3 ||
            !input.velocityMps.every((value) => Number.isFinite(value) && Math.abs(value) <= 100000)
          )
            throw new Error('Velocity must contain three finite metre/second values');
          velocity = [...input.velocityMps];
        }
        if (input.timeSeconds !== undefined && input.timeSeconds < before.state.time.seconds)
          throw new Error('External time cannot move backwards');
        patch = {
          ...(input.positionM ? { positionM: worldToLegacyPosition(input.positionM) } : {}),
          ...(input.attitude ? { attitude: input.attitude } : {}),
          ...(input.timeSeconds !== undefined ? { time: { seconds: input.timeSeconds } } : {}),
        };
        break;
      }
      case 'clock.step':
        if (before.state.time.paused) throw new Error('Resume external playback before clock.step');
        if (
          !Number.isFinite(command.payload.dt) ||
          command.payload.dt < 0 ||
          command.payload.dt > 60
        )
          throw new Error('External step must be within [0, 60] seconds');
        patch = {
          time: { seconds: before.state.time.seconds + command.payload.dt },
          ...(velocity
            ? {
                positionM: before.state.positionM.map(
                  (value, index) => value + velocity![index] * command.payload.dt,
                ) as [number, number, number],
              }
            : {}),
        };
        op = 'step';
        break;
      case 'transport.play':
        patch = { time: { paused: false } };
        break;
      case 'transport.pause':
        patch = { time: { paused: true } };
        op = 'pause';
        break;
      case 'transwing.mechanism':
        patch = command.payload;
        break;
      case 'transwing.motors':
        patch = command.payload;
        break;
      case 'transwing.surfaces':
        patch = command.payload;
        break;
      default:
        throw new Error(`Unsupported externally controlled operation: ${command.operation}`);
    }
    // Validation happens before either owner state or rendered geometry can change.
    const state = applyStatePatch(before.state, patch);
    state.owner = 'external';
    const accepted = this.runtime.accept({
      protocol: PROTOCOL,
      revision: before.revision + 1,
      op,
      state,
      ...(op === 'step' ? { dt: (command.payload as { dt: number }).dt } : {}),
    });
    if (accepted) this.velocity = velocity;
    return accepted;
  }
}
