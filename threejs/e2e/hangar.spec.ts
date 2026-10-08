import { test, expect, type Page } from '@playwright/test';

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
    expect(rows.at(-1)!.geometries).toBeLessThanOrEqual(rows[0].geometries + 2);
    expect(rows.at(-1)!.textures).toBeLessThanOrEqual(rows[0].textures + 1);
    expect(rows.at(-1)!.sceneChildren).toBe(rows[0].sceneChildren);
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

test('Mobile width and Back/Forward retain selectable aircraft without horizontal overflow', async ({
  page,
}, info) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/hangar/?aircraft=unknown');
  await ready(page, 'ev50');
  await select(page, 'transwing');
  await expect(page.locator('#quality-readout')).toHaveText('LOW');
  await page.locator('#tools-toggle').click();
  await expect(page.locator('#aircraft-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('transwing-mobile-controls.png') });
  await page.goBack();
  await ready(page, 'ev50');
  await page.goForward();
  await ready(page, 'transwing');
  expect(errors).toEqual([]);
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
