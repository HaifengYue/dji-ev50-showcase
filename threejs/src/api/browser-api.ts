import { ApiRequest, ApiResponse, FlightControlCommand } from './contracts';
import { Ev50ApiGateway } from './gateway';

type StateSubscriber<State> = (state: State) => void;
type LegacyApi<State> = {
  readonly ready: boolean;
  request(request: ApiRequest): ApiResponse;
  getState(): State;
  command(command: FlightControlCommand): State;
  motor(lift: number, cruise: number): State;
  position(position: number[]): State;
  velocity(velocity: number[]): State;
  attitude(quaternion: number[]): State;
  euler(roll: number, pitch: number, yaw: number): State;
  setRoute(route: string): State;
  play(): State;
  pause(): State;
  resume(): State;
  reset(): State;
  seek(seconds: number): State;
  setSpeed(speed: number): State;
  subscribe(callback: StateSubscriber<State>): () => void;
};

const unwrap = <T>(response: ApiResponse<T>): T => {
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
};

/** Installs the documented browser facade and maintains compatibility with API 2.x calls. */
export function installBrowserApi<State>(
  gateway: Ev50ApiGateway<State>,
  subscribe: (callback: StateSubscriber<State>) => () => void,
): LegacyApi<State> {
  const request = (request: ApiRequest) => gateway.request(request);
  const state = (operation: string, payload?: unknown) =>
    unwrap(request({ operation, payload }) as ApiResponse<State>);
  const api: LegacyApi<State> = {
    get ready() {
      const response = request({ operation: 'system.health' }) as ApiResponse<{ ready: boolean }>;
      return response.ok && response.data.ready;
    },
    request,
    getState: () => state('flight.state'),
    command: (command) => state('flight.command', command),
    motor: (lift, cruise) => state('flight.command', { type: 'motor', lift, cruise }),
    position: (position) => state('flight.command', { type: 'position', position }),
    velocity: (velocity) => state('flight.command', { type: 'velocity', velocity }),
    attitude: (quaternion) => state('flight.command', { type: 'attitude', quaternion }),
    euler: (roll, pitch, yaw) => {
      if (![roll, pitch, yaw].every(Number.isFinite)) throw new Error('Invalid Euler angles');
      const cy = Math.cos(yaw * 0.5),
        sy = Math.sin(yaw * 0.5),
        cp = Math.cos(pitch * 0.5),
        sp = Math.sin(pitch * 0.5),
        cr = Math.cos(roll * 0.5),
        sr = Math.sin(roll * 0.5);
      // Three.js Euler YXZ: pitch=X, yaw=Y, roll=Z.
      return state('flight.command', {
        type: 'attitude',
        quaternion: [
          sp * cy * cr + cp * sy * sr,
          cp * sy * cr - sp * cy * sr,
          cp * cy * sr - sp * sy * cr,
          cp * cy * cr + sp * sy * sr,
        ],
      });
    },
    setRoute: (route) => state('mission.select', { route }),
    play: () => state('flight.play'),
    pause: () => state('flight.pause'),
    resume: () => state('flight.resume'),
    reset: () => state('flight.reset'),
    seek: (seconds) => state('flight.seek', { seconds }),
    setSpeed: (speed) => state('flight.speed', { speed }),
    subscribe,
  };
  window.addEventListener('ev50-command', (event) => {
    const detail = (event as CustomEvent).detail as
      | ApiRequest
      | { id?: string; command?: FlightControlCommand }
      | FlightControlCommand
      | undefined;
    const isStructured = !!detail && typeof detail === 'object' && 'operation' in detail;
    const request = isStructured
      ? (detail as ApiRequest)
      : {
          id: (detail as { id?: string })?.id,
          operation: 'flight.command',
          payload: (detail as { command?: FlightControlCommand })?.command ?? detail,
        };
    const response = api.request(request);
    // `state` remains available for legacy ev50-command listeners; new callers use `data`.
    const result = !isStructured && response.ok ? { ...response, state: response.data } : response;
    window.dispatchEvent(new CustomEvent('ev50-result', { detail: result }));
  });
  return api;
}
