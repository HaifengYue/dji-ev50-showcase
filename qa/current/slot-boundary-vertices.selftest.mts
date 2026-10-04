import fs from "node:fs";
/** 纯解析小夹具：不载入 GLB，不启动 Blender/EGL，不写其他工程文件。 */
import assert from 'node:assert/strict';
import {ShapeUtils, Vector2} from 'three';
import {measureSlotBoundaryVertices, type FuselageTriangleSnapshot} from './slot-boundary-vertices.mts';

type Point = [number, number, number];
type Triangle = {vertices: Point[]; triangleIndex: number; fixtureLip: string; fixtureSurface: string};
const manifest = {longRangeBlenderY: [.9, 1.93],
  innerLipRightEndpoints: [[.0955, .9, -.0548696309], [.0955, 1.93, .0341663883]],
  outerLipRightEndpoints: [[.205, .9, -.0548696309 + .055], [.116, 1.93, .0341663883 + .055]]};
const stations = [.9, 1.03, 1.25, 1.46, 1.68, 1.93];
const world = (p: Point): Point => [p[0], p[2], -p[1]];
const actual = (p: Point): Point => [p[0], -p[2], p[1]];
const nominal = (kind: string, y: number): Point => {
  const ps = kind === 'lower' ? manifest.innerLipRightEndpoints : manifest.outerLipRightEndpoints;
  const t = (y - .9) / 1.03;
  return [ps[0][0] + t * (ps[1][0] - ps[0][0]), y, ps[0][2] + t * (ps[1][2] - ps[0][2])];
};

/** 各唇边由完整闭合薄壁棱柱构成；只有切壁邻接原始上下皮的边应成为拟合链。 */
function fixture(options: {wave?: number; shift?: number; crossInner?: boolean; extra?: boolean; duplicateEnvelope?: boolean; innerPeak?: boolean; extraCaps?: boolean; nonmonotone?: boolean} = {}): {triangles: Triangle[]} {
  const triangles: Triangle[] = [];
  const ys = options.extraCaps ? [.87, ...stations, 1.96] : options.nonmonotone ? [.9, 1.25, 1.03, 1.46, 1.68, 1.93] : stations;
  const add = (vertices: Point[], fixtureLip: string, fixtureSurface: string) => triangles.push({vertices: vertices.map(world), triangleIndex: triangles.length, fixtureLip, fixtureSurface});
  function ribbon(kind: string, side: string, sign: number, extraShift = 0, extraX = 0) {
    const ribbonYs = extraShift ? ys.slice(1, -1) : ys;
    const lip = kind + side, rows = ribbonYs.map(y => {
      const p = nominal(kind, y), shift = (options.shift ?? 0) + extraShift + (y === 1.25 ? options.wave ?? 0 : 0)
        + ((y < .9 || y > 1.93) ? .025 : 0);
      const x = sign * p[0] + extraX, innerX = x + sign * (kind === 'lower' ? -.03 : .03), z = p[2] + shift;
      const thickness = options.crossInner && y === 1.25 ? -.006 : options.innerPeak && y === 1.25 ? 3 : .006;
      return [[x, y, z], [innerX, y, z], [innerX, y, z + thickness], [x, y, z + thickness]] as Point[];
    });
    for (let row = 1; row < rows.length; row++) for (let edge = 0; edge < 4; edge++) {
      const a = rows[row - 1][edge], b = rows[row - 1][(edge + 1) % 4], c = rows[row][(edge + 1) % 4], d = rows[row][edge];
      const surface = ['exterior', 'back', 'interior', 'wall'][edge];
      add([a, b, c], lip, surface); add([a, c, d], lip, surface);
    }
    for (const row of [rows[0], rows.at(-1)!]) {add([row[0], row[1], row[2]], lip, 'cap'); add([row[0], row[2], row[3]], lip, 'cap');}
  }
  for (const kind of ['lower', 'upper']) for (const [side, sign] of [['L', -1], ['R', 1]] as const) ribbon(kind, side, sign);
  if (options.extra) ribbon('lower', 'R', 1, .15);
  if (options.duplicateEnvelope) ribbon('lower', 'R', 1, 0, 4e-7);
  return {triangles};
}
const run = (snapshot: FuselageTriangleSnapshot, epsilon = 1e-6) => measureSlotBoundaryVertices(snapshot, manifest, epsilon);
const failReason = (report: ReturnType<typeof run>, reason: string) => report.failures.some(f => f.reason === reason);
const copy = () => structuredClone(fixture());
let tests = 0;

const straight = fixture(), originalSnapshot = JSON.stringify(straight), good = run(straight);
assert.equal(good.passed, true, JSON.stringify(good.failures));
assert.equal(JSON.stringify(straight), originalSnapshot);
for (const line of Object.values(good.lines)) {
  assert.equal(line.chains.length, 2);
  assert.equal(line.actualPoints.length, stations.length);
  assert(line.maximumDeviation < 1e-12);
  assert(line.chains.every((c: any) => c.spansMainRange && c.simplePath && c.strictlyLongitudinal));
  for (const vertex of line.actualVertices) {
    assert.deepEqual(vertex.actualWorld, straight.triangles[vertex.sourceTriangleIndex].vertices[vertex.sourceCornerIndex]);
    assert.deepEqual(vertex.actualBlender, actual(vertex.actualWorld));
  }
} tests++;

// 名义高度完全不参与筛点：整体平移真实两层皮后仍测得原始平移后的点。
const shifted = run(fixture({shift: .123}));
assert.equal(shifted.passed, true);
assert(Math.abs(shifted.lines.lowerR.actualPoints[0][2] - (manifest.innerLipRightEndpoints[0][2] + .123)) < 1e-12);
tests++;

// Float32 主段端点略短于 1.93，必须按存储精度识别，不能补出名义端点。
const source = copy();
source.triangles.forEach(tri => tri.vertices = tri.vertices.map(p => p.map(Math.fround) as Point));
const sourceReport = run(source);
assert.equal(sourceReport.passed, true, JSON.stringify(sourceReport.failures));
assert(sourceReport.lines.lowerR.chains[0].spanBlenderY[1] < 1.93);
assert(sourceReport.lines.lowerR.actualPoints.every((p: Point) => p[1] !== 1.93));
tests++;

// 运行模型的量化残差只放宽平面/直线度识别，不改变共享顶点的焊接。
const runtime = copy();
runtime.triangles.forEach(tri => tri.vertices = tri.vertices.map(p => p.map(v => Math.round(v / 4e-5) * 4e-5) as Point));
const runtimeReport = run(runtime, 6e-5);
assert.equal(runtimeReport.passed, true, JSON.stringify(runtimeReport.failures));
assert.equal(runtimeReport.weldTolerance, 1e-12);
tests++;

// 任意高度波浪依旧属于同一竖直切壁，不能因偏离理想直线而被丢弃。
const waved = run(fixture({wave: .008}));
assert.equal(waved.passed, false);
assert(failReason(waved, 'actual-lip-vertices-not-collinear'));
assert(waved.lines.upperR.maximumDeviation > .005);
assert.equal(waved.lines.upperR.actualPoints.length, stations.length);
tests++;

const missingWall = copy();
missingWall.triangles.splice(missingWall.triangles.findIndex(t => t.fixtureLip === 'lowerR' && t.fixtureSurface === 'wall'), 1);
const missingWallReport = run(missingWall);
assert.equal(missingWallReport.passed, false);
assert(failReason(missingWallReport, 'lip-boundary-missing-unique-skin-adjacency'));
tests++;

const missingSkin = copy();
missingSkin.triangles.splice(missingSkin.triangles.findIndex(t => t.fixtureLip === 'upperL' && t.fixtureSurface === 'exterior') + 1, 1);
const missingSkinReport = run(missingSkin);
assert.equal(missingSkinReport.passed, false);
assert(failReason(missingSkinReport, 'lip-boundary-missing-unique-skin-adjacency'));
tests++;

// 高于唯一外边的内部边界可以不覆盖全长，不再强制所有边界恰为两条单调链。
const extra = run(fixture({extra: true}));
assert.equal(extra.passed, true, JSON.stringify(extra.failures));
assert.equal(extra.lines.lowerR.chains.length, 3);
assert(extra.lines.lowerR.chains.some((c: any) => !c.spansMainRange));
assert.equal(extra.lines.lowerR.actualPoints.length, stations.length);
tests++;

// 同一最低高度有两条不同实际边时，不能按目标 X 或名义高度擅自选择其中一条。
const duplicateEnvelope = run(fixture({duplicateEnvelope: true}));
assert.equal(duplicateEnvelope.passed, false);
assert(failReason(duplicateEnvelope, 'ambiguous-overlapping-lower-envelope'));
tests++;

// 内皮很陡时无需凭其竖直法线分量来否决清晰外唇；外唇仍须具备真实皮邻接。
const innerPeak = run(fixture({innerPeak: true}));
assert.equal(innerPeak.passed, true, JSON.stringify(innerPeak.failures));
assert(innerPeak.lines.lowerR.chains.some((c: any) => c.actualEdges.some((e: any) => !e.skinEligible)));
tests++;

const crossed = run(fixture({crossInner: true}));
assert.equal(crossed.passed, false);
assert(failReason(crossed, 'nonvertex-envelope-handoff'));
assert(crossed.lines.lowerR.envelope.handoffs.some((h: any) => !h.sharedOriginalVertex));
tests++;

// 比编码误差小、但比原始焊接阈值大的断裂必须失败。
const cracked = copy();
const crackedTriangle = cracked.triangles.find(t => t.fixtureLip === 'lowerR' && t.fixtureSurface === 'wall')!;
crackedTriangle.vertices[0][1] += 1e-10;
const crackedReport = run(cracked, 6e-5);
assert.equal(crackedReport.passed, false);
assert(failReason(crackedReport, 'lip-boundary-missing-unique-skin-adjacency'));
tests++;

// 闭合薄壁里的极窄回折：外包络需在两个不同原始顶点间跳接，虽远低于编码误差仍拒绝。
const tinyReversal = copy();
tinyReversal.triangles = tinyReversal.triangles.filter(t => t.fixtureLip !== 'lowerR');
const bZ = nominal('lower', 1.25)[2];
const outline = [[.9, nominal('lower', .9)[2]], [1.25, bZ], [1.1, nominal('lower', 1.1)[2] + .03],
  [1.2500002, bZ], [1.93, nominal('lower', 1.93)[2]], [1.93, nominal('lower', 1.93)[2] + .1], [.9, nominal('lower', .9)[2] + .1]];
const wallTriangles = ShapeUtils.triangulateShape(outline.map(([y, z]) => new Vector2(y, z)), []);
const rings = [.0955, .0655].map(x => outline.map(([y, z]) => [x, y, z] as Point));
const addReversal = (ps: Point[], surface: string) => tinyReversal.triangles.push({vertices: ps.map(world),
  triangleIndex: tinyReversal.triangles.length, fixtureLip: 'lowerR', fixtureSurface: surface});
for (const indices of wallTriangles) for (let side = 0; side < 2; side++) addReversal(indices.map(i => rings[side][i]), side ? 'back' : 'wall');
for (let i = 0; i < outline.length; i++) {
  const j = (i + 1) % outline.length;
  addReversal([rings[0][i], rings[0][j], rings[1][j]], 'skin');
  addReversal([rings[0][i], rings[1][j], rings[1][i]], 'skin');
}
tinyReversal.triangles.forEach((tri, i) => tri.triangleIndex = i);
const tinyReversalReport = run(tinyReversal, 6e-5);
assert.equal(tinyReversalReport.passed, false);
assert(failReason(tinyReversalReport, 'nonvertex-envelope-handoff'));
assert(tinyReversalReport.lines.lowerR.envelope.handoffs.some((h: any) => !h.sharedOriginalVertex && Math.abs(h.heightJump) > 1e-9 && Math.abs(h.heightJump) < 1e-6));
assert(!failReason(tinyReversalReport, 'lip-boundary-missing-unique-skin-adjacency'));
tests++;

const nonmonotone = run(fixture({nonmonotone: true}));
assert.equal(nonmonotone.passed, false);
assert(failReason(nonmonotone, 'ambiguous-overlapping-lower-envelope'));
tests++;

// 已声明主区间以外的短端波形不应混进主段的真实顶点拟合。
const caps = run(fixture({extraCaps: true}));
assert.equal(caps.passed, true, JSON.stringify(caps.failures));
assert(caps.lines.upperR.actualPoints.every((p: Point) => p[1] >= .9 && p[1] <= 1.93));
tests++;

// 虽然截短后的真实边仍完全共线且闭合，缺少完整主区间覆盖仍应失败。
const shortened = copy();
for (const tri of shortened.triangles) for (const p of tri.vertices) {
  const oldY = -p[2], newY = .91 + (oldY - .9) * 1.01 / 1.03;
  if (tri.fixtureLip.startsWith('upper')) p[0] += (tri.fixtureLip.endsWith('L') ? -1 : 1) * (.116 - .205) / 1.03 * (newY - oldY);
  p[2] = -newY;
}
const shortReport = run(shortened);
assert.equal(shortReport.passed, false);
assert(failReason(shortReport, 'incomplete-boundary-chain-span'));
tests++;

const nonmanifold = copy();
nonmanifold.triangles.push(structuredClone(nonmanifold.triangles.find(t => t.fixtureLip === 'lowerR' && t.fixtureSurface === 'wall')!));
const nonmanifoldReport = run(nonmanifold);
assert.equal(nonmanifoldReport.passed, false);
assert(failReason(nonmanifoldReport, 'nonmanifold-wall-union-edge'));
tests++;

const noWall = run({triangles: []});
assert.equal(noWall.passed, false);
assert(failReason(noWall, 'no-actual-cutwall-faces'));
assert.equal(measureSlotBoundaryVertices(straight, {...manifest, longRangeBlenderY: [1.93, .9]}, 1e-6).passed, false);
tests++;

const report={passed: true, analyticCases: tests,
  actualSourceVertexCounts: Object.fromEntries(Object.entries(good.lines).map(([name, line]) => [name, line.actualPoints.length])),
  sourceFloat32MaximumDeviation: Math.max(...Object.values(sourceReport.lines).map(line => line.maximumDeviation)),
  runtimeQuantizedMaximumDeviation: Math.max(...Object.values(runtimeReport.lines).map(line => line.maximumDeviation)),
  knownWaveDeviation: waved.lines.upperR.maximumDeviation, weldTolerance: 1e-12,
  tinyNonvertexEnvelopeHandoffs: tinyReversalReport.lines.lowerR.envelope.handoffs.filter((h: any) => !h.sharedOriginalVertex),
  note: '仅通过解析夹具；尚未检查实际源模型或运行模型，不能据此宣布模型通过'};
if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));
