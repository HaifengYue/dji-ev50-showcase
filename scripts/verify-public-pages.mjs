// Post-deployment smoke: the real public subpath, never a substituted local server.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { chromium, expect as baseExpect } from '../threejs/node_modules/@playwright/test/index.mjs';

const expect = baseExpect.configure({ timeout: 30_000 });

const expected = 'https://haifengyue.github.io/sky-captain/';
const base = new URL(process.argv[2] ?? expected);
assert.equal(base.href, expected, 'Only this repository’s exact public Pages URL is allowed');
const dist = resolve('threejs/dist');
const output = resolve('threejs/test-results/public-pages');
await mkdir(output, { recursive: true });
const report = {
  url: base.href,
  startedAt: new Date().toISOString(),
  assets: [],
  scenes: [],
  errors: [],
  navigations: [],
  navigationEvents: [],
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

// All bundled JS/CSS, GLB models, manifests and legacy asset aliases must match
// the exact artifact uploaded by this workflow. A successful status is not enough.
try {
  for (const path of (await files(dist)).sort()) {
    const name = relative(dist, path).split('\\').join('/');
    const url = new URL(name, base);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `Public resource ${name}`);
    const actual = Buffer.from(await response.arrayBuffer());
    const local = await readFile(path);
    assert.equal(hash(actual), hash(local), `Public resource bytes differ: ${name}`);
    report.assets.push({
      path: name,
      bytes: actual.length,
      sha256: hash(actual),
      status: response.status,
    });
  }
} catch (error) {
  report.failure = String(error?.stack ?? error);
  await writeFile(resolve(output, 'public-pages.json'), JSON.stringify(report, null, 2));
  throw error;
}
await writeFile(resolve(output, 'resource-hashes.json'), JSON.stringify(report.assets, null, 2));
console.log(`Verified ${report.assets.length} deployed resources byte-for-byte at ${base.href}`);
if (process.argv.includes('--assets-only')) {
  await writeFile(
    resolve(output, 'public-pages.json'),
    JSON.stringify({ ...report, assetsOnly: true }, null, 2),
  );
  process.exit(0);
}

let browser;
let context;
let page;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(30_000);
  await context.tracing.start({ screenshots: false, snapshots: true, sources: true });
  page = await context.newPage();
  const navigationEvent = (event, url, details = {}) =>
    report.navigationEvents.push({ at: new Date().toISOString(), event, url, ...details });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigationEvent('main-frame-navigated', frame.url());
  });
  page.on('domcontentloaded', () => navigationEvent('domcontentloaded', page.url()));
  page.on('load', () => navigationEvent('load', page.url()));
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => {
    if (
      /THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS|Error creating WebGL context/.test(
        message.text(),
      )
    )
      report.errors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    report.errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document')
      navigationEvent('document-response', response.url(), { status: response.status() });
    if (response.status() >= 400)
      report.errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  async function navigate(url, timeout = 30_000) {
    const started = Date.now();
    const navigation = { url, timeout, startedAt: new Date(started).toISOString() };
    report.navigations.push(navigation);
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      navigation.status = response?.status();
      navigation.completed = true;
    } catch (error) {
      navigation.failure = String(error);
      throw error;
    } finally {
      navigation.elapsedMs = Date.now() - started;
      navigation.actualUrl = page.url();
    }
  }
  const diagnostics = () => page.evaluate(() => window.hangarDiagnostics);
  async function ready(aircraft) {
    const actual = new URL(page.url());
    assert.equal(actual.origin, base.origin, 'Browser must remain on the deployed public origin');
    assert.equal(
      actual.pathname,
      base.pathname,
      'Browser must remain on the deployed public subpath',
    );
    await expect
      .poll(
        async () => {
          const state = await diagnostics();
          return state?.ready &&
            state.renderedAircraft === aircraft &&
            state.renderedSelectionRevision === state.selectionRevision
            ? state.current
            : null;
        },
        { timeout: 30_000 },
      )
      .toBe(aircraft);
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#scene')).toBeVisible();
    const first = (await diagnostics()).frameNumber;
    await expect
      .poll(async () => (await diagnostics()).frameNumber, { timeout: 30_000 })
      .toBeGreaterThan(first + 1);
    const state = await diagnostics();
    assert.ok(
      state.geometries > 10 && state.drawCalls > 0,
      'Actual model geometry must be rendered',
    );
    await expect(page).toHaveTitle(/SkyCaptain/);
    return state;
  }
  await navigate(base.href);
  await ready('ev50');
  await page.locator('#quality').selectOption('Low');
  report.scenes.push({ query: 'default', state: await ready('ev50') });
  await page.screenshot({ path: resolve(output, 'public-ev50-product.png'), timeout: 60_000 });

  await navigate(new URL('?aircraft=skytrans', base).href);
  await ready('skytrans');
  await expect(page.locator('#aircraft-headline')).toHaveText('Skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.locator('#route').selectOption('valley');
  await page.locator('#flight').click();
  await expect(page.locator('#timeline')).toHaveAttribute('max', '316');
  // Seek via the same public UI event as the normal timeline. Wait for that
  // state to be consumed by a real render frame before checking the scene.
  const seekFrame = await page.locator('#timeline').evaluate((element) => {
    element.value = '170';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return window.hangarDiagnostics.frameNumber;
  });
  await expect
    .poll(async () => (await diagnostics()).frameNumber, { timeout: 30_000 })
    .toBeGreaterThan(seekFrame);
  await page.locator('#camera').selectOption('wide');
  await expect
    .poll(async () => (await diagnostics()).aircraft.camera.transitioning, { timeout: 30_000 })
    .toBe(false);
  await page.locator('#playback-speed').selectOption('4');
  await expect
    .poll(async () => (await diagnostics()).world.time, { timeout: 30_000 })
    .toBeGreaterThan(173);
  await page.locator('#playback-speed').selectOption('1');
  const normalFrame = (await diagnostics()).frameNumber;
  await expect.poll(async () => (await diagnostics()).frameNumber).toBeGreaterThan(normalFrame);
  const flight = await diagnostics();
  assert.equal(flight.world.source, 'demo');
  assert.equal(flight.aircraft.experience.playing, true);
  assert.equal(flight.scene.mode, 'flight');
  assert.equal(flight.scene.terrainVisible, true);
  assert.equal(flight.landscape.quality, 'Low');
  assert.equal(flight.landscape.settlements, 8);
  assert.equal(flight.landscape.lakes, 2);
  assert.ok(flight.trail.pointCount > 8);
  assert.equal(flight.trail.drawCalls, 1);
  assert.deepEqual(flight.aircraft.rotorExposureLayers.activeIds, ['L_Front', 'R_Front']);
  assert.equal(await page.evaluate(() => window.hangarAPI.controlState().lease), null);
  report.scenes.push({ query: 'skytrans', state: flight });
  await page.getByText('光线与导出', { exact: true }).click();
  await page.locator('#immersive').click();
  await expect(page.locator('body')).toHaveClass(/immersive/);
  await page.screenshot({
    path: resolve(output, 'public-skytrans-running-landscape.png'),
    timeout: 60_000,
  });
  await page.locator('#exit-immersive').click();
  await page.locator('#play').click();
  await expect
    .poll(async () => (await diagnostics()).aircraft.experience.playing, { timeout: 30_000 })
    .toBe(false);

  // The first public run reached the new document but hit the 30 s DCL budget.
  // Preserve same-page navigation; give this one software-rendered reload a
  // bounded 60 s diagnostic allowance. Model readiness stays at 30 s below.
  await navigate(new URL('?aircraft=transwing', base).href, 60_000);
  await ready('skytrans');
  await expect(page.locator('#aircraft-select')).toHaveValue('skytrans');
  await expect(page.locator('#aircraft-headline')).toHaveText('Skytrans');
  report.scenes.push({ query: 'transwing-compatibility', state: await diagnostics() });
  await page.locator('#aircraft-select').selectOption('ev50');
  report.scenes.push({ query: 'switch-back-ev50', state: await ready('ev50') });
  // The active public build must also render the second visual preset, with
  // the other airframe. Only normal UI events select the scene and timeline.
  await page.locator('#quality').selectOption('Low');
  await page.locator('#landscape').selectOption('islands');
  await page.locator('#flight').click();
  await expect(page.locator('#timeline')).toHaveAttribute('max', '180');
  const islandFrame = await page.locator('#timeline').evaluate((element) => {
    element.value = '120';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return window.hangarDiagnostics.frameNumber;
  });
  await expect.poll(async () => (await diagnostics()).frameNumber).toBeGreaterThan(islandFrame);
  // EV50's follow camera eases after a seek. Capture only once the actual
  // rendered camera is near the aircraft, instead of a distant transit frame.
  await expect
    .poll(async () => {
      const state = await diagnostics();
      const camera = state.renderCamera.worldMatrix.slice(12, 15);
      return Math.hypot(
        ...camera.map((value, index) => value - state.control.state.pose.positionM[index]),
      );
    })
    .toBeLessThan(80);
  const island = await diagnostics();
  assert.equal(island.current, 'ev50');
  assert.equal(island.scene.mode, 'flight');
  assert.equal(island.scene.terrainVisible, true);
  assert.equal(island.landscape.profile, 'islands');
  assert.equal(island.landscape.sky, 'blue-clouds');
  assert.equal(island.landscape.quality, 'Low');
  assert.ok(island.landscape.drawCalls > 0);
  assert.equal(island.control.lease, null);
  assert.equal(island.control.state.transport.playing, true);
  report.scenes.push({ query: 'ev50-islands-ui', state: island });
  await page.screenshot({ path: resolve(output, 'public-ev50-islands.png'), timeout: 60_000 });
  assert.deepEqual(report.errors, [], 'Browser/GLSL/network errors');
  report.completedAt = new Date().toISOString();
  report.passed = true;
  console.log(
    'Public EV50, SkyTrans flight, legacy alias, switch-back and blue-sky islands rendered successfully',
  );
} catch (error) {
  report.failure = String(error?.stack ?? error);
  if (page)
    await page
      .screenshot({ path: resolve(output, 'public-failure.png'), timeout: 30_000 })
      .catch(() => {});
  throw error;
} finally {
  if (context)
    await context.tracing
      .stop({ path: resolve(output, 'public-pages-trace.zip') })
      .catch((error) => {
        report.traceFailure = String(error);
      });
  await browser?.close().catch((error) => {
    report.closeFailure = String(error);
  });
  await writeFile(resolve(output, 'public-pages.json'), JSON.stringify(report, null, 2));
}
