/**
 * Loopback-only MAVLink-shaped WebSocket broker for visual integration tests.
 * It is a deterministic local simulator, never a MAVLink serial proxy and
 * never sends packets to a physical aircraft.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.EV50_MAVLINK_PORT ?? process.argv[2] ?? 8765);
const clients = new Map();
const state = {
  armed: false,
  mode: 'STANDBY',
  vtolState: 'MC',
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  targetPosition: null,
  quaternion: [1, 0, 0, 0],
  surfaces: [0, 0, 0],
  liftRpm: 0,
  cruiseRpm: 0,
  mission: 'valley',
  paused: false,
};

const safeNumber = (value, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const values = (input, count, fallback = 0) =>
  Array.from({ length: count }, (_, index) => safeNumber(input?.[index], fallback));
const timeUsec = () => Math.round(performance.now() * 1000);
const controlState = () => ({
  armed: state.armed,
  mode: state.mode,
  vtol_state: state.vtolState,
  mission: state.mission,
  paused: state.paused,
  position_ned: state.position,
  velocity_ned: state.velocity,
  quaternion_wxyz: state.quaternion,
  surfaces: state.surfaces,
  rotor_rpm: [...Array(8).fill(state.liftRpm), state.cruiseRpm, state.cruiseRpm, state.cruiseRpm],
});
const payload = (message) => Buffer.from(JSON.stringify(message));
const send = (socket, message) => {
  if (socket.destroyed) return;
  const body = payload(message);
  if (body.length > 65535) return;
  const header =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  socket.write(Buffer.concat([header, body]));
};
const broadcast = (message) => {
  for (const [socket, role] of clients) if (role === 'visualizer') send(socket, message);
};
const acknowledge = (socket, command, result = 'ACCEPTED') =>
  send(socket, {
    time_usec: timeUsec(),
    type: 'EV50_COMMAND_ACK',
    command,
    result,
    state: controlState(),
  });

function applyCommand(message) {
  const type = String(message.type ?? '');
  if (type === 'SET_POSITION_TARGET_LOCAL_NED') {
    state.targetPosition = values([message.x, message.y, message.z], 3);
    state.mode = 'GUIDED';
  } else if (type === 'SET_ATTITUDE_TARGET') {
    state.quaternion = values([message.q1, message.q2, message.q3, message.q4], 4);
    const magnitude = Math.hypot(...state.quaternion);
    state.quaternion = magnitude
      ? state.quaternion.map((value) => value / magnitude)
      : [1, 0, 0, 0];
    const thrust = Math.max(0, Math.min(1, safeNumber(message.thrust)));
    state.liftRpm = Math.round(thrust * 1800);
  } else if (type === 'SET_ACTUATOR_CONTROL_TARGET') {
    const controls = values(message.controls, 5);
    state.surfaces = controls.slice(0, 3).map((value) => Math.max(-1, Math.min(1, value)));
    state.liftRpm = Math.round(Math.max(0, Math.min(1, controls[3])) * 1800);
    state.cruiseRpm = Math.round(Math.max(0, Math.min(1, controls[4])) * 2200);
  } else if (type === 'SET_MODE') {
    state.mode = String(message.custom_mode ?? message.mode ?? 'GUIDED');
  } else if (type === 'MISSION_SET_CURRENT') {
    state.mission = String(message.mission ?? message.seq ?? 'valley');
  } else if (type === 'EV50_CONTROL') {
    if (message.position_ned) state.targetPosition = values(message.position_ned, 3);
    if (message.velocity_ned) {
      state.velocity = values(message.velocity_ned, 3);
      state.targetPosition = null;
    }
    if (message.quaternion_wxyz) state.quaternion = values(message.quaternion_wxyz, 4);
    if (message.surfaces) state.surfaces = values(message.surfaces, 3);
    if (message.lift_rpm !== undefined)
      state.liftRpm = Math.max(0, Math.min(1800, safeNumber(message.lift_rpm)));
    if (message.cruise_rpm !== undefined)
      state.cruiseRpm = Math.max(0, Math.min(2200, safeNumber(message.cruise_rpm)));
  } else if (type === 'COMMAND_LONG') {
    const command = String(message.command ?? '');
    if (command === 'MAV_CMD_COMPONENT_ARM_DISARM') state.armed = safeNumber(message.param1) >= 0.5;
    else if (command === 'MAV_CMD_NAV_TAKEOFF') {
      state.armed = true;
      state.mode = 'TAKEOFF';
      state.targetPosition = [
        state.position[0],
        state.position[1],
        -Math.max(1, safeNumber(message.param7, 20)),
      ];
      state.liftRpm = Math.max(state.liftRpm, 1250);
    } else if (command === 'MAV_CMD_NAV_LAND') {
      state.mode = 'LAND';
      state.targetPosition = [state.position[0], state.position[1], 0];
      state.cruiseRpm = 0;
    } else if (command === 'MAV_CMD_DO_VTOL_TRANSITION') {
      state.vtolState = safeNumber(message.param1) >= 4 ? 'FW' : 'MC';
      state.mode = state.vtolState === 'FW' ? 'CRUISE' : 'HOVER';
    } else if (command === 'MAV_CMD_DO_PAUSE_CONTINUE')
      state.paused = safeNumber(message.param1) < 0.5;
  } else {
    throw new Error(`Unsupported local MAVLink command: ${type}`);
  }
  return type;
}

function decodeFrames(socket, onMessage) {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const first = pending[0],
        masked = (pending[1] & 0x80) !== 0;
      let length = pending[1] & 0x7f,
        offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      }
      if (!masked || length > 65535 || pending.length < offset + 4 + length) return;
      const mask = pending.subarray(offset, offset + 4);
      offset += 4;
      const data = Buffer.from(pending.subarray(offset, offset + length));
      for (let index = 0; index < data.length; index++) data[index] ^= mask[index % 4];
      pending = pending.subarray(offset + length);
      const opcode = first & 0x0f;
      if (opcode === 8) return socket.end();
      if (opcode === 9) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
      if (opcode === 1) onMessage(data.toString('utf8'));
    }
  });
}

const server = http.createServer((request, response) => {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: false, error: 'WebSocket endpoint only' }));
});
server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') return socket.destroy();
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const role =
    new URL(request.url ?? '/', 'http://localhost').searchParams.get('role') === 'controller'
      ? 'controller'
      : 'visualizer';
  clients.set(socket, role);
  decodeFrames(socket, (text) => {
    try {
      const command = applyCommand(JSON.parse(text));
      acknowledge(socket, command);
    } catch (error) {
      send(socket, {
        time_usec: timeUsec(),
        type: 'EV50_COMMAND_ACK',
        result: 'DENIED',
        message: String(error),
      });
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  send(socket, { time_usec: timeUsec(), type: 'EV50_CONTROL_STATE', ...controlState() });
});

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(),
    dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (!state.paused && state.targetPosition) {
    const delta = state.targetPosition.map((value, index) => value - state.position[index]);
    const distance = Math.hypot(...delta);
    state.velocity =
      distance < 0.05 ? [0, 0, 0] : delta.map((value) => Math.max(-12, Math.min(12, value * 1.8)));
    if (distance < 0.05) state.targetPosition = null;
  }
  if (!state.paused)
    state.position = state.position.map((value, index) => value + state.velocity[index] * dt);
  if (!state.armed && state.position[2] >= -0.05) state.liftRpm = state.cruiseRpm = 0;
  const time_usec = timeUsec(),
    rotor = [...Array(8).fill(state.liftRpm), state.cruiseRpm, state.cruiseRpm, state.cruiseRpm];
  broadcast({
    time_usec,
    type: 'HEARTBEAT',
    vehicle_type: 'VTOL',
    autopilot: 'EV50_LOCAL_SIM',
    base_mode: state.mode,
  });
  broadcast({
    time_usec,
    type: 'SYS_STATUS',
    voltage_battery: 52000,
    current_battery: state.armed ? 180 : 0,
    battery_remaining: 96,
  });
  broadcast({
    time_usec,
    type: 'LOCAL_POSITION_NED',
    x: state.position[0],
    y: state.position[1],
    z: state.position[2],
    vx: state.velocity[0],
    vy: state.velocity[1],
    vz: state.velocity[2],
  });
  broadcast({
    time_usec,
    type: 'VFR_HUD',
    groundspeed: Math.hypot(...state.velocity),
    alt: -state.position[2],
    throttle: Math.round((state.liftRpm / 1800) * 100),
  });
  broadcast({
    time_usec,
    type: 'ACTUATOR_OUTPUT_STATUS',
    actuator: rotor,
    controls: state.surfaces,
  });
  broadcast({
    time_usec,
    type: 'ATTITUDE_QUATERNION',
    q1: state.quaternion[0],
    q2: state.quaternion[1],
    q3: state.quaternion[2],
    q4: state.quaternion[3],
  });
  broadcast({
    time_usec,
    type: 'EV50_VTOL_STATUS',
    state: state.vtolState,
    armed: state.armed,
    mode: state.mode,
    mission: state.mission,
  });
}, 50).unref();

server.listen(port, '127.0.0.1', () =>
  console.log(`EV50 MAVLink visual test server: ws://127.0.0.1:${port}`),
);
