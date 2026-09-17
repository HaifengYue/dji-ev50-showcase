import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 18986;
const child = spawn(process.execPath, ['mavlink-visual-server.mjs', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const output = [];
child.stdout.on('data', (data) => output.push(String(data)));
child.stderr.on('data', (data) => output.push(String(data)));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const open = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error(output.join(''))), { once: true });
  });
const next = (socket, type) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Missing ${type}: ${output.join('')}`)),
      2000,
    );
    const receive = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', receive);
      resolve(message);
    };
    socket.addEventListener('message', receive);
  });
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await wait(50);
    }
    if (attempt === 39) throw new Error(output.join(''));
  }
  const visualizer = await open(`ws://127.0.0.1:${port}`);
  const localPosition = await next(visualizer, 'LOCAL_POSITION_NED');
  assert.equal(localPosition.type, 'LOCAL_POSITION_NED');
  const controller = await open(`ws://127.0.0.1:${port}/?role=controller`);
  await next(controller, 'EV50_CONTROL_STATE');
  controller.send(
    JSON.stringify({ type: 'COMMAND_LONG', command: 'MAV_CMD_COMPONENT_ARM_DISARM', param1: 1 }),
  );
  assert.equal((await next(controller, 'EV50_COMMAND_ACK')).result, 'ACCEPTED');
  controller.send(
    JSON.stringify({ type: 'COMMAND_LONG', command: 'MAV_CMD_NAV_TAKEOFF', param7: 18 }),
  );
  assert.equal((await next(controller, 'EV50_COMMAND_ACK')).state.mode, 'TAKEOFF');
  controller.send(
    JSON.stringify({
      type: 'SET_ACTUATOR_CONTROL_TARGET',
      controls: [0.2, -0.1, 0.05, 0.8, 0.4],
    }),
  );
  assert.equal((await next(controller, 'EV50_COMMAND_ACK')).state.rotor_rpm[0], 1440);
  controller.close();
  visualizer.close();
  console.log('PASS MAVLink local visual server');
} finally {
  child.kill();
}
