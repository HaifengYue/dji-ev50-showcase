import { test, expect, type Page } from '@playwright/test';
import { MOTOR_LIMITS } from '../src/aircraft/transwing/core/motors';

const diagnostics = (page: Page) => page.evaluate(() => (window as any).hangarDiagnostics);
async function ready(page: Page, aircraft: 'ev50' | 'transwing') {
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
async function select(page: Page, aircraft: 'ev50' | 'transwing') {
  await page.locator('#aircraft-select').selectOption(aircraft);
  await ready(page, aircraft);
}
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('EV50 starts alone on nested base, preserves flight controls and capture', async ({
  page,
}, info) => {
  const errors = watchErrors(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  expect(requests.some((url) => url.includes('/transwing/models/'))).toBe(false);
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  await page.locator('#flight').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).ev50Diagnostics.time))
    .toBeGreaterThan(0);
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

test('Transwing integrates shared canvas, real rig, native cameras and EV50 API isolation', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // Multiple high-quality camera views plus a fully rendered EV50 return.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=transwing');
  await ready(page, 'transwing');
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  await expect(page.locator('#aircraft-panel')).toBeVisible();
  await expect(page.locator('#simulation-tools')).toBeHidden();
  const before = (await diagnostics(page)).aircraft;
  expect(before.experience.cameraView).toBe('perspective');
  expect(before.camera.type).toBe('PerspectiveCamera');
  await page.locator('#play').click();
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.runtime.state.wingTilt)
    .toBeGreaterThan(0.05);
  await page.locator('#play').click();
  const after = (await diagnostics(page)).aircraft;
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
  await page.screenshot({ path: info.outputPath('transwing-left-joint.png') });
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
    for (const id of ['transwing', 'ev50'] as const) {
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
      if (id === 'transwing') {
        expect(value.aircraft.runtime.state.wingTilt).toBe(0);
        expect(value.aircraft.experience.tilt.playing).toBe(false);
        await page.locator('#play').click();
        await expect
          .poll(async () => (await diagnostics(page)).aircraft.runtime.state.wingTilt)
          .toBeGreaterThan(0);
      }
    }
  }
  for (const id of ['ev50', 'transwing']) {
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

test('Late Transwing loading cannot replace newer EV50 selection', async ({ page }) => {
  let requested!: () => void;
  const reached = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/transwing/models/xp4.glb*', async (route) => {
    requested();
    await gate;
    await route.continue().catch(() => {});
  });
  await page.goto('/hangar/?aircraft=ev50');
  await ready(page, 'ev50');
  await page.locator('#aircraft-select').selectOption('transwing');
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
  await page.route('**/transwing/models/xp4.glb*', async (route) => {
    if (++attempts === 1) await route.fulfill({ status: 503, body: 'QA unavailable' });
    else await route.continue();
  });
  await page.goto('/hangar/?aircraft=transwing');
  await expect(page.locator('#load-retry')).toBeVisible();
  await expect(page.locator('#load-status')).toContainText('载入失败');
  await page.locator('#load-retry').click();
  await ready(page, 'transwing');
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
    await select(page, 'transwing');
    await expect(page.locator('#quality-readout')).toHaveText('LOW');
    await expect(page.locator('#tools-toggle')).toBeInViewport();
    await page.locator('#tools-toggle').tap();
    await expect(page.locator('#aircraft-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('transwing-mobile-controls.png') });
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
    await page.screenshot({ path: info.outputPath('transwing-mobile-aircraft.png') });
    await page.goBack();
    await ready(page, 'ev50');
    await page.goForward();
    await ready(page, 'transwing');
    expect(errors).toEqual([]);
  });
});

test('Full-page Back restores a usable aircraft, and persisted pageshow rebuilds disposed resources', async ({
  page,
}, info) => {
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
  await page.goto('/hangar/?aircraft=transwing');
  await ready(page, 'transwing');
  await page.goto('/hangar/qa-away');
  await page.goBack();
  await ready(page, 'transwing');
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
  await ready(page, 'transwing');
  await expect(page.locator('canvas#scene')).toHaveCount(1);
  expect((await diagnostics(page)).aircraft.runtime.state.wingTilt).toBe(0);
});

test('Native Transwing panel drives independent motors, surfaces, concept and JSON replay', async ({
  page,
}, info) => {
  test.setTimeout(240_000); // Covers the bounded motor wait plus the independent UI/replay checks.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=transwing');
  await ready(page, 'transwing');
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
  await page.screenshot({ path: info.outputPath('transwing-systems-concept.png') });
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
  await page.goto(`${base}/?aircraft=transwing`);
  await ready(page, 'transwing');
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
