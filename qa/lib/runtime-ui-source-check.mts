/** 仅检查源代码与服务端静态标记，不声称浏览器、触摸或截图验收。 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import DetailPanel from "../../src/DetailPanel.tsx";
import { DETAIL_VIEWS, NEUTRAL_DETAIL_POSE } from "../../src/details.ts";

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;
function jsxNodes(source: string) {
  const ast = ts.createSourceFile(
    "ui.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes: JsxNode[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return nodes;
}
function opening(node: JsxNode) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}
function attribute(node: JsxNode, name: string) {
  const value = opening(node).attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  return value?.initializer;
}
function hasClass(node: JsxNode, name: string) {
  const value = attribute(node, "className");
  return (
    !!value &&
    ts.isStringLiteral(value) &&
    value.text.split(/\s+/).includes(name)
  );
}
function findClass(nodes: JsxNode[], name: string) {
  const found = nodes.filter((node) => hasClass(node, name));
  assert.equal(found.length, 1, `实际 JSX 须唯一包含 .${name}`);
  return found[0];
}
function isInside(node: ts.Node, ancestor: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent === ancestor) return true;
  return false;
}

/** 解析实际 JSX 祖先；字符串出现或未使用的旧 CSS 不能替代布局归属。 */
function checkWorkbenchSource(app: string, simulation: string) {
  const nodes = jsxNodes(app);
  const viewport = findClass(nodes, "viewport-shell");
  const scene = findClass(nodes, "scene");
  assert.ok(isInside(scene, viewport), "三维场景须属于独立大视景容器");
  assert.ok(isInside(findClass(nodes, "viewport-toolbar"), viewport));
  const mechanism = findClass(nodes, "tilt-console");
  assert.equal(attribute(mechanism, "id")?.getText(), '"mechanism-panel"');
  assert.match(attribute(mechanism, "hidden")?.getText() ?? "", /workspace/);
  assert.match(mechanism.getText(), /一个机体，两种可能/);
  assert.equal((app.match(/一个机体，两种可能/g) ?? []).length, 1);
  const flight = findClass(nodes, "flight-console");
  const interfacePanels = nodes.filter(
    (node) => opening(node).tagName.getText() === "SimulationPanel",
  );
  assert.equal(interfacePanels.length, 1);
  assert.ok(
    isInside(flight, interfacePanels[0]),
    "连续飞行控制必须真正内嵌在仿真接口中",
  );
  assert.ok(!isInside(flight, mechanism));
  const dialog = findClass(nodes, "info-modal");
  let conditionalModal = false;
  for (let parent = dialog.parent; parent; parent = parent.parent)
    if (
      ts.isJsxExpression(parent) &&
      parent.expression &&
      ts.isBinaryExpression(parent.expression) &&
      parent.expression.operatorToken.kind ===
        ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.expression.left.getText() === "modal"
    )
      conditionalModal = true;
  assert.ok(conditionalModal, "属性模态须按需挂载，不能常驻页面");
  assert.equal(attribute(dialog, "role")?.getText(), '"dialog"');
  assert.equal(attribute(dialog, "aria-modal")?.getText(), '"true"');
  assert.ok(attribute(dialog, "aria-labelledby"));
  assert.ok(isInside(findClass(nodes, "property-grid"), dialog));
  assert.ok(isInside(findClass(nodes, "property-source"), dialog));
  assert.ok(!isInside(dialog, findClass(nodes, "app-content")));
  assert.match(
    attribute(findClass(nodes, "app-content"), "inert")?.getText() ?? "",
    /modal/,
  );
  const trigger = findClass(nodes, "property-trigger");
  assert.equal(attribute(trigger, "aria-haspopup")?.getText(), '"dialog"');
  assert.match(attribute(trigger, "onClick")?.getText() ?? "", /properties/);
  assert.equal(nodes.filter((node) => hasClass(node, "spec-strip")).length, 0);
  assert.equal(nodes.filter((node) => hasClass(node, "airframes")).length, 0);
  const versionLabels = [...nodes, ...jsxNodes(simulation)].flatMap((node) =>
    ts.isJsxElement(node)
      ? node.children
          .filter(ts.isJsxText)
          .map((child) => child.text)
          .filter((text) => /\bV\d+(?:\.\d+)*\b/i.test(text))
      : [],
  );
  assert.deepEqual(versionLabels, [], "用户界面不得显示网页发行版本标签");
  return {
    viewportHasOwnToolbar: true,
    mechanismTitleIsIndependent: true,
    flightNestedInSimulationInterface: true,
    propertiesOnlyInsideModal: true,
    modalSemanticsAndBackgroundInert: true,
    visibleReleaseVersionLabels: 0,
    evidence:
      "TypeScript JSX ancestor and attribute checks; not DOM interaction",
  };
}

function verifyWorkbenchChecker() {
  const fixture = `<main>
    <div className="app-content" inert={!!modal}>
      <button className="property-trigger" aria-haspopup="dialog" onClick={() => setModal("properties")} />
      <div className="viewport-shell"><div className="scene" /><div className="viewport-toolbar" /></div>
      <section className="tilt-console" id="mechanism-panel" hidden={workspace !== "mechanism"}>一个机体，两种可能</section>
      <SimulationPanel><section className="flight-console" /></SimulationPanel>
    </div>
    {modal && <section className="info-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="property-grid" /><p className="property-source" />
    </section>}
  </main>`;
  assert.equal(
    checkWorkbenchSource(fixture, "").visibleReleaseVersionLabels,
    0,
  );
  const mutations = [
    fixture.replace(
      '<SimulationPanel><section className="flight-console" /></SimulationPanel>',
      '<SimulationPanel /><section className="flight-console" />',
    ),
    fixture
      .replace('<div className="property-grid" />', "")
      .replace("<main>", '<main><div className="property-grid" />'),
    fixture.replace("inert={!!modal}", "data-inert={!!modal}"),
    fixture
      .replace("一个机体，两种可能", "机构")
      .replace("<main>", "<main><h2>一个机体，两种可能</h2>"),
  ];
  for (const mutation of mutations)
    assert.throws(() => checkWorkbenchSource(mutation, ""));
  assert.throws(() => checkWorkbenchSource(fixture, "<span>接口 / V18</span>"));
  return { validFixtureAccepted: true, rejectedStructuralMutants: 5 };
}

type CssRule = {
  selectors: string[];
  media: string[];
  declarations: Record<string, string>;
};
/** 只求精确选择器的源码级声明；不冒充浏览器 CSS cascade/layout 引擎。 */
function cssRules(source: string, media: string[] = []): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{", cursor);
    if (start < 0) break;
    const selector = text.slice(cursor, start).trim();
    let end = start + 1;
    let depth = 1;
    let quote = "";
    for (; end < text.length && depth > 0; end++) {
      const char = text[end];
      if (quote) {
        if (char === "\\") end++;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    assert.equal(depth, 0, "CSS block 必须完整闭合");
    const body = text.slice(start + 1, end - 1);
    if (selector.startsWith("@media"))
      rules.push(...cssRules(body, [...media, selector.slice(6).trim()]));
    else if (!selector.startsWith("@")) {
      const declarations: Record<string, string> = {};
      for (const statement of body.split(";")) {
        const colon = statement.indexOf(":");
        if (colon > 0)
          declarations[statement.slice(0, colon).trim()] = statement
            .slice(colon + 1)
            .trim();
      }
      rules.push({
        selectors: selector.split(",").map((part) => part.trim()),
        media,
        declarations,
      });
    }
    cursor = end;
  }
  return rules;
}
function sourceStyle(rules: CssRule[], selector: string, width: number) {
  const result: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    const applies = rule.media.every((query) =>
      query.split(",").some((part) => {
        // 非视窗宽度条件不在本静态尺寸估计中作未经验证的假设。
        if (/prefers-|hover|pointer|orientation|height|print/.test(part))
          return false;
        const bounds = [...part.matchAll(/(min|max)-width:\s*([\d.]+)px/g)];
        assert.ok(bounds.length, `未支持的尺寸条件：${part}`);
        return bounds.every(([, kind, value]) =>
          kind === "min" ? width >= Number(value) : width <= Number(value),
        );
      }),
    );
    if (applies) Object.assign(result, rule.declarations);
  }
  return result;
}

function pixels(value: string, basis = 0) {
  if (value === "0") return 0;
  const match = /^([\d.]+)(px|%)$/.exec(value);
  assert.ok(match, `尺寸估计不支持：${value}`);
  return Number(match[1]) * (match[2] === "%" ? basis / 100 : 1);
}
function horizontalPadding(value: string, basis: number) {
  const parts = value.split(/\s+/);
  return (
    pixels(parts[1] ?? parts[0], basis) +
    pixels(parts[3] ?? parts[1] ?? parts[0], basis)
  );
}
function sceneHeight(value: string, viewportHeight: number) {
  if (/^[\d.]+px$/.test(value)) return pixels(value);
  const clamp = /^clamp\(([\d.]+)px,\s*([\d.]+)(?:s?vh),\s*([\d.]+)px\)$/.exec(
    value,
  );
  assert.ok(clamp, `画布尺寸估计不支持：${value}`);
  return Math.max(
    Number(clamp[1]),
    Math.min((Number(clamp[2]) * viewportHeight) / 100, Number(clamp[3])),
  );
}

function checkResponsiveSource(css: string) {
  const rules = cssRules(css);
  const dimensions = [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1440, 900],
    [1920, 1080],
  ];
  const samples = dimensions.map(([width, height]) => {
    const style = (selector: string) => sourceStyle(rules, selector, width);
    assert.equal(style("[hidden]").display, "none !important");
    assert.equal(style(".experience").display, "grid");
    assert.equal(
      style(".experience")["grid-template-columns"],
      "minmax(0, 1fr)",
    );
    assert.equal(style(".scene").position, "relative");
    assert.equal(style(".scene")["min-width"], "0");
    for (const property of ["left", "right", "top", "bottom", "inset"])
      assert.ok(
        !style(".scene")[property],
        `画布不得保留旧叠层偏移 ${property}`,
      );
    assert.ok(
      !["absolute", "fixed"].includes(style(".inspection-context").position),
    );
    assert.equal(style(".detail-tabs").display, "grid");
    assert.equal(style(".scrubber").width, "100%");
    assert.equal(style(".detail-header")["justify-content"], "space-between");
    assert.equal(style(".info-modal").overflow, "auto");
    assert.match(style(".info-modal")["max-height"], /100dvh/);
    assert.equal(style(".viewport-toolbar")["flex-wrap"], "wrap");
    const appWidth = Math.min(width, pixels(style(".app-shell")["max-width"]));
    const viewportWidth =
      appWidth - horizontalPadding(style("main").padding, appWidth) - 2;
    const canvasHeight = sceneHeight(style(".scene").height, height);
    const inspectionColumns = style(".experience.has-inspector")[
      "grid-template-columns"
    ];
    const sideWidth = /\s(\d+)px$/.exec(inspectionColumns);
    if (width <= 760) {
      assert.equal(inspectionColumns, "minmax(0, 1fr)");
      assert.equal(style(".workspace-tabs")["flex-wrap"], "wrap");
      assert.equal(style(".workspace-tabs > button")["min-width"], "0");
      assert.ok(pixels(style(".source-selector button")["min-height"]) >= 44);
      assert.ok(
        pixels(style(".simulation-actions button")["min-height"]) >= 44,
      );
      assert.ok(
        pixels(style(".simulation-panel .play-button")["min-height"]) >= 44,
      );
    } else assert.ok(sideWidth, "宽屏检查说明须位于独立侧列");
    assert.ok(canvasHeight >= 340, "小视窗仍须为画布保留可用高度");
    const panelWidth = sideWidth ? Number(sideWidth[1]) : viewportWidth;
    const border = width <= 760 ? 0 : 1;
    const innerWidth =
      panelWidth -
      horizontalPadding(style(".inspection-context").padding, panelWidth) -
      border;
    const columns = Number(
      /repeat\((\d+),/.exec(
        style(".detail-tabs")["grid-template-columns"],
      )?.[1],
    );
    assert.ok(columns === 2 || columns === 3);
    const gap = pixels(style(".detail-tabs").gap);
    const tabWidth = (innerWidth - gap * (columns - 1)) / columns;
    const largestTabTextWidth = Math.max(
      ...DETAIL_VIEWS.map(
        ({ label }) =>
          [...label].reduce(
            (ems, char) => ems + (/\s/.test(char) ? 0.5 : 1),
            0,
          ) * pixels(style(".detail-tabs button")["font-size"]),
      ),
    );
    const tabPadding = horizontalPadding(
      style(".detail-tabs button").padding,
      tabWidth,
    );
    assert.ok(
      largestTabTextWidth + tabPadding + 2 < tabWidth,
      `${width}px: 标签估计 ${largestTabTextWidth + tabPadding + 2}px 不得超过按钮 ${tabWidth}px`,
    );
    return {
      viewportWidth: width,
      viewportHeight: height,
      canvasWidthWithoutInspector: viewportWidth,
      canvasWidthWithInspector:
        viewportWidth - (sideWidth ? Number(sideWidth[1]) : 0),
      canvasHeight,
      inspectorPlacement: sideWidth ? "side-column" : "after-canvas",
      panelWidth,
      innerWidth,
      columns,
      rows: Math.ceil(DETAIL_VIEWS.length / columns),
      tabWidth,
      largestTabTextWidth,
    };
  });
  assert.equal(
    sourceStyle(rules, ".motor-grid", 320)["grid-template-columns"],
    "1fr",
  );
  return {
    samples,
    evidence:
      "Exact-selector CSS declarations and source dimensions (non-space glyph=1em, space=0.5em); excludes font rendering, browser cascade, actual viewport units, overflow, touch and pixels",
  };
}

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
  const app = readFileSync(
    new URL("../../src/App.tsx", import.meta.url),
    "utf8",
  );
  const simulation = readFileSync(
    new URL("../../src/SimulationPanel.tsx", import.meta.url),
    "utf8",
  );
  const workbench = checkWorkbenchSource(app, simulation);
  const checkerSensitivity = verifyWorkbenchChecker();
  const responsiveSource = checkResponsiveSource(css);
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
  const mobile = responsiveSource.samples[0];
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
      .update(css + source + scene + app + simulation)
      .digest("hex"),
    workbench,
    checkerSensitivity,
    responsiveSource,
    mobileSourceEstimate: {
      ...mobile,
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
