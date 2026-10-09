import { test, expect, type Page } from '@playwright/test';

const diagnostics = (page: Page) => page.evaluate(() => (window as any).hangarDiagnostics);
async function frameAfter(page: Page, frame: number) {
  await expect.poll(async () => (await diagnostics(page)).frameNumber).toBeGreaterThan(frame);
}
async function ready(page: Page, aircraft: string) {
  await expect
    .poll(async () => {
      const d = await diagnostics(page);
      return d?.ready && d.renderedSelectionRevision === d.selectionRevision
        ? d.renderedAircraft
        : null;
    })
    .toBe(aircraft);
  await expect(page.locator('#loading')).toBeHidden();
  await frameAfter(page, (await diagnostics(page)).frameNumber);
  expect((await diagnostics(page)).drawCalls).toBeGreaterThan(0);
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
const retained = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).hangarDiagnostics;
    return {
      control: (window as any).hangarAPI.controlState(),
      selected: d.selected,
      selectionRevision: d.selectionRevision,
      source: d.world?.source,
      time: d.world?.time,
      position: d.world?.position,
      attitude: d.world?.quaternion,
      camera: d.aircraft?.camera,
      renderCamera: d.renderCamera,
      cameraOption: (document.querySelector('#camera') as HTMLSelectElement).value,
    };
  });
function expectRetained(actual: any, expected: any) {
  const { renderCamera: actualCamera, camera: actualView, ...actualState } = actual;
  const { renderCamera: expectedCamera, camera: expectedView, ...expectedState } = expected;
  expect(actualState).toEqual(expectedState);
  if (actualView && expectedView) {
    const { position: actualPosition, target: actualTarget, ...actualMetadata } = actualView;
    const {
      position: expectedPosition,
      target: expectedTarget,
      ...expectedMetadata
    } = expectedView;
    expect(actualMetadata).toEqual(expectedMetadata);
    for (const [values, reference] of [
      [actualPosition, expectedPosition],
      [actualTarget, expectedTarget],
    ]) {
      expect(values).toHaveLength(reference.length);
      values.forEach((value: number, index: number) =>
        expect(value).toBeCloseTo(reference[index], 8),
      );
    }
  } else expect(actualView).toEqual(expectedView);
  for (const key of ['position', 'quaternion', 'projection', 'worldMatrix']) {
    expect(actualCamera[key]).toHaveLength(expectedCamera[key].length);
    actualCamera[key].forEach((value: number, index: number) =>
      expect(value).toBeCloseTo(expectedCamera[key][index], 8),
    );
  }
}
async function landscape(page: Page, preset: 'mountains' | 'islands') {
  await page.locator('#landscape').selectOption(preset);
  await expect.poll(async () => (await diagnostics(page)).landscape.profile).toBe(preset);
  await frameAfter(page, (await diagnostics(page)).frameNumber);
  expect((await diagnostics(page)).landscape.sky).toBe('blue-clouds');
}

test('Landscape swaps preserve paused and running flight while blue islands actually render', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  // Match the mountain wide capture's aspect ratio and bounded CI pixel budget.
  await page.setViewportSize({ width: 1152, height: 800 });
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=skytrans&landscape=mountains');
  await ready(page, 'skytrans');
  await page.locator('#quality').selectOption('Low');
  await page.locator('#flight').click();
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).aircraft.experience.playing).toBe(false);
  await expect(page.locator('#timeline')).toHaveAttribute('max', '316');
  const seekFrame = await page.locator('#timeline').evaluate((element) => {
    (element as HTMLInputElement).value = '170';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return (window as any).hangarDiagnostics.frameNumber;
  });
  await frameAfter(page, seekFrame);
  await page.locator('#camera').selectOption('wide');
  await expect
    .poll(async () => (await diagnostics(page)).aircraft.camera.transitioning)
    .toBe(false);
  const before = await retained(page);
  const resources: Record<string, { geometries: number; textures: number }[]> = {
    mountains: [],
    islands: [],
  };
  for (const preset of ['islands', 'mountains', 'islands', 'mountains', 'islands'] as const) {
    const old = await diagnostics(page);
    await landscape(page, preset);
    expectRetained(await retained(page), before);
    const current = await diagnostics(page);
    expect(current.trail.resetCount).toBeGreaterThan(old.trail.resetCount);
    resources[preset].push({ geometries: current.geometries, textures: current.textures });
    const count = current.trail.resetCount;
    await landscape(page, preset);
    expect((await diagnostics(page)).trail.resetCount).toBe(count);
  }
  for (const samples of Object.values(resources))
    for (const sample of samples.slice(1)) expect(sample).toEqual(samples[0]);
  for (const quality of ['Medium', 'Low']) {
    await page.locator('#quality').selectOption(quality);
    await frameAfter(page, (await diagnostics(page)).frameNumber);
    expect((await diagnostics(page)).landscape.quality).toBe(quality);
    expectRetained(await retained(page), before);
  }
  await page.locator('#quality').selectOption('High');
  await page.getByText('光线与导出', { exact: true }).click();
  await page.locator('#playback-speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(async () => (await diagnostics(page)).world.time).toBeGreaterThan(173.1);
  await page.locator('#playback-speed').selectOption('1');
  await frameAfter(page, (await diagnostics(page)).frameNumber);
  const capture = await diagnostics(page);
  expect(capture.landscape.profile).toBe('islands');
  expect(capture.landscape.quality).toBe('High');
  expect(capture.landscape.sky).toBe('blue-clouds');
  expect(capture.world.source).toBe('demo');
  expect(capture.aircraft.experience.playing).toBe(true);
  expect(capture.trail.pointCount).toBeGreaterThan(8);
  expect(capture.control.lease).toBeNull();
  await page.locator('#immersive').click();
  await expect(page.locator('body')).toHaveClass(/immersive/);
  await page.screenshot({
    path: info.outputPath('skytrans-blue-sky-islands-running-high.png'),
    timeout: 60_000,
  });
  await page.locator('#exit-immersive').click();
  // Dispatch the public selector event in one task to prove the switch itself
  // never advances, seeks or pauses the running simulation.
  const change = await page.locator('#landscape').evaluate((element) => {
    const state = () => ({
      control: (window as any).hangarAPI.controlState(),
      world: (window as any).hangarDiagnostics.world,
      camera: (window as any).hangarDiagnostics.aircraft.camera,
      playing: (window as any).hangarDiagnostics.aircraft.experience.playing,
    });
    const before = state();
    (element as HTMLSelectElement).value = 'mountains';
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, after: state(), frame: (window as any).hangarDiagnostics.frameNumber };
  });
  expect(change.after).toEqual(change.before);
  expect(change.after.playing).toBe(true);
  await frameAfter(page, change.frame);
  expect((await diagnostics(page)).world.time).toBeGreaterThan(change.before.world.time);
  expect((await diagnostics(page)).landscape.profile).toBe('mountains');
  await info.attach('landscape-local-flight.json', {
    body: JSON.stringify({ before, resources, capture, change }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('Both aircraft retain external lease, pose, clock and view across visual landscapes', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=ev50&landscape=mountains');
  await ready(page, 'ev50');
  await page.locator('#quality').selectOption('Low');
  const invoke = (request: any) =>
    page.evaluate((request) => (window as any).hangarAPI.request(request), request);
  const records = [];
  for (const aircraft of ['ev50', 'skytrans'] as const) {
    await page.locator('#aircraft-select').selectOption(aircraft);
    await ready(page, aircraft);
    const state = await page.evaluate(() => (window as any).hangarAPI.controlState());
    const envelope = {
      aircraft,
      generation: state.generation,
      epoch: state.commandEpoch,
      owner: 'landscape-acceptance',
    };
    const acquired = await invoke({
      ...envelope,
      id: `${aircraft}-landscape-acquire`,
      operation: 'control.acquire',
      payload: { controlMode: 'external', clock: 'external', ttlMs: 120000 },
    });
    expect(acquired.ok).toBe(true);
    const owner = { ...envelope, leaseId: acquired.data.leaseId };
    expect(
      (
        await invoke({
          ...owner,
          id: `${aircraft}-landscape-pose`,
          operation: 'aircraft.pose',
          payload: {
            positionM: [100, 180, -300],
            attitude: [0, 0, 0, 1],
            velocityMps: [2, 0, -3],
            timeSeconds: 10,
          },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await invoke({
          ...owner,
          id: `${aircraft}-landscape-play`,
          operation: 'transport.play',
          payload: {},
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await invoke({
          ...owner,
          id: `${aircraft}-landscape-step-zero`,
          operation: 'clock.step',
          payload: { dt: 0 },
        })
      ).ok,
    ).toBe(true);
    await page.locator('#camera').selectOption('free');
    await expect
      .poll(async () => (await diagnostics(page)).aircraft?.camera?.transitioning === true)
      .toBe(false);
    await frameAfter(page, (await diagnostics(page)).frameNumber);
    const before = await retained(page);
    await expect(page.locator('#flight')).toBeDisabled();
    await expect(page.locator('#landscape')).toBeEnabled();
    for (const preset of ['islands', 'mountains'] as const) {
      await landscape(page, preset);
      expectRetained(await retained(page), before);
      const count = (await diagnostics(page)).trail.resetCount;
      await landscape(page, preset);
      expect((await diagnostics(page)).trail.resetCount).toBe(count);
    }
    records.push({ aircraft, before, after: await retained(page) });
    expect(
      (
        await invoke({
          ...owner,
          id: `${aircraft}-landscape-release`,
          operation: 'control.release',
          payload: {},
        })
      ).ok,
    ).toBe(true);
    await expect(page.locator('#flight')).toBeEnabled();
  }
  await info.attach('landscape-external-ownership.json', {
    body: JSON.stringify(records),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('Landscape query and saved preference survive reload and persisted page restoration', async ({
  page,
}, info) => {
  test.setTimeout(360_000); // Real Back, fresh reload, persisted restore and blocked-storage startup.
  const errors = watchErrors(page);
  await page.goto('/hangar/?aircraft=ev50&landscape=mountains');
  await ready(page, 'ev50');
  await page.locator('#quality').selectOption('Low');
  await landscape(page, 'islands');
  expect(new URL(page.url()).searchParams.get('aircraft')).toBe('ev50');
  expect(new URL(page.url()).searchParams.get('landscape')).toBe('islands');
  expect(await page.evaluate(() => localStorage.getItem('skycaptain.landscape.v1'))).toBe(
    'islands',
  );
  await page.goto('/hangar/qa-away');
  await page.goBack();
  await ready(page, 'ev50');
  expect((await diagnostics(page)).landscape.profile).toBe('islands');
  await expect(page.locator('#landscape')).toHaveValue('islands');
  await page.goto('/hangar/?aircraft=ev50&landscape=invalid');
  await ready(page, 'ev50');
  expect((await diagnostics(page)).landscape.profile).toBe('islands');
  await expect(page.locator('#landscape')).toHaveValue('islands');
  await page.locator('#quality').selectOption('Low');
  const before = (await diagnostics(page)).historyRestores;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(async () => (await diagnostics(page)).historyRestores).toBe(before + 1);
  await ready(page, 'ev50');
  expect((await diagnostics(page)).landscape.profile).toBe('islands');
  await expect(page.locator('#scene')).toHaveCount(1);
  await info.attach('landscape-persistence.json', {
    body: JSON.stringify(await diagnostics(page)),
    contentType: 'application/json',
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage disabled for acceptance', 'SecurityError');
      },
    });
  });
  await page.goto('/hangar/?aircraft=ev50&landscape=invalid');
  await ready(page, 'ev50');
  expect((await diagnostics(page)).landscape.profile).toBe('mountains');
  await expect(page.locator('#landscape')).toHaveValue('mountains');
  expect(errors).toEqual([]);
});
