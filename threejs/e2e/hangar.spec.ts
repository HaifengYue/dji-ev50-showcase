import { test, expect, type Page } from '@playwright/test';
import { MOTOR_LIMITS } from '../src/aircraft/skytrans/core/motors';
import { DEMO_DURATION, DEMO_TIMES } from '../src/aircraft/skytrans/demoProfile';

const diagnostics = (page: Page) => page.evaluate(() => (window as any).hangarDiagnostics);
async function ready(page: Page, aircraft: 'ev50' | 'skytrans') {
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state?.ready ? state.current : null;
    })
    .toBe(aircraft);
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#scene')).toBeVisible();
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return (
        state.renderedAircraft === aircraft &&
        state.renderedSelectionRevision === state.selectionRevision
      );
    })
    .toBe(true);
  const firstFrame = (await diagnostics(page)).frameNumber;
  await expect
    .poll(async () => (await diagnostics(page)).frameNumber)
    .toBeGreaterThanOrEqual(firstFrame + 2);
  await expect.poll(async () => (await diagnostics(page)).geometries).toBeGreaterThan(10);
  await expect.poll(async () => (await diagnostics(page)).drawCalls).toBeGreaterThan(0);
}
async function select(page: Page, aircraft: 'ev50' | 'skytrans') {
  await page.locator('#aircraft-select').selectOption(aircraft);
  await ready(page, aircraft);
}
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS/.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}

test('Running SkyTrans rotor exposure stays thin across angles, slow playback and pause', async ({
  page,
}, info) => {
  // d50301d trace: three screenshots + transitions take 162s; isolate them from
  // the shared-stage matrix rather than consuming its whole-test timeout.
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.locator('#flight').click();
  await expect(page.locator('#timeline')).toHaveAttribute('max', String(DEMO_DURATION));
  const seekFrame = await page.locator('#timeline').evaluate((element) => {
    (element as HTMLInputElement).value = '132';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return (window as any).hangarDiagnostics.frameNumber;
  });
  await expect.poll(async () => (await diagnostics(page)).frameNumber).toBeGreaterThan(seekFrame);
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(132);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  const state = await page.evaluate(() => (window as any).hangarAPI.controlState());
  const invoke = (request: any) =>
    page.evaluate((request) => (window as any).hangarAPI.request(request), request);
  const owner: any = {
    aircraft: 'skytrans',
    generation: state.generation,
    epoch: state.commandEpoch,
    owner: 'rotor-angle-acceptance',
  };
  const lease = await invoke({
    ...owner,
    id: 'rotor-angles-acquire',
    operation: 'control.acquire',
    payload: { controlMode: 'local', clock: 'host', ttlMs: 120000 },
  });
  expect(lease.ok).toBe(true);
  owner.leaseId = lease.data.leaseId;
  for (const view of ['front', 'side']) {
    expect(
      (
        await invoke({
          ...owner,
          id: `rotor-renew-${view}`,
          operation: 'control.renew',
          payload: { ttlMs: 120000 },
        })
      ).ok,
    ).toBe(true);
    await page.locator('#camera').selectOption(view);
    await expect
      .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
      .toBe(false);
    const d = await diagnostics(page);
    expect(d.aircraft.experience.playing).toBe(true);
    expect(d.aircraft.runtime.state.wingTilt).toBeCloseTo(1, 5);
    expect(d.aircraft.runtime.actuators.L_Front.rpm).toBe(1800);
    expect(d.aircraft.runtime.actuators.L_Rear.rpm).toBe(0);
    expect(d.aircraft.runtime.actuators.L_Rear.fold).toBe(1);
    expect(d.aircraft.rotorExposureLayers.activeIds).toEqual(['L_Front', 'R_Front']);
    await page.screenshot({ path: info.outputPath(`skytrans-cruise-running-${view}.png`) });
  }
  expect(
    (
      await invoke({
        ...owner,
        id: 'rotor-slow',
        operation: 'transport.speed',
        payload: { speed: 0.1 },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await invoke({
        ...owner,
        id: 'rotor-renew-slow',
        operation: 'control.renew',
        payload: { ttlMs: 120000 },
      })
    ).ok,
  ).toBe(true);
  await page.locator('#camera').selectOption('follow');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.rotorExposureLayers.activeIds)
    .toEqual([]);
  expect((await diagnostics(page)).aircraft.experience.playing).toBe(true);
  await page.screenshot({ path: info.outputPath('skytrans-cruise-0.1x-solid-blades.png') });
  expect(
    (
      await invoke({
        ...owner,
        id: 'rotor-normal',
        operation: 'transport.speed',
        payload: { speed: 1 },
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.rotorExposureLayers.activeIds)
    .toEqual(['L_Front', 'R_Front']);
  expect(
    (await invoke({ ...owner, id: 'rotor-paused', operation: 'transport.pause', payload: {} })).ok,
  ).toBe(true);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.rotorExposureLayers.activeIds)
    .toEqual([]);
  expect(
    (await invoke({ ...owner, id: 'rotor-resumed', operation: 'transport.play', payload: {} })).ok,
  ).toBe(true);
  expect(
    (
      await invoke({
        ...owner,
        id: 'rotor-angles-release',
        operation: 'control.release',
        payload: {},
      })
    ).ok,
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).hangarAPI.controlState().lease)).toBeNull();
  await expect(page.locator('#flight')).toBeEnabled();
  await expect(page.locator('#product')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Local continuous SkyTrans flight shows lakes, villages and an aging white trail', async ({
  page,
}, info) => {
  // The original wide capture took 132s in SwiftShader. Add up to 90s of
  // continuous warm-up and one <=60s screenshot for the requested longer trail.
  // Individual readiness/behavior waits remain 30s; this is not an FPS target.
  test.setTimeout(300_000);
  // Keep the full High scene and 1.44 aspect ratio while bounding SwiftShader
  // raster/readback work; both continuous-flight captures use the same viewport.
  await page.setViewportSize({ width: 1152, height: 800 });
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.locator('#route').selectOption('valley');
  await page.locator('#flight').click();
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.experience.playing).toBe(false);
  await expect(page.locator('#timeline')).toHaveAttribute('max', String(DEMO_DURATION));
  const seekFrame = await page.locator('#timeline').evaluate((element) => {
    (element as HTMLInputElement).value = '170';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return (window as any).hangarDiagnostics.frameNumber;
  });
  await expect.poll(async () => (await diagnostics(page)).frameNumber).toBeGreaterThan(seekFrame);
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeCloseTo(170, 5);
  const beforeView = await diagnostics(page);
  expect(beforeView.trail.lastTime).toBeCloseTo(beforeView.world.time, 6);
  expect(beforeView.trail.generation).toMatch(
    new RegExp(`:demo:${beforeView.world.presentationRevision}$`),
  );
  await page.locator('#camera').selectOption('wide');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  const afterView = await diagnostics(page);
  expect(afterView.trail.generation).toBe(beforeView.trail.generation);
  expect(afterView.trail.resetCount).toBe(beforeView.trail.resetCount);
  expect(afterView.world.time).toBeCloseTo(170, 5);
  expect(afterView.world.source).toBe('demo');
  await page.locator('#quality').selectOption('High');
  await page.getByText('光线与导出', { exact: true }).click();
  // Accumulate real, continuous simulation-time samples through normal UI playback.
  // Warm up at 4x, then capture playing at 1x; no synthetic poses or lease takeover.
  await page.locator('#playback-speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(173.1);
  await page.locator('#playback-speed').selectOption('1');
  const firstNormalFrame = (await diagnostics(page)).frameNumber;
  await expect
    .poll(async () => (await diagnostics(page)).frameNumber)
    .toBeGreaterThan(firstNormalFrame);
  await expect.poll(async () => (await diagnostics(page)).trail.pointCount).toBeGreaterThan(8);
  const capture = await diagnostics(page);
  expect(capture.aircraft.experience.playing).toBe(true);
  expect(capture.world.source).toBe('demo');
  expect(capture.aircraft.camera.view).toBe('wide');
  expect(capture.trail.generation).toBe(afterView.trail.generation);
  expect(capture.trail.resetCount).toBe(afterView.trail.resetCount);
  expect(capture.trail.drawCalls).toBe(1);
  expect(capture.landscape.quality).toBe('High');
  await expect(page.locator('#quality-readout')).toHaveText('HIGH');
  expect(capture.landscape.settlements).toBe(8);
  expect(capture.landscape.lakes).toBe(2);
  expect(await page.evaluate(() => (window as any).hangarAPI.controlState().lease)).toBeNull();
  await page.locator('#immersive').click();
  await expect(page.locator('body')).toHaveClass(/immersive/);
  await page.screenshot({
    path: info.outputPath('skytrans-valley-lake-village-white-trail-1x.png'),
  });
  const afterCapture = await diagnostics(page);
  expect(afterCapture.aircraft.experience.playing).toBe(true);
  expect(afterCapture.world.source).toBe('demo');
  expect(afterCapture.trail.generation).toBe(capture.trail.generation);
  await page.locator('#exit-immersive').click();
  await expect(page.locator('#flight')).toBeVisible();
  // Keep the same real flight and existing trail; do not seek or synthesize old
  // samples. Each short checkpoint retains the original 30s behavior deadline.
  await page.locator('#playback-speed').selectOption('4');
  for (const checkpoint of [176, 179, 181.1])
    await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(checkpoint);
  await page.locator('#playback-speed').selectOption('1');
  const beforeNormalFrame = (await diagnostics(page)).frameNumber;
  await expect
    .poll(async () => (await diagnostics(page)).frameNumber)
    .toBeGreaterThan(beforeNormalFrame);
  const longCapture = await diagnostics(page);
  expect(longCapture.world.time - beforeView.world.time).toBeGreaterThan(11);
  expect(longCapture.world.source).toBe('demo');
  expect(longCapture.aircraft.experience.playing).toBe(true);
  expect(longCapture.aircraft.camera.view).toBe('wide');
  expect(longCapture.trail.generation).toBe(capture.trail.generation);
  expect(longCapture.trail.resetCount).toBe(capture.trail.resetCount);
  expect(longCapture.trail.historySeconds).toBeGreaterThan(8);
  expect(longCapture.trail.drawCalls).toBe(1);
  expect(longCapture.landscape.quality).toBe('High');
  expect(await page.evaluate(() => (window as any).hangarAPI.controlState().lease)).toBeNull();
  await expect(page.locator('#playback-speed')).toHaveValue('1');
  await page.locator('#immersive').click();
  await expect(page.locator('body')).toHaveClass(/immersive/);
  await page.screenshot({
    path: info.outputPath('skytrans-long-continuous-white-trail-1x.png'),
    timeout: 60_000,
  });
  const afterLongCapture = await diagnostics(page);
  expect(afterLongCapture.aircraft.experience.playing).toBe(true);
  expect(afterLongCapture.trail.generation).toBe(longCapture.trail.generation);
  expect(afterLongCapture.trail.resetCount).toBe(longCapture.trail.resetCount);
  await page.locator('#exit-immersive').click();
  await expect(page.locator('#flight')).toBeVisible();
  await info.attach('skytrans-landscape-continuous-flight.json', {
    body: JSON.stringify({
      beforeView,
      afterView,
      capture,
      afterCapture,
      longCapture,
      afterLongCapture,
      warmupRate: 4,
      captureRate: 1,
    }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('SkyTrans demo vertical rates and rotor phase survive seek, pause, playback rate and shutdown', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.locator('#flight').click();
  await page.locator('#play').click();
  const seek = async (time: number) => {
    await page.locator('#timeline').evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await expect.poll(async () => (await diagnostics(page)).world.time).toBeCloseTo(time, 5);
  };
  await seek(30);
  await expect(page.locator('#vertical-speed')).toHaveText('3.0');
  await expect(page.locator('#speed')).toHaveText('3.0');
  const paused = await diagnostics(page);
  expect(paused.aircraft.runtime.actuators.L_Front.rpm).toBe(1800);
  expect(paused.aircraft.runtime.actuators.L_Front.fold).toBe(0);
  await page.waitForTimeout(250);
  expect((await diagnostics(page)).aircraft.runtime.actuators).toEqual(
    paused.aircraft.runtime.actuators,
  );
  const rates = ['0.1', '0.25', '0.5', '1', '1.5', '2', '4'];
  expect(
    await page
      .locator('#playback-speed option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
  ).toEqual(rates);
  for (const rate of rates) {
    await page.locator('#playback-speed').selectOption(rate);
    await expect(page.locator('#playback-speed')).toHaveValue(rate);
  }
  await page.locator('#playback-speed').selectOption('0.1');
  await page.locator('#play').click();
  const first = await diagnostics(page);
  await expect
    .poll(async () => (await diagnostics(page)).world.time)
    .toBeGreaterThan(first.world.time + 0.02);
  const second = await diagnostics(page);
  const dt = second.world.time - first.world.time;
  expect((second.world.position.y - first.world.position.y) / dt).toBeCloseTo(3, 5);
  const phaseDelta =
    (second.aircraft.runtime.actuators.L_Front.phase -
      first.aircraft.runtime.actuators.L_Front.phase +
      2 * Math.PI) %
    (2 * Math.PI);
  expect(phaseDelta).toBeCloseTo((((dt * 1800) / 60) * 2 * Math.PI) % (2 * Math.PI), 4);
  expect(second.aircraft.rotorExposureIds).toEqual([]);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  await expect
    .poll(async () => {
      const d = await diagnostics(page);
      return Math.abs(d.aircraft.camera.target[1] - d.world.position.y);
    })
    .toBeLessThan(5);
  await page.screenshot({ path: info.outputPath('skytrans-bounded-climb-running.png') });
  await page.locator('#playback-speed').selectOption('4');
  await expect.poll(async () => (await diagnostics(page)).aircraft.rotorExposureIds.length).toBe(4);
  await page.locator('#play').click();
  const stopped = (await diagnostics(page)).aircraft.runtime.actuators;
  await page.waitForTimeout(200);
  expect((await diagnostics(page)).aircraft.runtime.actuators).toEqual(stopped);
  await seek(DEMO_TIMES.cruise + 10);
  let sample = await diagnostics(page);
  expect(sample.aircraft.runtime.actuators.L_Rear.fold).toBe(1);
  expect(sample.aircraft.runtime.actuators.L_Rear.rpm).toBe(0);
  expect(sample.aircraft.runtime.actuators.L_Front.rpm).toBe(1800);
  await seek(DEMO_TIMES.return);
  expect((await diagnostics(page)).aircraft.runtime.actuators.L_Rear.rpm).toBe(1600);
  await seek(DEMO_TIMES.landing + 20);
  await expect(page.locator('#vertical-speed')).toHaveText('-2.0');
  await expect(page.locator('#speed')).toHaveText('2.0');
  await page.locator('#loop').uncheck();
  await seek(DEMO_DURATION - 0.2);
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.experience.playing).toBe(false);
  sample = await diagnostics(page);
  expect(sample.world.time).toBe(DEMO_DURATION);
  expect(sample.aircraft.rotorExposureLayers.activeIds).toEqual([]);
  expect(sample.aircraft.rotorExposureLayers.visibleTriangles).toBe(0);
  await page.screenshot({ path: info.outputPath('skytrans-parked-no-disc.png') });
  for (const motor of Object.values(sample.aircraft.runtime.actuators) as any[]) {
    expect(motor.rpm).toBe(0);
    expect(motor.fold).toBe(1);
    expect(motor.stage).toBe('folded');
  }
  await seek(30);
  await page.locator('#product').click();
  expect((await diagnostics(page)).aircraft.runtime.actuators.L_Front.fold).toBe(1);
  await info.attach('skytrans-rates.json', {
    body: JSON.stringify({ paused, first, second, shutdown: sample }, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('EV50 starts alone on nested base, preserves flight controls and capture', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // Cold load plus screenshot and exported-image readbacks on software GPU.
  const errors = watchErrors(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  expect(requests.some((url) => url.includes('/skytrans/models/'))).toBe(false);
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  await page.locator('#flight').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).ev50Diagnostics.time))
    .toBeGreaterThan(0);
  const evTime = await page.evaluate(() => (window as any).ev50Diagnostics.time);
  await page.locator('#flight').click();
  expect(await page.evaluate(() => (window as any).ev50Diagnostics.time)).toBeGreaterThanOrEqual(
    evTime,
  );
  await page.locator('#product').click();
  await page.locator('#quality').selectOption('Low');
  await expect(page.locator('#quality-readout')).toHaveText('LOW');
  await page.screenshot({ path: info.outputPath('ev50-shared-shell.png') });
  const download = page.waitForEvent('download');
  await page.getByText('光线与导出', { exact: true }).click();
  await page.locator('#save-image').click();
  expect((await download).suggestedFilename()).toMatch(/^EV50_.*\.png$/);
  expect(errors).toEqual([]);
});

test('SkyTrans integrates shared canvas, real rig, native cameras and EV50 API isolation', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // Multiple native camera views plus a fully rendered EV50 return.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  // This case checks mechanisms, camera ownership and API isolation. Keep GPU
  // postprocessing out of its timing; the shared-terrain case explicitly verifies High.
  await page.locator('#quality').selectOption('Low');
  await expect(page.locator('#quality-readout')).toHaveText('LOW');
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  await expect(page.locator('#aircraft-panel')).toBeVisible();
  await expect(page.locator('#simulation-tools')).toBeHidden();
  // The product tilt demo caps each rendered update at 0.1 s. Use its normal
  // 2x UI rate for this response/ownership test, not a wall-clock FPS assertion.
  await page.locator('#playback-speed').selectOption('2');
  const before = (await diagnostics(page)).aircraft;
  expect(before.experience.tilt.rate).toBe(2);
  expect(before.experience.cameraView).toBe('perspective');
  expect(before.camera.type).toBe('PerspectiveCamera');
  await page.locator('#play').click();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.state.wingTilt)
    .toBeGreaterThan(0.05);
  await page.locator('#play').click();
  await page.locator('#playback-speed').selectOption('1');
  const paused = await diagnostics(page);
  const after = paused.aircraft;
  expect(after.experience.tilt.playing).toBe(false);
  expect(after.experience.tilt.rate).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page)).frameNumber)
    .toBeGreaterThan(paused.frameNumber);
  expect((await diagnostics(page)).aircraft.runtime.state.wingTilt).toBe(
    after.runtime.state.wingTilt,
  );
  expect(after.camera.position).toEqual(before.camera.position);
  expect(after.camera.target).toEqual(before.camera.target);
  await page.locator('#camera').selectOption('top');
  await expect.poll(async () => (await diagnostics(page)).camera).toBe('OrthographicCamera');
  await page.locator('#camera').selectOption('joint-L');
  await expect.poll(async () => (await diagnostics(page)).aircraft.experience.jointSide).toBe('L');
  const response = await page.evaluate(() =>
    (window as any).ev50API.request({
      operation: 'flight.command',
      payload: { type: 'motor', lift: 1, cruise: 1 },
    }),
  );
  expect(response.ok).toBe(false);
  expect(response.error.code).toBe('NOT_READY');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  await page.screenshot({ path: info.outputPath('skytrans-left-joint.png') });
  await select(page, 'ev50');
  await expect.poll(() => page.evaluate(() => (window as any).ev50API.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test('Repeated switches release model resources, reset state and preserve one renderer', async ({
  page,
}, info) => {
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  test.setTimeout(240_000); // Four cold GPU-resource rebuilds on software-rendered CI.
  const samples: { id: string; geometries: number; textures: number; sceneChildren: number }[] = [];
  for (let index = 0; index < 4; index++) {
    for (const id of ['skytrans', 'ev50'] as const) {
      await select(page, id);
      await page.waitForTimeout(250);
      const value = await diagnostics(page);
      samples.push({
        id,
        geometries: value.geometries,
        textures: value.textures,
        sceneChildren: value.sceneChildren,
      });
      console.log('RESOURCE_SAMPLE', JSON.stringify(samples.at(-1)));
      if (id === 'skytrans') {
        expect(value.aircraft.runtime.state.wingTilt).toBe(0);
        expect(value.aircraft.experience.tilt.playing).toBe(false);
        await page.locator('#play').click();
        await expect
          .poll(async () => (await diagnostics(page)).aircraft.runtime.state.wingTilt)
          .toBeGreaterThan(0);
      }
    }
  }
  for (const id of ['ev50', 'skytrans']) {
    const rows = samples.filter((row) => row.id === id);
    expect(
      Math.max(...rows.map((row) => row.geometries)) -
        Math.min(...rows.map((row) => row.geometries)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.max(...rows.map((row) => row.textures)) - Math.min(...rows.map((row) => row.textures)),
    ).toBeLessThanOrEqual(1);
    for (const row of rows) expect(row.sceneChildren).toBe(rows[0].sceneChildren);
  }
  await info.attach('resource-samples.json', {
    body: JSON.stringify(samples, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('Late SkyTrans loading cannot replace newer EV50 selection', async ({ page }) => {
  let requested!: () => void;
  const reached = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/skytrans/models/xp4.glb*', async (route) => {
    requested();
    await gate;
    await route.continue().catch(() => {});
  });
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  await page.locator('#aircraft-select').selectOption('skytrans');
  await reached;
  await page.locator('#aircraft-select').selectOption('ev50');
  release();
  await ready(page, 'ev50');
  await page.waitForTimeout(500);
  expect((await diagnostics(page)).current).toBe('ev50');
  await expect(page.locator('#aircraft-panel')).toBeHidden();
});

test('Failed model load offers local retry and keeps hangar usable', async ({ page }) => {
  let attempts = 0;
  await page.route('**/skytrans/models/xp4.glb*', async (route) => {
    if (++attempts === 1) await route.fulfill({ status: 503, body: 'QA unavailable' });
    else await route.continue();
  });
  await page.goto('/hangar/?aircraft=skytrans');
  await expect(page.locator('#load-retry')).toBeVisible();
  await expect(page.locator('#load-status')).toContainText('载入失败');
  await page.locator('#load-retry').click();
  await ready(page, 'skytrans');
  expect(attempts).toBe(2);
});

test.describe('Mobile touch controls', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('Mobile width and Back/Forward retain selectable aircraft without horizontal overflow', async ({
    page,
  }, info) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/hangar/?aircraft=unknown');
    await ready(page, 'ev50');
    await select(page, 'skytrans');
    await expect(page.locator('#quality-readout')).toHaveText('LOW');
    await expect(page.locator('#tools-toggle')).toBeInViewport();
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#aircraft-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('skytrans-mobile-controls.png') });
    await expect(page.locator('#tools-toggle')).toBeInViewport();
    await page.locator('#tools-toggle').tap();
    const beforeDrag = (await diagnostics(page)).aircraft.camera.position;
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 185, y: 390, id: 1 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 250, y: 425, id: 1 }],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect
      .poll(async () => {
        const after = (await diagnostics(page)).aircraft.camera.position;
        return Math.hypot(
          ...after.map((value: number, index: number) => value - beforeDrag[index]),
        );
      })
      .toBeGreaterThan(0.01);
    await page.screenshot({ path: info.outputPath('skytrans-mobile-aircraft.png') });
    await page.goBack();
    await ready(page, 'ev50');
    await page.goForward();
    await ready(page, 'skytrans');
    expect(errors).toEqual([]);
  });
});

test('Full-page Back restores a usable aircraft, and persisted pageshow rebuilds disposed resources', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // Three full renderer/resource readiness gates plus actual history navigation.
  const pageshows: boolean[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('HANGAR_PAGESHOW:'))
      pageshows.push(message.text().endsWith('true'));
  });
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) =>
      console.info(`HANGAR_PAGESHOW:${event.persisted}`),
    );
  });
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  await page.goto('/hangar/qa-away');
  await page.goBack();
  await ready(page, 'skytrans');
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  await info.attach('page-return.json', {
    body: JSON.stringify({ observedPersistedReturn: pageshows.includes(true), pageshows }),
    contentType: 'application/json',
  });
  // Deterministically exercise the persisted handler too, even if browser policy
  // made the genuine history navigation ineligible for BFCache on this runner.
  const beforeRestore = (await diagnostics(page)).historyRestores;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(async () => (await diagnostics(page)).historyRestores).toBe(beforeRestore + 1);
  await ready(page, 'skytrans');
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  expect((await diagnostics(page)).aircraft.runtime.state.wingTilt).toBe(0);
});

test('Native SkyTrans panel drives independent motors, surfaces, concept and JSON replay', async ({
  page,
}, info) => {
  test.setTimeout(240_000); // Covers the bounded motor wait plus the independent UI/replay checks.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  // Low keeps software-rendered CI responsive; geometry and mechanism controls are identical.
  await page.locator('#quality').selectOption('Low');
  await page.getByTestId('tw-control-manual').click();
  await page.getByText('四台独立电机', { exact: true }).click();
  await page.getByTestId('tw-motor-L_Front-enabled').check();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.actuators.L_Front.rpm)
    .toBeGreaterThan(0);
  expect((await diagnostics(page)).aircraft.runtime.state.motors.R_Front.enabled).toBe(false);
  await page.getByTestId('tw-motor-L_Front-enabled').uncheck();
  const startStop = (await diagnostics(page)).aircraft.runtime.state.time.seconds;
  const stopLimit =
    MOTOR_LIMITS.maxRpm / MOTOR_LIMITS.deceleration +
    (2 * Math.PI) / MOTOR_LIMITS.indexSpeed +
    MOTOR_LIMITS.foldSeconds +
    0.2;
  const stopWallStart = Date.now();
  const stopSamples: object[] = [];
  try {
    for (;;) {
      const sample = await page.evaluate(() => {
        const value = (window as any).hangarDiagnostics;
        const motor = value.aircraft.runtime.actuators.L_Front;
        return {
          frame: value.frameNumber,
          simulationTime: value.aircraft.runtime.state.time.seconds,
          stage: motor.stage,
          rpm: motor.rpm,
          fold: motor.fold,
        };
      });
      stopSamples.push({ ...sample, wallMilliseconds: Date.now() - stopWallStart });
      if (sample.stage === 'folded') {
        expect(sample.rpm).toBe(0);
        expect(sample.fold).toBe(1);
        break;
      }
      if (sample.simulationTime - startStop > stopLimit)
        throw new Error(
          `Motor exceeded ${stopLimit.toFixed(3)} simulation seconds without folding: ${JSON.stringify(sample)}`,
        );
      if (Date.now() - stopWallStart > 90_000)
        throw new Error(
          `Motor did not finish within the bounded software-rendering wall budget: ${JSON.stringify(sample)}`,
        );
      await page.waitForTimeout(250);
    }
  } finally {
    await info.attach('motor-stop-progress.json', {
      body: JSON.stringify(
        { simulationLimit: stopLimit, startSimulationTime: startStop, samples: stopSamples },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  await page.getByText('六片独立舵面与舱盖', { exact: true }).click();
  await page.getByTestId('tw-surface-L_Inboard').focus();
  await page.keyboard.press('End');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.state.surfaces.L_Inboard)
    .toBe(12);
  expect((await diagnostics(page)).aircraft.runtime.state.surfaces.R_Inboard).toBe(0);
  await page.getByTestId('tw-hatch').focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.state.hatchDeg).toBe(55);
  await page.getByTestId('tw-hatch').focus();
  await page.keyboard.press('Home');
  await page.getByText('部件细节与系统概念', { exact: true }).click();
  await page.getByTestId('tw-detail-systems').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.conceptLoaded).toBe(true);
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  await page.screenshot({ path: info.outputPath('skytrans-systems-concept.png') });
  await page.getByTestId('tw-detail-close').click();
  await page.getByTestId('tw-internal-drive').check();
  await expect.poll(async () => (await diagnostics(page)).aircraft.internalDrive).toBe(true);
  await page.getByTestId('tw-internal-drive').uncheck();
  await page.getByTestId('tw-wireframe').check();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.state.display.wireframe)
    .toBe(true);
  await page.getByTestId('tw-wireframe').uncheck();
  await page.getByText('Python 接入与 JSON 回放', { exact: true }).click();
  await page.getByTestId('tw-example-python').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.control).toBe('replay');
  expect((await diagnostics(page)).aircraft.runtime.replayCount).toBeGreaterThan(600);
  await expect(page.locator('#time')).toContainText('帧');
  await expect(page.locator('#timeline')).toBeEnabled();
  await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#loop')).toBeDisabled();
  await expect(page.locator('#product')).toBeDisabled();
  await page.locator('#play').click();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.replayPlaying)
    .toBe(false);
  await page.locator('#playback-speed').selectOption('0.1');
  await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.replayRate).toBe(0.1);
  await page.locator('#timeline').focus();
  await page.keyboard.press('End');
  await expect
    .poll(async () => {
      const runtime = (await diagnostics(page)).aircraft.runtime;
      return runtime.replayIndex === runtime.replayCount - 1;
    })
    .toBe(true);
  await page.locator('#restart').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.replayIndex).toBe(0);
  await page.getByTestId('tw-bridge-release').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.control).toBe('local');
  expect((await diagnostics(page)).aircraft.runtime.state.wingTilt).toBe(0);
  await expect(page.locator('#product')).toBeEnabled();
  await expect(page.locator('#loop')).toBeEnabled();
  await expect(page.locator('#time')).toContainText('%');
  expect(errors).toEqual([]);
});

test('Real Python bridge owns time, receives applied ACKs and releases every shared control', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const base = 'http://127.0.0.1:8765';
  const protocol = 'transwing.sim.v1';
  await page.goto(`${base}/?aircraft=skytrans`);
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.getByText('Python 接入与 JSON 回放', { exact: true }).click();
  await page.getByTestId('tw-bridge-connect').click();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.connection)
    .toBe('connected');
  const response = await page.request.post(`${base}/api/v1/sessions`, {
    data: { protocol, clientName: 'playwright-local-fixture' },
  });
  expect(response.ok()).toBe(true);
  const { sessionId } = await response.json();
  try {
    await expect
      .poll(async () => (await diagnostics(page)).aircraft.runtime.control)
      .toBe('external');
    for (const id of ['product', 'flight', 'play', 'restart', 'timeline', 'playback-speed', 'loop'])
      await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator('#camera')).toBeEnabled();
    await expect(page.locator('#time')).toContainText('Python 时钟');
    async function command(seq: number, op: string, payload: object) {
      const accepted = await page.request.post(`${base}/api/v1/commands`, {
        data: { protocol, sessionId, seq, op, payload },
      });
      expect(accepted.ok()).toBe(true);
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${base}/api/v1/commands/${sessionId}/${seq}`)).json())
              .delivery,
        )
        .toBe('applied');
    }
    await command(1, 'set', { positionM: [1, 2, 3], wingTilt: 0.6, time: { paused: false } });
    await command(2, 'step', { dt: 1.25 });
    await expect
      .poll(async () => (await diagnostics(page)).aircraft.runtime.state.time.seconds)
      .toBe(1.25);
    await page.waitForTimeout(350);
    expect((await diagnostics(page)).aircraft.runtime.state.time.seconds).toBe(1.25);
    await expect(page.locator('#time')).toHaveText('1.25 s · Python 时钟');
    await command(3, 'pause', { paused: true });
    await page.getByTestId('tw-bridge-release').click();
    await expect.poll(async () => (await diagnostics(page)).aircraft.runtime.control).toBe('local');
    for (const id of ['product', 'flight', 'play', 'restart', 'timeline', 'playback-speed', 'loop'])
      await expect(page.locator(`#${id}`)).toBeEnabled();
    await expect(page.locator('#time')).toContainText('%');
    await expect
      .poll(async () => (await (await page.request.get(`${base}/api/v1/health`)).json()).owner)
      .toBe('ui');
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`${base}/api/v1/sessions/${sessionId}`);
  }
});

test('SkyTrans uses the EV50 stage and world terrain route without a private hangar', async ({
  page,
}, info) => {
  test.setTimeout(300_000); // Shared stage, three quality profiles, FPV and mode lifecycle; individual waits stay bounded.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  const initial = await diagnostics(page);
  expect(initial.scene.mode).toBe('product');
  expect(initial.scene.background).toBe('202c34');
  expect(initial.scene.exposure).toBe(1);
  expect(initial.scene.environmentIntensity).toBe(0.45);
  expect(initial.scene.ownedGroups).not.toContain('SkyTrans_Presentation');
  expect(initial.world.position.y).toBeCloseTo(0, 6);
  await expect(page.getByTestId('tw-environment')).toHaveCount(0);
  await expect(page.locator('#scene-tools')).toBeVisible();
  await expect(page.locator('#immersive')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('skytrans-shared-product-stage.png') });
  await page.locator('#flight').click();
  await expect(page.locator('#camera')).toHaveValue('follow');
  await expect.poll(async () => (await diagnostics(page)).aircraft.experience.playing).toBe(true);
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(0);
  await page.evaluate(() => {
    const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
    timeline.value = '132';
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(132);
  const beforeMotion = await diagnostics(page);
  await page.locator('#flight').click();
  await page.locator('#flight').click();
  await expect
    .poll(async () => (await diagnostics(page)).world.time)
    .toBeGreaterThan(beforeMotion.world.time + 0.4);
  await expect
    .poll(async () => {
      const value = await diagnostics(page);
      return value.aircraft.runtime.actuators.L_Front.rpm;
    })
    .toBeGreaterThan(100);
  // Follow has an intentional 1.05-second camera transition. Mission motion alone
  // does not imply that transition has completed, especially on a software renderer.
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  const flying = await diagnostics(page);
  expect(flying.aircraft.experience.playing).toBe(true);
  expect(flying.aircraft.camera.view).toBe('follow');
  expect(
    Math.hypot(
      flying.world.position.x - beforeMotion.world.position.x,
      flying.world.position.y - beforeMotion.world.position.y,
      flying.world.position.z - beforeMotion.world.position.z,
    ),
  ).toBeGreaterThan(1);
  expect(
    Math.hypot(
      ...flying.aircraft.camera.position.map(
        (value: number, index: number) => value - beforeMotion.aircraft.camera.position[index],
      ),
    ),
  ).toBeGreaterThan(1);
  const offset = flying.aircraft.camera.target.map(
    (value: number, index: number) =>
      value - [flying.world.position.x, flying.world.position.y, flying.world.position.z][index],
  );
  expect(Math.hypot(...offset)).toBeLessThan(15);
  expect(flying.scene.mode).toBe('flight');
  expect(flying.scene.terrainVisible).toBe(true);
  expect(flying.world.position.y).toBeGreaterThan(100);
  expect(Math.hypot(flying.world.position.x, flying.world.position.z)).toBeGreaterThan(100);
  expect(flying.world.speedMps).toBeGreaterThan(5);
  expect(flying.aircraft.runtime.state.wingTilt).toBeCloseTo(1, 5);
  expect(flying.aircraft.coordinates.bodyAlignment).toEqual([0, 0, 0, 1]);
  await expect(page.locator('#timeline')).toHaveAttribute('max', String(DEMO_DURATION));
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  const qualitySamples: any[] = [];
  for (const quality of ['Low', 'Medium'] as const) {
    await page.locator('#quality').selectOption(quality);
    const frame = (await diagnostics(page)).frameNumber;
    await expect.poll(async () => (await diagnostics(page)).frameNumber).toBeGreaterThan(frame + 1);
    await expect
      .poll(async () => (await diagnostics(page)).aircraft.rotorExposureLayers.activeIds)
      .toEqual(['L_Front', 'R_Front']);
    const d = await diagnostics(page);
    expect(d.aircraft.experience.playing).toBe(true);
    expect(d.aircraft.rotorExposureLayers.visibleLayerDrawsPerMainPass).toBe(2);
    expect(d.aircraft.rotorExposureLayers.visibleTriangles).toBeLessThanOrEqual(20000);
    expect(d.landscape.textures).toBe(2); // Mountain ground detail + bounded cloud texture.
    expect(d.landscape.triangles).toBeLessThanOrEqual(quality === 'Low' ? 45000 : 100000);
    qualitySamples.push({
      quality,
      frame: d.frameNumber,
      rendererInfoLastPass: { drawCalls: d.drawCalls, triangles: d.triangles },
      landscape: d.landscape,
      rotor: d.aircraft.rotorExposureLayers,
    });
  }
  await page.locator('#quality').selectOption('High');
  await expect(page.locator('#quality-readout')).toHaveText('HIGH');
  const highFrame = (await diagnostics(page)).frameNumber;
  await expect
    .poll(async () => (await diagnostics(page)).frameNumber)
    .toBeGreaterThan(highFrame + 1);
  await expect.poll(async () => (await diagnostics(page)).trail.pointCount).toBeGreaterThan(8);
  await page.screenshot({ path: info.outputPath('skytrans-live-terrain-follow-high.png') });
  const captured = await diagnostics(page);
  expect(captured.aircraft.experience.playing).toBe(true);
  expect(captured.aircraft.rotorExposureLayers.activeIds).toEqual(['L_Front', 'R_Front']);
  expect(captured.landscape.triangles).toBeLessThanOrEqual(180000);
  qualitySamples.push({
    quality: 'High',
    frame: captured.frameNumber,
    rendererInfoLastPass: { drawCalls: captured.drawCalls, triangles: captured.triangles },
    landscape: captured.landscape,
    rotor: captured.aircraft.rotorExposureLayers,
  });
  await info.attach('skytrans-live-flight.json', {
    body: JSON.stringify(
      {
        qualitySamples,
        beforeMotion: {
          time: beforeMotion.world.time,
          position: beforeMotion.world.position,
          camera: beforeMotion.aircraft.camera,
        },
        running: {
          time: flying.world.time,
          position: flying.world.position,
          camera: flying.aircraft.camera,
          motors: flying.aircraft.runtime.actuators,
        },
        captured: {
          time: captured.world.time,
          position: captured.world.position,
          playing: captured.aircraft.experience.playing,
          camera: captured.aircraft.camera,
          motors: captured.aircraft.runtime.actuators,
        },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.locator('#quality').selectOption('Low');
  await page.locator('#flight').click();
  await page.locator('#camera').selectOption('fpv');
  await expect.poll(async () => (await diagnostics(page)).aircraft.camera.view).toBe('fpv');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  await page.screenshot({ path: info.outputPath('skytrans-shared-terrain-fpv.png') });
  await page.locator('#product').click();
  await expect.poll(async () => (await diagnostics(page)).scene.terrainVisible).toBe(false);
  await expect(page.locator('#camera')).toHaveValue('free');
  expect((await diagnostics(page)).aircraft.experience.playing).toBe(false);
  await page.locator('#flight').click();
  await expect(page.locator('#camera')).toHaveValue('follow');
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(0);
  await page.locator('#product').click();
  await expect(page.locator('#camera')).toHaveValue('free');
  expect(errors).toEqual([]);
});

test('Unified browser control isolates models, applies once after render and preserves step clocks', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  await page.locator('#quality').selectOption('Low');
  for (const aircraft of ['ev50', 'skytrans'] as const) {
    if (aircraft === 'skytrans') await select(page, aircraft);
    const state = await page.evaluate(() => (window as any).hangarAPI.controlState());
    const invoke = (request: any) =>
      page.evaluate((request) => (window as any).hangarAPI.request(request), request);
    const envelope = { aircraft, generation: state.generation, owner: 'browser-acceptance' };
    const acquired = await invoke({
      ...envelope,
      id: `${aircraft}-acquire`,
      operation: 'control.acquire',
      payload: { controlMode: 'external', clock: 'external', ttlMs: 120000 },
    });
    expect(acquired.ok).toBe(true);
    const owner = { ...envelope, leaseId: acquired.data.leaseId };
    await expect(page.locator('#flight')).toBeDisabled();
    await expect(page.locator('#camera')).toBeEnabled();
    const legacy = await page.evaluate(() =>
      (window as any).ev50API.request({
        operation: 'flight.command',
        payload: { type: 'motor', lift: 1, cruise: 1 },
      }),
    );
    expect(legacy.ok).toBe(false);
    const frame = (await diagnostics(page)).frameNumber;
    const pose = await invoke({
      ...owner,
      id: `${aircraft}-pose`,
      operation: 'aircraft.pose',
      payload: {
        positionM: [100, 120, 70],
        attitude: [0, 0, 0, 1],
        velocityMps: [2, 0, -3],
        timeSeconds: 0,
      },
    });
    expect(pose.ok).toBe(true);
    expect(pose.ack.status).toBe('applied');
    expect(pose.ack.frame).toBeGreaterThan(frame);
    expect(pose.data.state.pose.positionM).toEqual([100, 120, 70]);
    const wrongModel = await invoke({
      ...owner,
      id: `${aircraft}-wrong-motor`,
      operation: aircraft === 'ev50' ? 'skytrans.motors' : 'ev50.motors',
      payload:
        aircraft === 'ev50' ? { motors: { L_Front: { enabled: true } } } : { lift: 1, cruise: 1 },
    });
    expect(wrongModel.ok).toBe(false);
    expect(wrongModel.error.code).toBe('AIRCRAFT_MISMATCH');
    expect(
      (await invoke({ ...owner, id: `${aircraft}-play`, operation: 'transport.play', payload: {} }))
        .ok,
    ).toBe(true);
    const command = {
      ...owner,
      id: `${aircraft}-step`,
      operation: 'clock.step',
      payload: { dt: 1.25 },
    };
    const stepped = await invoke(command);
    expect(stepped.ok).toBe(true);
    expect(stepped.data.state.clock.seconds).toBe(1.25);
    expect(stepped.data.state.pose.positionM).toEqual([102.5, 120, 66.25]);
    const repeated = await invoke(command);
    expect(repeated).toEqual(stepped);
    await page.waitForTimeout(350);
    const held = await page.evaluate(() => (window as any).hangarAPI.controlState());
    expect(held.state.clock.seconds).toBe(1.25);
    expect(held.state.pose.positionM).toEqual([102.5, 120, 66.25]);
    await info.attach(`${aircraft}-unified-applied.json`, {
      body: JSON.stringify({ acquired, pose, stepped, repeated, held }, null, 2),
      contentType: 'application/json',
    });
    expect(
      (
        await invoke({
          ...owner,
          id: `${aircraft}-release`,
          operation: 'control.release',
          payload: {},
        })
      ).ok,
    ).toBe(true);
    await expect(page.locator('#flight')).toBeEnabled();
    const stale = await invoke({
      ...owner,
      id: `${aircraft}-late`,
      operation: 'clock.step',
      payload: { dt: 1 },
    });
    expect(stale.ok).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('One local HTTP endpoint dispatches both aircraft and retries the original applied result', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const base = 'http://127.0.0.1:8790';
  const prefix = `${base}/api/hangar/v1`;
  let failedResult = false;
  await page.route('**/api/hangar/v1/results?*', async (route) => {
    const body = route.request().postDataJSON();
    if (!failedResult && body.id === 'http-step') {
      failedResult = true;
      await route.abort();
    } else await route.continue();
  });
  await page.goto(`${base}/?aircraft=skytrans&control=local`);
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await expect
    .poll(async () => (await (await page.request.get(`${prefix}/health`)).json()).ready)
    .toBe(true);
  const serverState = async () => (await (await page.request.get(`${prefix}/state`)).json()).data;
  await expect.poll(async () => (await serverState())?.state?.ready).toBe(true);
  const initial = (await serverState()).state;
  const context = {
    aircraft: 'skytrans',
    generation: initial.generation,
    owner: 'http-acceptance',
  };
  async function command(request: any) {
    expect((await page.request.post(`${prefix}/commands`, { data: request })).status()).toBe(202);
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`${prefix}/results/${request.id}?epoch=${request.epoch ?? 0}`)
            ).json()
          ).data.status,
      )
      .not.toBe('queued');
    return (
      await (
        await page.request.get(`${prefix}/results/${request.id}?epoch=${request.epoch ?? 0}`)
      ).json()
    ).data.response;
  }
  const acquired = await command({
    ...context,
    id: 'http-acquire',
    operation: 'control.acquire',
    payload: { controlMode: 'external', clock: 'external', ttlMs: 120000 },
  });
  expect(acquired.ok).toBe(true);
  const owner = { ...context, leaseId: acquired.data.leaseId };
  expect(
    (await command({ ...owner, id: 'http-play', operation: 'transport.play', payload: {} })).ok,
  ).toBe(true);
  const applied = await command({
    ...owner,
    id: 'http-step',
    operation: 'clock.step',
    payload: { dt: 2 },
  });
  expect(failedResult).toBe(true);
  expect(applied.ok).toBe(true);
  expect(applied.ack.status).toBe('applied');
  expect(applied.data.state.clock.seconds).toBe(2);
  // A failed result POST releases authority, while its immutable original result survives retry.
  await expect
    .poll(() => page.evaluate(() => (window as any).hangarAPI.controlState().lease))
    .toBeNull();
  await select(page, 'ev50');
  await expect.poll(async () => (await serverState())?.state?.aircraft).toBe('ev50');
  const late = await command({
    ...owner,
    id: 'http-old-aircraft',
    operation: 'clock.step',
    payload: { dt: 2 },
  });
  expect(late.ok).toBe(false);
  expect(late.error.code).toBe('AIRCRAFT_MISMATCH');
  const next = (await serverState()).state;
  const ev50 = await command({
    aircraft: 'ev50',
    generation: next.generation,
    owner: 'http-acceptance',
    id: 'http-ev50-acquire',
    operation: 'control.acquire',
    payload: { controlMode: 'external', clock: 'external' },
  });
  expect(ev50.ok).toBe(true);
  const ev50Owner = {
    aircraft: 'ev50',
    generation: next.generation,
    owner: 'http-acceptance',
    leaseId: ev50.data.leaseId,
  };
  expect(
    (
      await command({
        ...ev50Owner,
        id: 'http-ev50-release',
        operation: 'control.release',
        payload: {},
      })
    ).ok,
  ).toBe(true);
  const resetRequest = {
    aircraft: 'ev50',
    generation: next.generation,
    epoch: 0,
    owner: 'http-acceptance',
    id: 'http-reset-session',
    operation: 'control.resetSession',
    payload: { acknowledgeCompletedResults: true },
  };
  const reset = await command(resetRequest);
  expect(reset.ok).toBe(true);
  expect(reset.data.commandEpoch).toBe(1);
  expect(await command(resetRequest)).toEqual(reset);
  await expect.poll(async () => (await serverState())?.state?.commandEpoch).toBe(1);
  const retired = await page.request.post(`${prefix}/commands`, {
    data: { ...ev50Owner, id: 'http-retired-epoch', operation: 'clock.step', payload: { dt: 1 } },
  });
  expect(retired.status()).toBe(409);
  expect((await retired.json()).error.code).toBe('STALE_SESSION');
  const renewedEpoch = await command({
    aircraft: 'ev50',
    generation: next.generation,
    epoch: 1,
    owner: 'http-acceptance',
    id: 'http-ev50-acquire',
    operation: 'control.acquire',
    payload: { controlMode: 'external', clock: 'external' },
  });
  expect(renewedEpoch.ok).toBe(true);
  await page.locator('#unified-control').evaluate((element: HTMLDetailsElement) => {
    element.open = true;
  });
  await page.locator('#control-disable').click();
  await expect
    .poll(async () => (await (await page.request.get(`${prefix}/health`)).json()).ready)
    .toBe(false);
  await info.attach('unified-http-applied-retry.json', {
    body: JSON.stringify({ applied, late, ev50, reset, renewedEpoch }, null, 2),
    contentType: 'application/json',
  });
});

test('SkyTrans canonical brand and old links resolve to the same aircraft without duplicate ownership', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=transwing');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await expect(page).toHaveURL(/aircraft=skytrans/);
  await expect(page).toHaveTitle(/SkyCaptain/);
  await expect(page.locator('#aircraft-select option:checked')).toHaveText('SkyTrans');
  await expect(page.locator('[data-testid="tw-panel"]')).toHaveAttribute(
    'aria-label',
    'SkyTrans 原生控制台',
  );
  const listed = await page.evaluate(() => (window as any).hangarAPI.list());
  expect(listed.map((entry: any) => entry.id)).toEqual(['ev50', 'skytrans']);
  const legacyAsset = await page.request.get('/hangar/transwing/models/xp4.glb');
  const canonicalAsset = await page.request.get('/hangar/skytrans/models/xp4.glb');
  expect(legacyAsset.ok()).toBe(true);
  expect(canonicalAsset.ok()).toBe(true);
  expect(await legacyAsset.body()).toEqual(await canonicalAsset.body());
  await page.evaluate(() => (window as any).hangarAPI.select('ev50'));
  await ready(page, 'ev50');
  await page.locator('#flight').click();
  await page.locator('#play').click();
  await page.locator('#timeline').evaluate((element) => {
    (element as HTMLInputElement).value = '65';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#playback-speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).trail.pointCount).toBeGreaterThan(4);
  await page.locator('#play').click();
  const ev50Trail = (await diagnostics(page)).trail;
  expect(ev50Trail.generation).toContain('ev50:');
  await page.evaluate(() => (window as any).hangarAPI.select('transwing'));
  await ready(page, 'skytrans');
  await expect(page).toHaveURL(/aircraft=skytrans/);
  await expect(page.locator('#aircraft-headline')).toHaveText('Skytrans');
  await page.locator('#flight').click();
  await page.locator('#play').click();
  const seekTrail = async (time: number) => {
    await page.locator('#timeline').evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await expect.poll(async () => (await diagnostics(page)).world.time).toBeCloseTo(time, 5);
  };
  await seekTrail(125);
  await page.locator('#playback-speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).trail.pointCount).toBeGreaterThan(4);
  await page.locator('#play').click();
  const pausedTrail = (await diagnostics(page)).trail;
  await page.waitForTimeout(250);
  expect((await diagnostics(page)).trail.pointCount).toBe(pausedTrail.pointCount);
  expect((await diagnostics(page)).trail.lastTime).toBe(pausedTrail.lastTime);
  const beforeSeek = pausedTrail.resetCount;
  await seekTrail(126);
  expect((await diagnostics(page)).trail.resetCount).toBeGreaterThan(beforeSeek);
  expect((await diagnostics(page)).trail.pointCount).toBeLessThanOrEqual(1);
  await page.locator('#product').click();
  await expect.poll(async () => (await diagnostics(page)).trail.pointCount).toBe(0);
  expect((await diagnostics(page)).trail.bufferBytes).toBeLessThan(64 * 1024);
  expect(errors).toEqual([]);
  await info.attach('skytrans-trail-lifecycle.json', {
    body: JSON.stringify({ ev50Trail, pausedTrail, afterProduct: (await diagnostics(page)).trail }),
    contentType: 'application/json',
  });
});
