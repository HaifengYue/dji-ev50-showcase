/** 仅检查源代码与服务端静态标记，不声称浏览器、触摸或截图验收。 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DetailPanel from "../../src/DetailPanel.tsx";
import { DETAIL_VIEWS, NEUTRAL_DETAIL_POSE } from "../../src/details.ts";

export function checkDetailUiSource() {
  const css = readFileSync(
    new URL("../../src/style.css", import.meta.url),
    "utf8",
  );
  const scene = readFileSync(
    new URL("../../src/Scene.tsx", import.meta.url),
    "utf8",
  );
  const primaryAsset = readFileSync(
    new URL("../../public/models/xp4.glb", import.meta.url),
  );
  const conceptAsset = readFileSync(
    new URL("../../public/models/nacelle-system-concept.glb", import.meta.url),
  );
  const source = readFileSync(
    new URL("../../src/DetailPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.detail-tabs\s*\{[^}]*display:\s*grid;/);
  assert.match(
    css,
    /\.detail-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(css, /\.detail-context\s*\{[^}]*width:\s*90%/);
  assert.match(css, /\.detail-control \.scrubber\s*\{[^}]*width:\s*100%/);
  assert.match(
    css,
    /\.detail-header\s*\{[^}]*justify-content:\s*space-between/,
  );
  assert.match(source, /<p>\{selected.description\}<\/p>/);
  assert.doesNotMatch(source, /position:\s*["']absolute/);
  assert.match(scene, /<ConceptBoundary onClose=\{props.onCloseDetail\}>/);
  assert.match(scene, /visible=\{detailView !== "systems"\}/);
  assert.match(scene, /概念模块暂时无法载入/);
  assert.match(scene, /正在载入独立概念模块…/);
  assert.ok((scene.match(/返回主机体/g) ?? []).length >= 2);
  assert.doesNotMatch(scene, /useGLTF\.preload[^\n]*nacelle-system/);
  const optionalLoader = scene.slice(
    scene.indexOf("function ConceptSystems"),
    scene.indexOf("function Ground"),
  );
  assert.match(optionalLoader, /loader\.setMeshoptDecoder\(MeshoptDecoder\)/);
  const noop = () => {};
  const tabs = [];
  for (const view of DETAIL_VIEWS) {
    const html = renderToStaticMarkup(
      createElement(DetailPanel, {
        view: view.id,
        pose: NEUTRAL_DETAIL_POSE,
        onSelect: noop,
        onChange: noop,
        onClose: noop,
        onNeutral: noop,
      }),
    );
    assert.equal((html.match(/aria-pressed=/g) ?? []).length, 6);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal(
      (html.match(/type="range"/g) ?? []).length,
      view.controls.length,
    );
    assert.match(html, /aria-label="关闭细节检查"/);
    assert.match(html, /飞行与整翼已暂停/);
    tabs.push({
      id: view.id,
      buttons: 6,
      sliders: view.controls.length,
      closePresent: true,
    });
  }
  // 每个汉字按整em保守估计，仅为源码尺寸门槛。
  const viewportWidth = 320,
    panelWidth = viewportWidth * 0.9,
    innerWidth = panelWidth - 26 - 2;
  const tabWidth = (innerWidth - 8) / 3;
  const largestTabTextWidth = Math.max(
    ...DETAIL_VIEWS.map(({ label }) => [...label].length * 10),
  );
  assert.ok(largestTabTextWidth + 6 + 2 < tabWidth);
  const blue = "#1464da",
    light = "#e8f1ff";
  assert.ok(
    css.includes(`--accent: ${blue}`) &&
      css.includes(`--accent-soft: ${light}`),
  );
  return {
    passed: true,
    evidenceType:
      "CSS/TSX source constraints and React server-rendered markup; this does not establish real browser layout, touch operation or rendered visual quality",
    assets: {
      primary: {
        sha256: createHash("sha256").update(primaryAsset).digest("hex"),
        bytes: primaryAsset.byteLength,
      },
      concept: {
        sha256: createHash("sha256").update(conceptAsset).digest("hex"),
        bytes: conceptAsset.byteLength,
      },
    },
    sourceSha256: createHash("sha256")
      .update(css + source + scene)
      .digest("hex"),
    mobileSourceEstimate: {
      viewportWidth,
      panelWidth,
      innerWidth,
      columns: 3,
      rows: 2,
      tabWidth,
      largestTabTextWidth,
      disclaimerInNormalFlow: true,
      sliderWidth: "100%",
    },
    tabs,
    optionalModule: {
      separateBoundary: true,
      loadingExit: true,
      failureExit: true,
      lazyLoaded: true,
      explicitMeshoptDecoder: true,
    },
    palettePreserved: { blue, light },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = checkDetailUiSource();
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
