import type { AircraftControlCommand } from '../control/contracts';
import { FlightController } from '../flight';
import type { TelemetryFrame } from '../simulation/telemetry';

/** EV50 unified authority is separate from the legacy route controller. A render tick
 * may read this frame, but only clock.step advances its time, position and rotor phase. */
export class Ev50ExternalControl {
  private frame: TelemetryFrame | null = null;
  private paused = true;
  private sequence = 0;
  private angles = Array(11).fill(0) as number[];
  acquire(flight: FlightController) {
    this.frame = {
      version: 1,
      sequence: ++this.sequence,
      time: 0,
      frame: 'SCENE',
      position: flight.position.toArray(),
      quaternion: flight.quaternion.toArray(),
      velocity: [0, 0, 0],
      rotorRpm: Array.from(
        { length: 11 },
        (_, index) => (index < 8 ? flight.lift : flight.cruise) * 1800,
      ),
      surfaces: { aileron: 0, elevator: 0, rudder: 0 },
    };
    this.paused = true;
    this.angles.fill(0);
    flight.pause();
  }
  release() {
    this.frame = null;
    this.paused = true;
  }
  get active() {
    return this.frame !== null;
  }
  get playing() {
    return !this.paused;
  }
  angle(index: number) {
    return this.angles[index] ?? 0;
  }
  snapshot() {
    return this.frame ? structuredClone(this.frame) : null;
  }
  apply(command: AircraftControlCommand) {
    if (!this.frame) throw new Error('EV50 external lease is required');
    const next = structuredClone(this.frame);
    let nextAngles = this.angles;
    switch (command.operation) {
      case 'aircraft.pose':
        if (command.payload.positionM) next.position = [...command.payload.positionM];
        if (command.payload.attitude) next.quaternion = [...command.payload.attitude];
        if (command.payload.velocityMps) next.velocity = [...command.payload.velocityMps];
        if (command.payload.timeSeconds !== undefined) next.time = command.payload.timeSeconds;
        break;
      case 'clock.step': {
        if (this.paused) throw new Error('Resume external playback before clock.step');
        const dt = command.payload.dt;
        next.time += dt;
        next.position = next.position.map((value, index) => value + next.velocity[index] * dt) as [
          number,
          number,
          number,
        ];
        nextAngles = this.angles.map(
          (angle, index) =>
            (angle + (next.rotorRpm[index] * Math.PI * 2 * dt) / 60) % (Math.PI * 2),
        );
        break;
      }
      case 'transport.play':
        this.paused = false;
        break;
      case 'transport.pause':
        this.paused = true;
        break;
      case 'ev50.motors':
        next.rotorRpm = Array.from(
          { length: 11 },
          (_, index) => (index < 8 ? command.payload.lift : command.payload.cruise) * 1800,
        );
        break;
      default:
        throw new Error(`Unsupported EV50 external operation: ${command.operation}`);
    }
    if (
      !next.position.every((value) => Number.isFinite(value) && Math.abs(value) <= 100000) ||
      !Number.isFinite(next.time) ||
      next.time < 0 ||
      next.time > 86400
    ) {
      throw new Error('External pose/time exceeds supported bounds');
    }
    this.angles = nextAngles;
    next.sequence = ++this.sequence;
    this.frame = next;
  }
}
