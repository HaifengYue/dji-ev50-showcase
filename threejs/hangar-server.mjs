/** One loopback-only origin serves both aircraft and the versioned control mailbox.
 * No aircraft I/O, authentication credentials, public binding or third-party proxy. */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const canonical = (value) =>
  Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object'
      ? '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
          .join(',') +
        '}'
      : JSON.stringify(value);
// Match the browser gateway's bounded compatibility aliases before deduplication.
const aircraftId = (value) => (value === 'transwing' ? 'skytrans' : value);
const operationAliases = new Map([
  ['transwing.mechanism', 'skytrans.mechanism'],
  ['transwing.motors', 'skytrans.motors'],
  ['transwing.surfaces', 'skytrans.surfaces'],
]);
const normalizedRequest = (request) => ({
  ...request,
  ...(request.aircraft === undefined ? {} : { aircraft: aircraftId(request.aircraft) }),
  operation: operationAliases.get(request.operation) ?? request.operation,
});
const prefix = '/api/hangar/v1';
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};
export function createHangarServer({
  dist = 'dist',
  port = 8790,
  now = Date.now,
  capacity = 2000,
} = {}) {
  const root = path.resolve(dist);
  const commands = new Map();
  let sequence = 0,
    viewer = null,
    snapshot = null,
    commandEpoch = 0,
    lastReset = null;
  const key = (epoch, id) => `${epoch}:${id}`;
  const serviceState = () => ({
    commandEpoch,
    capacity,
    retained: commands.size,
    remaining: Math.max(0, capacity - commands.size),
    canResetSession:
      !snapshot?.state?.lease && ![...commands.values()].some((entry) => !entry.response),
    reservedLifecycleSlots: 2,
  });
  // An explicit completed gateway reset is the only history-compaction authority.
  const acceptReset = (receipt, entry = null, allowSkippedEpochs = false) => {
    const request = receipt?.request,
      response = receipt?.response;
    if (
      !request ||
      !response?.ok ||
      response.operation !== 'control.resetSession' ||
      response.ack?.status !== 'completed' ||
      response.id !== request.id ||
      request.operation !== 'control.resetSession' ||
      request.payload?.acknowledgeCompletedResults !== true
    )
      return false;
    const oldEpoch = request.epoch ?? 0,
      nextEpoch = response.data?.commandEpoch;
    if (
      !Number.isSafeInteger(oldEpoch) ||
      nextEpoch !== oldEpoch + 1 ||
      (allowSkippedEpochs ? oldEpoch < commandEpoch : oldEpoch !== commandEpoch)
    )
      return false;
    lastReset = {
      sequence: entry?.sequence ?? ++sequence,
      request,
      response,
      body: canonical(normalizedRequest(request)),
      epoch: oldEpoch,
    };
    commands.clear();
    commandEpoch = nextEpoch;
    return true;
  };
  const send = (res, status, data) =>
    res
      .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(data));
  const fail = (res, status, code, message) =>
    send(res, status, { ok: false, error: { code, message } });
  const disconnectPending = (id) => {
    for (const entry of commands.values())
      if (!entry.response && entry.viewerId === id)
        entry.response = {
          protocol: 'hangar.control.v1',
          id: entry.request.id,
          operation: entry.request.operation,
          ok: false,
          error: {
            code: 'DISCONNECTED',
            message: 'Viewer left or expired before application was confirmed',
          },
        };
  };
  const live = () => {
    if (viewer && now() - viewer.seen >= 15000) {
      disconnectPending(viewer.id);
      viewer = snapshot = null;
    }
    return viewer !== null;
  };
  const read = async (req) => {
    let body = '',
      size = 0;
    for await (const bytes of req) {
      size += bytes.length;
      if (size > 65536) throw new Error('Body exceeds 64 KiB');
      body += bytes;
    }
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Expected a JSON object');
    return value;
  };
  const server = http.createServer(async (req, res) => {
    const actualPort = server.address()?.port ?? port;
    const expectedHost = `127.0.0.1:${actualPort}`;
    const origin = `http://${expectedHost}`;
    if (req.headers.host !== expectedHost)
      return fail(res, 403, 'HOST_REJECTED', 'Open the exact loopback URL printed by the launcher');
    if (req.headers.origin && req.headers.origin !== origin)
      return fail(res, 403, 'ORIGIN_REJECTED', 'Cross-origin access is disabled');
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return fail(res, 403, 'ORIGIN_REJECTED', 'Cross-site access is disabled');
    try {
      const url = new URL(req.url, origin),
        method = req.method;
      if (url.pathname.startsWith(prefix)) {
        const route = url.pathname.slice(prefix.length);
        if (method === 'GET' && route === '/health')
          return send(res, 200, {
            protocol: 'hangar.control.v1',
            service: 'hangar-local-control',
            ready: !!live(),
            viewer: live() ? viewer.id : null,
            history: serviceState(),
          });
        if (method === 'GET' && route === '/state')
          return send(res, 200, {
            ok: true,
            data: live() ? { ...snapshot, service: serviceState() } : null,
          });
        if (method === 'GET' && route.startsWith('/results/')) {
          const epoch = Number(url.searchParams.get('epoch') ?? 0);
          const id = decodeURIComponent(route.slice('/results/'.length));
          const entry =
            lastReset?.epoch === epoch && lastReset.request.id === id
              ? lastReset
              : commands.get(key(epoch, id));
          if (!entry && epoch !== commandEpoch)
            return fail(res, 409, 'STALE_SESSION', `Command epoch changed to ${commandEpoch}`);
          return entry
            ? send(res, 200, {
                ok: true,
                data: {
                  sequence: entry.sequence,
                  status: entry.response
                    ? entry.response.ok
                      ? entry.response.ack.status
                      : 'rejected'
                    : 'queued',
                  response: entry.response,
                },
              })
            : fail(res, 404, 'NOT_FOUND', 'Unknown command identity');
        }
        if (method === 'POST' && route === '/commands') {
          const request = await read(req);
          if (
            typeof request.id !== 'string' ||
            !/^[\w.:-]{1,128}$/.test(request.id) ||
            typeof request.operation !== 'string'
          )
            return fail(res, 400, 'INVALID_REQUEST', 'id and operation are required');
          if (
            Object.keys(request).some(
              (key) =>
                ![
                  'id',
                  'operation',
                  'aircraft',
                  'generation',
                  'owner',
                  'leaseId',
                  'payload',
                  'epoch',
                ].includes(key),
            )
          )
            return fail(res, 400, 'INVALID_REQUEST', 'Unknown command envelope field');
          const epoch = request.epoch === undefined ? 0 : request.epoch;
          if (!Number.isSafeInteger(epoch) || epoch < 0)
            return fail(res, 400, 'INVALID_REQUEST', 'epoch must be a nonnegative integer');
          const body = canonical(normalizedRequest(request));
          const existing =
            lastReset?.epoch === epoch && lastReset.request.id === request.id
              ? lastReset
              : commands.get(key(epoch, request.id));
          if (!existing && epoch !== commandEpoch)
            return fail(res, 409, 'STALE_SESSION', `Command epoch changed to ${commandEpoch}`);
          if (existing)
            return existing.body === body
              ? send(res, 202, {
                  ok: true,
                  data: { id: request.id, sequence: existing.sequence, duplicate: true },
                })
              : fail(res, 409, 'ID_CONFLICT', 'Command identity already has different content');
          if (!live())
            return fail(
              res,
              409,
              'VIEWER_REQUIRED',
              'Open the local page and enable its unified API first',
            );
          const lease = snapshot?.state?.lease;
          const plainPayload =
            request.payload === undefined ||
            (request.payload &&
              typeof request.payload === 'object' &&
              !Array.isArray(request.payload));
          const release =
            plainPayload &&
            Object.keys(request.payload ?? {}).length === 0 &&
            ['control.release', 'control.disconnect'].includes(request.operation) &&
            lease &&
            lease.owner === request.owner &&
            lease.leaseId === request.leaseId &&
            lease.aircraft === aircraftId(request.aircraft) &&
            lease.generation === request.generation;
          const reset =
            plainPayload &&
            Object.keys(request.payload ?? {}).length === 1 &&
            typeof request.owner === 'string' &&
            request.owner.trim() &&
            request.owner.length <= 128 &&
            request.operation === 'control.resetSession' &&
            request.payload?.acknowledgeCompletedResults === true &&
            aircraftId(request.aircraft) === snapshot?.state?.aircraft &&
            request.generation === snapshot?.state?.generation &&
            serviceState().canResetSession;
          const escape =
            (release || reset) &&
            commands.size < capacity + 2 &&
            ![...commands.values()].some(
              (entry) =>
                !entry.response &&
                ['control.release', 'control.disconnect', 'control.resetSession'].includes(
                  entry.request.operation,
                ),
            );
          if (commands.size >= capacity && !escape)
            return fail(
              res,
              429,
              release || reset ? 'LIFECYCLE_CAPACITY' : 'CAPACITY_EXCEEDED',
              release || reset
                ? 'HTTP lifecycle reserve is occupied. Use the page Disconnect / release button, save all results, then confirm Rotate command session; no reload or TTL wait is required.'
                : 'Release control, consume completed results, then explicitly reset the command session epoch',
            );
          const entry = {
            epoch,
            sequence: ++sequence,
            request,
            body,
            viewerId: viewer.id,
            response: null,
          };
          commands.set(key(epoch, request.id), entry);
          return send(res, 202, { ok: true, data: { id: request.id, sequence, status: 'queued' } });
        }
        if (method === 'POST' && route === '/viewer') {
          const data = await read(req);
          if (typeof data.viewerId !== 'string' || !/^[\w-]{1,128}$/.test(data.viewerId))
            return fail(res, 400, 'INVALID_REQUEST', 'viewerId is required');
          if (live() && viewer.id !== data.viewerId)
            return fail(res, 409, 'VIEWER_BUSY', 'Another page owns this local visual session');
          viewer = { id: data.viewerId, seen: now() };
          return send(res, 200, { ok: true });
        }
        const viewerId = url.searchParams.get('viewerId');
        if (!live() || viewer.id !== viewerId)
          return fail(res, 409, 'VIEWER_MISMATCH', 'Viewer is absent, expired or replaced');
        viewer.seen = now();
        if (method === 'DELETE' && route === '/viewer') {
          disconnectPending(viewer.id);
          viewer = snapshot = null;
          return send(res, 200, { ok: true });
        }
        if (method === 'GET' && route === '/commands') {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0)
            return fail(res, 400, 'INVALID_REQUEST', 'Invalid cursor');
          return send(res, 200, {
            ok: true,
            data: {
              commands: [...commands.values()]
                .filter(
                  (entry) =>
                    entry.viewerId === viewer.id && entry.sequence > after && !entry.response,
                )
                .map(({ sequence, request }) => ({ sequence, request })),
            },
          });
        }
        if (method === 'POST' && route === '/state') {
          const next = await read(req);
          if (next.state?.commandEpoch !== undefined && next.state.commandEpoch !== commandEpoch) {
            if (
              next.control?.data?.lastReset?.response?.data?.commandEpoch !==
                next.state.commandEpoch ||
              !acceptReset(next.control?.data?.lastReset, null, true)
            )
              return fail(
                res,
                409,
                'RESET_RECEIPT_REQUIRED',
                'Supply the successful gateway reset receipt before changing epoch',
              );
          }
          snapshot = next;
          return send(res, 200, { ok: true });
        }
        if (method === 'POST' && route === '/results') {
          const data = await read(req),
            epoch = data.epoch ?? 0;
          const entry =
            lastReset?.epoch === epoch && lastReset.request.id === data.id
              ? lastReset
              : commands.get(key(epoch, data.id));
          if (epoch < commandEpoch && entry !== lastReset)
            return send(res, 200, { ok: true, retired: true });
          if (
            !entry ||
            entry.sequence !== data.sequence ||
            (entry !== lastReset && entry.viewerId !== viewer.id) ||
            data.response?.id !== data.id ||
            data.response?.operation !== entry.request.operation ||
            typeof data.response?.ok !== 'boolean'
          )
            return fail(res, 409, 'RESULT_MISMATCH', 'Result must match its original command');
          if (data.response.ok && !['applied', 'completed'].includes(data.response.ack?.status))
            return fail(res, 400, 'INVALID_ACK', 'Result must have a gateway acknowledgement');
          if (entry.response && JSON.stringify(entry.response) !== JSON.stringify(data.response))
            return fail(res, 409, 'RESULT_CONFLICT', 'Original outcome is immutable');
          if (
            entry !== lastReset &&
            entry.request.operation === 'control.resetSession' &&
            data.response.ok
          ) {
            if (!acceptReset({ request: entry.request, response: data.response }, entry))
              return fail(
                res,
                409,
                'INVALID_RESET',
                'Reset result does not advance the current epoch exactly once',
              );
          }
          entry.response = data.response;
          if (data.response.ok && snapshot?.state) {
            if (entry.request.operation === 'control.acquire')
              snapshot.state.lease = data.response.data;
            if (['control.release', 'control.disconnect'].includes(entry.request.operation))
              snapshot.state.lease = null;
          }
          return send(res, 200, { ok: true });
        }
        return fail(res, 404, 'NOT_FOUND', 'Unknown unified route');
      }
      if (method !== 'GET' && method !== 'HEAD')
        return fail(res, 405, 'METHOD_REJECTED', 'Static assets are read-only');
      const file = path.resolve(
        root,
        decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html',
      );
      if (!file.startsWith(root + path.sep))
        return fail(res, 403, 'PATH_REJECTED', 'Path outside build');
      const data = await fs.readFile(file);
      res
        .writeHead(200, {
          'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        .end(method === 'HEAD' ? undefined : data);
    } catch (error) {
      fail(res, 400, 'INVALID_REQUEST', error.message);
    }
  });
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.HANGAR_PORT ?? process.argv[2] ?? 8790);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('HANGAR_PORT must be 1024..65535');
  createHangarServer({ port }).listen(port, '127.0.0.1', () =>
    console.log(`Unified local hangar: http://127.0.0.1:${port}/?control=local`),
  );
}
