// Deterministic rendered references for small scene-grading changes.
// Run against qa/serve-built.mjs. Only normal public UI controls set the view.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const output = resolve(process.argv[2] ?? 'test-results/appearance');
const baseline = process.argv.includes('--baseline');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
let page;
const report = { revision: process.env.APPEARANCE_SHA ?? null, baseline, scenes: [], errors: [] };
async function openPage() {
  const next = await browser.newPage({ viewport: { width: 1152, height: 800 } });
  next.setDefaultTimeout(30_000);
  next.on('pageerror', (error) => report.errors.push(error.message));
  next.on('console', (message) => {
    if (
      /THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS|Error creating WebGL context/.test(
        message.text(),
      )
    )
      report.errors.push(message.text());
  });
  next.on('requestfailed', (request) =>
    report.errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  return next;
}
const diagnostics = () => page.evaluate(() => window.hangarDiagnostics);
async function frameAfter(frame) {
  await expect
    .poll(async () => (await diagnostics()).frameNumber, { timeout: 30_000 })
    .toBeGreaterThan(frame);
}
async function capture(name) {
  await frameAfter((await diagnostics()).frameNumber);
  const state = await diagnostics();
  assert.ok(
    state.drawCalls > 0 && state.geometries > 10,
    'Real aircraft and landscape must render',
  );
  assert.equal(state.landscape.sky, 'blue-clouds');
  assert.equal(state.scene.terrainVisible, true);
  assert.equal(state.control.lease, null);
  if (!baseline) {
    assert.equal(state.scene.exposure, 0.96);
    assert.equal(state.scene.fog.near, 2000);
    assert.equal(state.scene.fog.far, 7400);
  }
  assert.equal(state.control.state.transport.playing, false, 'Capture a paused, repeatable pose');
  assert.ok(
    state.scene.exposure >= 0.9 && state.scene.exposure <= 1,
    'Keep conservative scene exposure',
  );
  await page.screenshot({ path: resolve(output, `${name}.png`), timeout: 60_000 });
  report.scenes.push({ name, viewport: page.viewportSize(), state });
}
try {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch('http://127.0.0.1:4174/hangar/')).ok;
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  for (const aircraft of ['skytrans', 'ev50']) {
    // Isolated captures do not share a live High-quality renderer across document navigations.
    // The separate browser suites retain the real repeated-navigation coverage.
    page = await openPage();
    await page.goto(`http://127.0.0.1:4174/hangar/?aircraft=${aircraft}&landscape=mountains`, {
      waitUntil: 'domcontentloaded',
    });
    await expect
      .poll(
        async () => {
          const d = await diagnostics();
          return d?.ready && d.renderedSelectionRevision === d.selectionRevision
            ? d.renderedAircraft
            : null;
        },
        { timeout: 30_000 },
      )
      .toBe(aircraft);
    await expect(page.locator('#loading')).toBeHidden();
    await page.locator('#quality').selectOption('High');
    assert.equal((await diagnostics()).scene.exposure, 1, 'Product exposure stays accepted');
    assert.equal((await diagnostics()).scene.background, '202c34');
    await page.locator('#flight').click();
    await page.locator('#play').click();
    await page.locator('#timeline').evaluate(
      (element, time) => {
        element.value = String(time);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      },
      aircraft === 'skytrans' ? 170 : 120,
    );
    await page.locator('#camera').selectOption(aircraft === 'skytrans' ? 'wide' : 'follow');
    // Wait for both adapters' normal camera easing to settle, without writing camera state.
    let previous;
    let previousFrame = (await diagnostics()).frameNumber;
    await expect
      .poll(
        async () => {
          await frameAfter(previousFrame);
          const state = await diagnostics();
          previousFrame = state.frameNumber;
          const matrix = state.renderCamera.worldMatrix;
          const delta = previous
            ? Math.max(...matrix.map((value, i) => Math.abs(value - previous[i])))
            : Infinity;
          previous = matrix;
          return state.aircraft?.camera?.transitioning ? Infinity : delta;
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(1e-6);
    await page.getByText('光线与导出', { exact: true }).click();
    await page.locator('#immersive').click();
    const landscapes = baseline
      ? [aircraft === 'skytrans' ? 'mountains' : 'islands']
      : ['mountains', 'islands'];
    for (const landscape of landscapes) {
      // The selector is hidden by immersive mode, so briefly use the ordinary panel.
      await page.locator('#exit-immersive').click();
      await page.locator('#landscape').selectOption(landscape);
      await page.locator('#immersive').click();
      await capture(`${aircraft}-${landscape}-daylight`);
    }
    if (!baseline && aircraft === 'ev50') {
      await page.locator('#exit-immersive').click();
      await page.locator('#lighting').selectOption('golden');
      await page.locator('#immersive').click();
      await capture('ev50-islands-golden');
      await page.locator('#exit-immersive').click();
      await page.locator('#lighting').selectOption('daylight');
      await page.locator('#quality').selectOption('Low');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await capture('ev50-islands-mobile');
    }
    if (await page.locator('body').evaluate((element) => element.classList.contains('immersive')))
      await page.locator('#exit-immersive').click();
    await page.locator('#product').click();
    await frameAfter((await diagnostics()).frameNumber);
    assert.equal((await diagnostics()).scene.exposure, 1, 'Returning to product restores exposure');
    assert.equal((await diagnostics()).scene.background, '202c34');
    await page.close();
    page = undefined;
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  if (page)
    await page
      .screenshot({ path: resolve(output, 'failure.png'), timeout: 30_000 })
      .catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, 'appearance.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
