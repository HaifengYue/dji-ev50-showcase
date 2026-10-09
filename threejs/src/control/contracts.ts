/** Browser control contract. HTTP/WebSocket exposure is explicitly not implied. */
export const CONTROL_PROTOCOL = 'hangar.control.v1' as const;
import type { AircraftId } from '../aircraft/identity';
export type { AircraftId } from '../aircraft/identity';
export type Vector3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export type TimeUnit = 'seconds' | 'frames' | 'percent';
export type ControlMode = 'local' | 'external';
export type ClockAuthority = 'host' | 'external';
export const WORLD_COORDINATES = Object.freeze({
  frame: 'scene',
  handedness: 'right',
  up: '+Y',
  position: 'meters',
  velocity: 'meters/second',
  attitude: 'quaternion-XYZW',
  time: 'seconds',
} as const);
export type BodyCoordinates = {
  forward: string;
  up: string;
  /** Actual asset/rig origin; never imply center of mass without supporting data. */
  origin: string;
};
export type PoseCommand = {
  positionM?: Vector3;
  attitude?: Quaternion;
  velocityMps?: Vector3;
  timeSeconds?: number;
};
export type AircraftControlCommand =
  | { operation: 'aircraft.pose'; payload: PoseCommand }
  | {
      operation: 'transport.play' | 'transport.pause' | 'transport.reset';
      payload: Record<string, never>;
    }
  | { operation: 'transport.seek'; payload: { position: number; unit: TimeUnit } }
  | { operation: 'transport.speed'; payload: { speed: number } }
  | { operation: 'transport.loop'; payload: { loop: boolean } }
  | { operation: 'clock.step'; payload: { dt: number } }
  | { operation: 'ev50.motors'; payload: { lift: number; cruise: number } }
  | {
      operation: 'skytrans.mechanism';
      payload: { wingTilt?: number; hatchDeg?: number; surfaces?: Record<string, number> };
    }
  | {
      operation: 'skytrans.motors';
      payload: { motors: Record<string, { targetRpm?: number; enabled?: boolean }> };
    }
  | { operation: 'skytrans.surfaces'; payload: { surfaces: Record<string, number> } };
export type AircraftOperation = AircraftControlCommand['operation'];
export type AircraftControlCapabilities = {
  aircraft: AircraftId;
  operations: readonly AircraftOperation[];
  body: BodyCoordinates;
  rotorCount: 11 | 4;
  /** Only real adapter functionality belongs here. */
  notes?: readonly string[];
};
export type AdapterAircraftState = {
  pose: { positionM: Vector3; attitude: Quaternion; velocityMps: Vector3 | null };
  clock: { authority: 'host' | 'external' | 'replay'; seconds: number | null };
  controlMode: 'local' | 'external' | 'replay';
  transport: {
    playing: boolean;
    position: number;
    duration: number;
    unit: TimeUnit;
    speed: number | null;
    loop: boolean;
  };
  model:
    | { aircraft: 'ev50'; rotorCount: 11; rotorsRpm?: number[] }
    | {
        aircraft: 'skytrans';
        rotorCount: 4;
        wingTilt?: number;
        hatchDeg?: number;
        motors?: Record<string, { targetRpm: number; enabled: boolean }>;
        surfaces?: Record<string, number>;
      };
};
export type ControlContext = {
  aircraft: AircraftId;
  generation: number;
  ready: boolean;
  blockedReason?: string;
};
export type ControlLease = {
  leaseId: string;
  owner: string;
  aircraft: AircraftId;
  generation: number;
  controlMode: ControlMode;
  clock: ClockAuthority;
  /** Epoch milliseconds according to the gateway clock. */
  expiresAt: number;
};
export type ControlConfig = {
  transport: 'browser' | 'local-http';
  /** Same-origin loopback endpoint, used only when local-http is explicitly enabled. */
  baseURL: string | null;
  localService: { enabled: boolean };
  controlMode: ControlMode;
  clock: ClockAuthority;
  units: typeof WORLD_COORDINATES;
  leaseTtlMs: number;
};
export type UnifiedAircraftState = {
  protocol: typeof CONTROL_PROTOCOL;
  commandEpoch: number;
  aircraft: AircraftId;
  generation: number;
  ready: boolean;
  coordinates: typeof WORLD_COORDINATES;
  body: BodyCoordinates;
  lease: ControlLease | null;
  state: AdapterAircraftState | null;
};
export type ControlRequest = {
  id?: string;
  /** Omitted means epoch 0; after reset clients must send the current epoch. */
  epoch?: number;
  operation: string;
  aircraft?: AircraftId;
  generation?: number;
  owner?: string;
  leaseId?: string;
  payload?: unknown;
};
export type ControlErrorCode =
  | 'INVALID_REQUEST'
  | 'VALIDATION_FAILED'
  | 'OPERATION_UNSUPPORTED'
  | 'AIRCRAFT_MISMATCH'
  | 'STALE_SELECTION'
  | 'STALE_SESSION'
  | 'NOT_READY'
  | 'CONTROL_BUSY'
  | 'LEASE_REQUIRED'
  | 'LEASE_EXPIRED'
  | 'OWNER_MISMATCH'
  | 'LEASE_MISMATCH'
  | 'ID_CONFLICT'
  | 'CAPACITY_EXCEEDED'
  | 'MODE_MISMATCH'
  | 'CLOCK_REGRESSION'
  | 'HOST_ERROR'
  | 'DISCONNECTED';
export type ControlResponse =
  | {
      protocol: typeof CONTROL_PROTOCOL;
      id?: string;
      operation: string;
      ok: true;
      ack: { status: 'completed' | 'applied'; frame?: number };
      data: unknown;
    }
  | {
      protocol: typeof CONTROL_PROTOCOL;
      id?: string;
      operation: string;
      ok: false;
      error: { code: ControlErrorCode; message: string };
    };
export interface UnifiedControlHost {
  getContext(): ControlContext;
  getState(): AdapterAircraftState;
  getCapabilities(): AircraftControlCapabilities;
  /** Synchronous, prevalidated, atomic update. Called before aircraft.update(). */
  apply(command: AircraftControlCommand): void;
  /** Set/unset adapter ownership. Throw before mutation if acquisition is unavailable. */
  leaseChanged?(lease: ControlLease | null, reason: string): void;
}
