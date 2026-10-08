# Unified aircraft control

`window.hangarAPI.request(request)` is the versioned asynchronous control entry point for the selected aircraft. Existing `hangarAPI.list()`, `state()`, `select()`, `window.ev50API`, EV50 command/result events and `transwing.sim.v1` remain separate compatibility interfaces. New unified commands do not reinterpret legacy payloads or change the EV50 HTTP result outbox or Transwing Python/replay clock.

This is a visualization interface, not a vehicle flight controller. Remote HTTP, WebSocket, authentication, and public Internet exposure are not implemented. The local companion service is restricted to an explicitly configured same-origin loopback deployment. Lease tokens coordinate browser clients; they are not authentication credentials or a security boundary against scripts already running in the page.

## One configuration source

The gateway owns one validated configuration, read with `config.get` and changed atomically with `config.update`. Every write requires an id, owner, selected aircraft, selection generation and current command epoch (the initial epoch 0 may be omitted). Configuration can be changed only while no lease is held. Unknown properties and invalid combinations are rejected without partial mutation.

| Setting                | Supported values / semantics                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `transport`            | `browser` by default; `local-http` for the explicitly enabled local companion bridge                     |
| `baseURL`              | `null` by default; absolute same-origin loopback HTTP(S) URL; credentials, query and fragment prohibited |
| `localService.enabled` | `false` by default; must be explicitly `true` together with a valid `baseURL` for `local-http`           |
| `controlMode`          | `local` or `external`; initial value `local`                                                             |
| `clock`                | `host` with local mode; `external` with external mode                                                    |
| `units`                | Fixed scene coordinates documented below; unsupported unit conversions are rejected                      |
| `leaseTtlMs`           | Default 30,000 ms; inclusive range 1,000–120,000 ms                                                      |

Loopback hostnames are `127.0.0.1`, `localhost`, and `[::1]`. Same-origin includes the scheme, hostname and port: these names are not interchangeable across origins. A hosted page cannot use this configuration to probe localhost or connect to an unrelated remote service. Switching to browser-only transport does not create a remote connection. No secrets or credentials belong in the configuration.

## Identity and lease lifecycle

1. Read `aircraft.state` to obtain the selected `aircraft`, `generation` and `commandEpoch`. Send the latter as top-level `epoch` on requests.
2. Acquire with `control.acquire`, a unique command `id`, `owner`, aircraft and generation. Optional payload keys are `ttlMs`, `controlMode` and `clock`. Omitted mode/clock use the current configuration. To change from local to external, provide both `controlMode: 'external'` and `clock: 'external'`. A successful acquisition stores the validated mode/clock in the same configuration and returns a lease. Both aircraft start a new unified external clock at 0 seconds, paused, while retaining the initial pose.
3. Include the returned `leaseId`, the same owner, aircraft and generation on every control command or lease renewal/release.
4. Renew explicitly with `control.renew` before expiration. Renewal retains the lease id and owner. Repeating an acquisition id returns its original result; it does not renew a lease.
5. `control.release`, `control.disconnect`, bridge disconnection, page teardown or expiry release control and cancel queued/unacknowledged commands. Releasing returns the adapter to its documented local state. Each adapter owns its safe local restoration, rather than sharing actuator data across aircraft.
6. Aircraft selection invalidates the lease immediately, including a same-aircraft reload with a new generation. In-flight rendering acknowledgements are canceled; they cannot authorize a new instance. Read the new generation and acquire a new lease.

Only one lease can be held. A competing owner, stale lease, wrong aircraft or generation is rejected. Existing Python ownership and replay sessions can block acquisition; the unified gateway does not silently interrupt them. The host checks busy state at acquisition and again before applying commands. Local presentation UI and legacy mutating entry points must honor unified ownership for the entire lease.

The lease's `expiresAt` is in epoch milliseconds. A real timer releases expired ownership even if animation frames are not running. It is also checked on each request and render phase. An adapter release error is returned as `HOST_ERROR` for an explicit release and retained in `control.state.lifecycleError`; pending commands and the expiry timer are still cleared.

## Coordinates and typed state

`aircraft.state` returns a detached, frozen snapshot:

- `protocol: 'hangar.control.v1'`
- `aircraft`, selection `generation`, `commandEpoch`, `ready`
- `coordinates`: right-handed Three.js scene coordinates, +Y up, positions in meters, velocity in meters/second, quaternion order `[x, y, z, w]`, clock values in seconds
- `body`: each adapter's native forward/up axes and actual asset/rig origin. This is not asserted to be a center of mass. The contract does not rotate or reinterpret native geometry to force a shared forward axis
- Current `lease`, or `null`
- `state`: pose, clock authority and seconds, control mode, transport timeline, and an aircraft-discriminated model state; `null` while not ready

Transport time is not always seconds. `transport.unit` is `seconds`, `frames` (zero-based integer index) or `percent` (0–100 mechanism progress). Seek requests must provide that same unit. Quaternion inputs must be unit length within 0.001. Position and velocity components must be finite and within ±100,000.

The model union keeps EV50's 11 rotors distinct from Transwing's four motor ids. Capabilities are authoritative: inspect `system.capabilities` for the operations the current adapter actually implements. EV50 group control does not imply individual rotor control. A missing model-specific field is not invented telemetry.

## Operations and mode matrix

Read-only operations require no lease:

- `system.capabilities`
- `aircraft.state`
- `config.get`
- `control.state`

Management operations are `config.update`, `control.acquire`, `control.renew`, `control.release`, `control.disconnect`, and `control.resetSession`. All require command identity and current selection. Only renew, release and disconnect require an existing matching lease; reset requires the gateway to be idle with no lease. Reads may optionally specify aircraft/generation, in which case a mismatch is rejected.

| Command                             | Payload                                                                           | Local / host clock              | External clock                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `aircraft.pose`                     | Any nonempty combination of `positionM`, `attitude`, `velocityMps`, `timeSeconds` | Rejected                        | Supported when advertised; adapter may reject unsupported pose fields                |
| `clock.step`                        | `{ dt }`, 0–60 seconds                                                            | Rejected                        | Supported when advertised, after `transport.play`; paused clocks reject stepping     |
| `transport.play`, `transport.pause` | `{}`                                                                              | Demo transport                  | Pause/resume external state only; wall time does not advance the authoritative clock |
| `transport.reset`                   | `{}`                                                                              | Supported when advertised       | Rejected; acquire a new lease to establish a new external timeline                   |
| `transport.seek`                    | `{ position, unit }`                                                              | Active timeline's explicit unit | Rejected                                                                             |
| `transport.speed`                   | `{ speed }`, 0.1–4                                                                | Supported when advertised       | Rejected                                                                             |
| `transport.loop`                    | `{ loop }` boolean                                                                | Supported when advertised       | Rejected                                                                             |
| Model-specific commands below       | Strict namespaced payload                                                         | When advertised                 | When advertised                                                                      |

External pose/time and step commands require an external lease so a demonstration trajectory cannot overwrite them. External timestamps cannot regress within one lease; queued timestamps are revalidated after earlier commands apply. No implicit wall-clock advance or fixed-rate step is synthesized by the gateway. Adapter-specific pose/interlock constraints can reject a command atomically.

Model-specific operations:

- `ev50.motors`: `{ lift, cruise }`, normalized group controls 0–1. This is 8+3 group actuation, not 11 independent motor commands.
- `transwing.mechanism`: nonempty `{ wingTilt?, hatchDeg?, surfaces? }`; wing tilt 0–1, hatch 0–55 degrees.
- `transwing.motors`: `{ motors: { [motorId]: { targetRpm?, enabled? } } }`. Allowed ids: `L_Front`, `R_Front`, `L_Rear`, `R_Rear`; rpm 0–12,000; enabled boolean. At least one motor and one field per motor are required.
- `transwing.surfaces`: `{ surfaces: { [surfaceId]: degrees } }`, when advertised. The same canonical surface mapping can occur within `transwing.mechanism`.
- Canonical surface ids: `L_Inboard`, `R_Inboard`, `L_Outboard`, `R_Outboard`, `Tail_L`, `Tail_R`; deflections −12 to +12 degrees. Unknown aliases or fields are rejected.

Namespaced commands require both the matching selected aircraft and its advertised capability. An EV50 rotor array can never become Transwing commands.

## Applied ACK and duplicate ids

`request()` always returns a Promise. Reads and successful configuration/lease changes return `ack.status: 'completed'`. Aircraft mutations are queued and return `ack.status: 'applied'` only after the host renders the applied state, with the monotonic host `frame` and an immutable state snapshot.

One aircraft mutation is applied per host frame. Calling `beforeFrame()` twice does not consume another command until `afterRender(frame)` finishes the first. An applied ACK is not emitted merely because an adapter accepted a command, before the next render, on a repeated frame number, or after selection/ownership was invalidated. Background tabs may delay rendering ACKs; the lease can expire while waiting. A render failure cannot produce a successful applied ACK.

Use a unique id (nonempty, maximum 128 characters) for every logical mutation. Within the current command epoch, an identical retry returns the original Promise/result without another execution. That result survives aircraft changes, lease expiry and later state changes. Reusing an id for different content returns `ID_CONFLICT`. Failed commands are also remembered; correcting a failed command requires a new id. Key ordering does not affect identity. Within an epoch, command ids are shared across owners and aircraft. A different epoch is an explicit new command-id namespace.

The bounded gateway retains 10,000 command outcomes per epoch and never silently evicts them. It rejects additional ordinary new ids with `CAPACITY_EXCEEDED`. Read `control.state` for `commandEpoch`, `capacity`, `retained`, `remaining`, and `canResetSession`. At capacity, a validated matching-owner release or disconnect still works, using at most one extra outcome slot; invalid attempts cannot grow the ledger. Timed expiry, selection invalidation and read-only operations remain available. Up to 256 unacknowledged aircraft commands may queue.

For long streams, end a batch, consume/persist its outcomes, release its lease, then explicitly send:

```js
const reset = await window.hangarAPI.request({
  id: crypto.randomUUID(),
  operation: 'control.resetSession',
  aircraft: current.aircraft,
  generation: current.generation,
  epoch: current.commandEpoch,
  owner: 'example-client',
  payload: { acknowledgeCompletedResults: true },
});
// If successful, use reset.data.commandEpoch for all subsequent writes.
```

Reset is accepted only with that exact acknowledgement flag and no lease, queued command or unrendered application. It atomically clears retained outcomes and increments `commandEpoch`, without changing aircraft selection/configuration. It never silently rotates an active stream. A delayed command from an older epoch, including one whose id was previously executed, returns `STALE_SESSION` and cannot run again. Omitting `epoch` always means 0; it does not automatically select the latest epoch. Read-only discovery without an epoch still works after rotation.

Exactly one latest successful reset receipt is retained outside the cleared ledger and exposed as `control.state.lastReset: { request, response }`. If a reset ACK is lost, retrying its exact original request returns that immutable receipt without advancing the epoch twice. Another successful reset replaces this one receipt; still older reset retries are rejected as `STALE_SESSION`. `control.state` can always recover the current epoch. This explicit consumed-results acknowledgement is the boundary after which older ordinary outcomes are intentionally no longer retrievable.

The local service has its own 2,000-command per-epoch mailbox bound, so long HTTP streams should finish/consume/release/reset batches before that smaller limit. Two additional HTTP lifecycle slots admit strictly shaped, currently matching release/disconnect requests and eligible resets at normal mailbox capacity. This HTTP reserve is distinct from the gateway's synchronously validated safety exit: a race with direct browser ownership can cause an admitted management request to fail and retain its immutable failure. If both slots are consumed, a further eligible management request returns `LIFECYCLE_CAPACITY`; it is not silently dropped or executed. Recovery is available directly in the page: press “断开 / 释放” to release gateway authority without consuming a command slot, preserve the outcomes you need, tick “已保存全部结果，允许清理旧会话”, then press “轮换命令会话”. This publishes a successful reset receipt and restores mailbox capacity without reloading or waiting for lease expiry. If the configuration write was itself blocked by gateway capacity, press disconnect again after rotation to stop the service transport. The registered viewer publishes completed reset receipts so browser-originated and HTTP-originated resets converge on the same epoch; the server never rotates merely because a reset was queued. HTTP result lookups include `?epoch=N`; retired epochs report `STALE_SESSION`, except the latest retained reset receipt. A retired outbox delivery may be acknowledged as discarded after explicit reset, without reexecuting the command or inventing a replacement applied result.

Payloads are JSON-compatible, at most 64 KiB and 30 nested levels; nonfinite numbers, undefined values and exotic objects are rejected.

Errors have `{ protocol, id?, operation, ok: false, error: { code, message } }`. Important codes include `NOT_READY`, `AIRCRAFT_MISMATCH`, `STALE_SELECTION`, `STALE_SESSION`, `CONTROL_BUSY`, `LEASE_REQUIRED`, `LEASE_EXPIRED`, `OWNER_MISMATCH`, `LEASE_MISMATCH`, `MODE_MISMATCH`, `CLOCK_REGRESSION`, `VALIDATION_FAILED`, `OPERATION_UNSUPPORTED`, `ID_CONFLICT`, `CAPACITY_EXCEEDED`, `HOST_ERROR`, and `DISCONNECTED`.

## Browser example

Run in the page's browser console after the selected model is ready:

```js
const api = window.hangarAPI;
const current = await api.request({ operation: 'aircraft.state' });
if (!current.ok || !current.data.ready) throw new Error('Aircraft is not ready');
const target = {
  aircraft: current.data.aircraft,
  generation: current.data.generation,
  epoch: current.data.commandEpoch,
  owner: 'example-client',
};
const acquired = await api.request({
  ...target,
  id: crypto.randomUUID(),
  operation: 'control.acquire',
  payload: { controlMode: 'external', clock: 'external', ttlMs: 30000 },
});
if (!acquired.ok) throw new Error(acquired.error.message);
const leaseId = acquired.data.leaseId;
const pose = await api.request({
  ...target,
  leaseId,
  id: crypto.randomUUID(),
  operation: 'aircraft.pose',
  payload: { positionM: [0, 12, 0], attitude: [0, 0, 0, 1], timeSeconds: 0 },
});
console.log(pose); // applied only after the host render
await api.request({
  ...target,
  leaseId,
  id: crypto.randomUUID(),
  operation: 'control.release',
});
```

Do not copy a stale selection generation or lease into a later aircraft instance. If an operation returns an error, inspect it and issue a new id only after resolving the cause; retrying the same id retrieves the original outcome.

## Single-origin local service

From `threejs/`:

```sh
npm run build
npm run control:hangar
```

Open the exact printed URL, by default `http://127.0.0.1:8790/?control=local`. The page and API share this one origin. `HANGAR_PORT` or a positional port changes that single port; the process binds only `127.0.0.1`. The service serves the built `dist/`, so rebuild after editing source. The `control=local` opt-in enables the validated local configuration; a normally hosted page stays browser-only.

The development service exposes:

- `GET /api/hangar/v1/health`: local service/viewer readiness
- `GET /api/hangar/v1/state`: most recent viewer state and capabilities
- `POST /api/hangar/v1/commands`: enqueue a unified request with a unique id
- `GET /api/hangar/v1/results/{id}`: queued, completed, applied or rejected result

The page bridge owns the viewer registration, polling, state publication and result delivery routes. A submitted HTTP command is merely queued; HTTP 202 is not an applied ACK. Poll the command's result and inspect its actual gateway response. A live viewer must be open and explicitly connected. Host/Origin checks reject cross-origin browser requests and non-loopback hostnames; this is a local development service, not a publicly authenticated server.

Example Python client using only the standard library, with the local page already open:

```python
import json
import time
import uuid
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8790/api/hangar/v1"

def http(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = Request(BASE + path, data=data,
                      headers={} if data is None else {"Content-Type": "application/json"})
    with urlopen(request, timeout=5) as response:
        return json.load(response)

snapshot = http("/state")["data"]
if not snapshot or not snapshot["state"]["ready"]:
    raise RuntimeError("Open the local page and wait for its aircraft to load")
state = snapshot["state"]
target = {"aircraft": state["aircraft"], "generation": state["generation"],
          "epoch": state["commandEpoch"], "owner": "python-example"}

def command(operation, payload=None, lease=None):
    request = {**target, "id": str(uuid.uuid4()), "operation": operation}
    if payload is not None:
        request["payload"] = payload
    if lease is not None:
        request["leaseId"] = lease
    http("/commands", request)
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        result = http("/results/" + request["id"] + "?epoch=" + str(request["epoch"]))["data"]
        if result["response"] is not None:
            response = result["response"]
            if not response["ok"]:
                raise RuntimeError(response["error"])
            return response["data"]
        time.sleep(0.1)
    raise TimeoutError("No applied/completed ACK; inspect page and lease before retrying")

lease = command("control.acquire", {"controlMode": "external", "clock": "external"})["leaseId"]
try:
    command("aircraft.pose", {"positionM": [0, 12, 0], "attitude": [0, 0, 0, 1],
                              "timeSeconds": 0}, lease)
    command("transport.play", {}, lease)
    result = command("clock.step", {"dt": 0.1}, lease)
    print(result["aircraft"], result["state"]["clock"])
finally:
    command("control.release", {}, lease)
```

A client retry must reuse the original request/id if its delivery outcome is unknown. Do not invent a new id merely because the HTTP response was lost. A new page or aircraft selection requires fresh selection state and a new lease. For a subsequent batch, after consuming results and releasing ownership, use `control.resetSession` with `acknowledgeCompletedResults: true` and update `target["epoch"]` from its result before acquiring again. The existing EV50 and Transwing local services remain compatibility options; they are not aliases for these new unified paths.

## Host adapter integration

Contracts live in `threejs/src/control/contracts.ts`; the gateway has no renderer or network dependency. The host provides:

- `getContext()`: selected aircraft, generation, readiness, optional legacy ownership blocker
- `getCapabilities()`: actual operations, native body axes/origin, rotor count
- `getState()`: typed adapter state
- `apply(command)`: synchronous, atomic application; validate model-specific cross-field constraints before mutation
- `leaseChanged(lease, reason)`: acquire/release the adapter's ownership. Acquisition may throw before mutating if legacy Python/replay already owns it

The single animation loop calls `gateway.beforeFrame()` before aircraft update and `gateway.afterRender(frameNumber)` after the actual successful renderer/composer pass. Selection transitions call `invalidateSelection()` before a replacement instance can accept commands. Connection teardown calls `disconnect()`, permanent disposal calls `dispose()`. Host controls and compatibility entry points must respect the lease. The gateway intentionally does not alter legacy Python revision/ACK bookkeeping or the EV50 bridge's original-result retry outbox.

## Verification

Run `node test-control-contract.mjs` from `threejs/`. Tests cover immutable snapshots/results, readiness and selection targeting, competing owners, id conflicts/deduplication including original failures, one-application-per-render timing, no pre-render ACK, release/disconnect/expiry, a real timer with no RAF, renewal, stale selection, external clock regression, explicit timeline units, model namespace/schema isolation, strict and atomic config, same-origin loopback restriction, adapter failures, bounded queues/history, actual 10,000-entry saturation and safe release, explicit epoch rotation, stale-command rejection, and lost reset-ACK retry with one bounded receipt. Direct EV50 checks verify deterministic position/time/rotor phases, paused stepping, 8+3 group separation, release/reacquisition, and atomic position-overflow rejection. These are contract tests; browser/WebGL and local-server integration require their separate suites.
