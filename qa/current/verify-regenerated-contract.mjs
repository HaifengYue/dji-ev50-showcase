/** Preserve operational extras and hierarchy in a separately regenerated artifact, not only vertex geometry. */
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const paths = [
  "assets/blender/xp4-source.glb",
  JSON.parse(
    fs.readFileSync("qa/current/author/generator-reproducibility.json", "utf8"),
  ).regeneratedSourcePath,
];
const bytes = paths.map((p) => fs.readFileSync(p));
const docs = bytes.map((b) =>
  JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()),
);
const maps = docs.map((d) => new Map(d.nodes.map((n) => [n.name, n])));
assert.deepEqual([...maps[0].keys()].sort(), [...maps[1].keys()].sort());
let extras = 0;
for (const [name, n] of maps[0]) {
  const other = maps[1].get(name);
  assert.deepEqual(
    n.extras ?? {},
    other.extras ?? {},
    `${name} operational extras changed on regeneration`,
  );
  assert.deepEqual(
    (n.children ?? []).map((i) => docs[0].nodes[i].name).sort(),
    (other.children ?? []).map((i) => docs[1].nodes[i].name).sort(),
    `${name} regenerated hierarchy differs`,
  );
  if (n.extras) extras++;
}
const report = {
  passed: true,
  sources: paths.map((path, i) => ({
    path,
    sha256: crypto.createHash("sha256").update(bytes[i]).digest("hex"),
  })),
  nodes: maps[0].size,
  nodesWithExtras: extras,
  operationalExtrasExact: true,
  hierarchyByStableNamesExact: true,
  limitations: [
    "Complements, does not replace, independently regenerated oriented geometry/normals/animation and compressed runtime comparisons",
  ],
};
fs.writeFileSync(
  process.env.QA_OUT ?? "qa/current/regenerated-contract-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
