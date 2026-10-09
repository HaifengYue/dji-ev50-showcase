import type { AircraftControlCommand, AircraftOperation } from './contracts';
import { finite, onlyKeys, plainRecord } from './config';

export const COMMON_OPERATIONS: readonly AircraftOperation[] = [
  'aircraft.pose',
  'clock.step',
  'transport.play',
  'transport.pause',
  'transport.reset',
  'transport.seek',
  'transport.speed',
  'transport.loop',
];
export const MODEL_OPERATIONS: readonly AircraftOperation[] = [
  'ev50.motors',
  'skytrans.mechanism',
  'skytrans.motors',
  'skytrans.surfaces',
];
const MOTOR_IDS = ['L_Front', 'R_Front', 'L_Rear', 'R_Rear'];
const SURFACE_IDS = ['L_Inboard', 'R_Inboard', 'L_Outboard', 'R_Outboard', 'Tail_L', 'Tail_R'];
const vector = (value: unknown, size: number, limit: number, label: string) => {
  if (!Array.isArray(value) || value.length !== size)
    throw new Error(`${label} must have ${size} components`);
  value.forEach((v) => finite(v, -limit, limit, label));
};
function nonempty(value: Record<string, unknown>, label: string) {
  if (!Object.keys(value).length) throw new Error(`${label} must not be empty`);
}
function surfaces(input: unknown) {
  const value = plainRecord(input, 'surfaces');
  onlyKeys(value, SURFACE_IDS, 'surfaces');
  nonempty(value, 'surfaces');
  Object.values(value).forEach((v) => finite(v, -12, 12, 'surface degrees'));
}
/** Shape and numeric validation before any adapter side effects. */
export function validateAircraftCommand(
  operation: AircraftOperation,
  input: unknown,
): AircraftControlCommand {
  const p = plainRecord(input ?? {}, 'payload');
  switch (operation) {
    case 'aircraft.pose': {
      onlyKeys(p, ['positionM', 'attitude', 'velocityMps', 'timeSeconds'], operation);
      nonempty(p, operation);
      if ('positionM' in p) vector(p.positionM, 3, 100000, 'positionM');
      if ('velocityMps' in p) vector(p.velocityMps, 3, 100000, 'velocityMps');
      if ('attitude' in p) {
        vector(p.attitude, 4, 1, 'attitude');
        const norm = Math.hypot(...(p.attitude as number[]));
        if (Math.abs(norm - 1) > 0.001)
          throw new Error('attitude must be a unit quaternion in XYZW order');
      }
      if ('timeSeconds' in p) finite(p.timeSeconds, 0, 1e12, 'timeSeconds');
      break;
    }
    case 'clock.step':
      onlyKeys(p, ['dt'], operation);
      finite(p.dt, 0, 60, 'dt');
      break;
    case 'transport.play':
    case 'transport.pause':
    case 'transport.reset':
      onlyKeys(p, [], operation);
      break;
    case 'transport.seek':
      onlyKeys(p, ['position', 'unit'], operation);
      finite(p.position, 0, 1e12, 'position');
      if (!['seconds', 'frames', 'percent'].includes(p.unit as string))
        throw new Error('seek unit must be explicit');
      if (p.unit === 'frames' && !Number.isInteger(p.position))
        throw new Error('frame position must be an integer');
      if (p.unit === 'percent') finite(p.position, 0, 100, 'position');
      break;
    case 'transport.speed':
      onlyKeys(p, ['speed'], operation);
      finite(p.speed, 0.1, 4, 'speed');
      break;
    case 'transport.loop':
      onlyKeys(p, ['loop'], operation);
      if (typeof p.loop !== 'boolean') throw new Error('loop must be boolean');
      break;
    case 'ev50.motors':
      onlyKeys(p, ['lift', 'cruise'], operation);
      finite(p.lift, 0, 1, 'lift');
      finite(p.cruise, 0, 1, 'cruise');
      break;
    case 'skytrans.mechanism':
      onlyKeys(p, ['wingTilt', 'hatchDeg', 'surfaces'], operation);
      nonempty(p, operation);
      if ('wingTilt' in p) finite(p.wingTilt, 0, 1, 'wingTilt');
      if ('hatchDeg' in p) finite(p.hatchDeg, 0, 55, 'hatchDeg');
      if ('surfaces' in p) surfaces(p.surfaces);
      break;
    case 'skytrans.surfaces':
      onlyKeys(p, ['surfaces'], operation);
      surfaces(p.surfaces);
      break;
    case 'skytrans.motors': {
      onlyKeys(p, ['motors'], operation);
      const motors = plainRecord(p.motors, 'motors');
      onlyKeys(motors, MOTOR_IDS, 'motors');
      nonempty(motors, 'motors');
      for (const [id, input] of Object.entries(motors)) {
        const motor = plainRecord(input, id);
        onlyKeys(motor, ['targetRpm', 'enabled'], id);
        nonempty(motor, id);
        if ('targetRpm' in motor) finite(motor.targetRpm, 0, 12000, `${id}.targetRpm`);
        if ('enabled' in motor && typeof motor.enabled !== 'boolean')
          throw new Error(`${id}.enabled must be boolean`);
      }
      break;
    }
  }
  return structuredClone({ operation, payload: p }) as AircraftControlCommand;
}
