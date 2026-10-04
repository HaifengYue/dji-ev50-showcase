import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This is an extraction of frozen evidence, never a geometry scan or a re-review.
// Missing properties stay missing; JSON numeric values are copied without rounding.
const root = fileURLToPath(new URL('../../', import.meta.url));
const inputs = {
  rawReport: {
    path: '../layered-wing-private/support-review/previous-accepted-support-report.json',
    sha256: '9b4df1a79cb7fbbfb0a1f377fda37a50e00e1e65df32d29baff276fc21047b8d',
  },
  previousAcceptedReference: {
    path: 'qa/reference/previous-accepted-reference.json',
    sha256: 'eadb50535353fcf85ae8a518f23f5b81c3a869bd42f3c5df2a10b30a862f3cfd',
  },
  previousSupports: {
    path: 'qa/reference/previous-supports.json',
    sha256: '64cadf0b8fd862350b2ca8b4911ba05a12d05387e2aff9a3796b4760d599d013',
  },
};
const outputPath = 'qa/reference/previous-support-bounds.json';
const manifestPath = 'qa/reference/reference-manifest.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = relativePath => readFileSync(path.resolve(root, relativePath));
const provenance = {};
const parsed = {};
for (const [name, input] of Object.entries(inputs)) {
  const bytes = read(input.path);
  assert.equal(sha256(bytes), input.sha256, `${name}: frozen input hash mismatch`);
  provenance[name] = { ...input, bytes: bytes.length };
  parsed[name] = JSON.parse(bytes);
}

const report = parsed.rawReport;
const reference = parsed.previousAcceptedReference;
const supports = parsed.previousSupports;
assert.equal(report.passed, true, 'Frozen report must be accepted');
assert.equal(report.contractReviewed, true, 'Frozen report must be reviewed');
assert.equal(report.reports.length, 2, 'Expected source and runtime reports');
assert.equal(reference.models.length, 2, 'Expected source and runtime references');
const fixedIds = supports.fixed.map(row => row.id);
assert.equal(new Set(fixedIds).size, fixedIds.length, 'Duplicate prior fixed contract ID');
const fields = ['id', 'observedBounds', 'regionCoverage', 'passed', 'sampleCount', 'spanTriangleArea'];
const modelSources = { source: 'assets/blender/xp4-source.glb', runtime: 'public/models/xp4.glb' };
const models = Object.entries(modelSources).map(([encoding, source]) => {
  const matches = report.reports.filter(model => model.source === source);
  const referenceMatches = reference.models.filter(model => model.encoding === encoding);
  assert.equal(matches.length, 1, `${encoding}: expected one report`);
  assert.equal(referenceMatches.length, 1, `${encoding}: expected one reference`);
  const model = matches[0];
  assert.equal(model.sha256, referenceMatches[0].modelSha256, `${encoding}: model identity mismatch`);
  assert.equal(model.passed, true, `${encoding}: report not accepted`);
  assert.ok(Number.isFinite(model.encodingTolerance), `${encoding}: missing original encoding tolerance`);
  if (encoding === 'source') {
    assert.equal(supports.reviewSourceSha256, model.sha256, 'Prior support source identity mismatch');
  }
  const originalRows = model.rows.filter(row => row.type === 'fixed-material');
  assert.equal(new Set(originalRows.map(row => row.id)).size, originalRows.length, `${encoding}: duplicate fixed row ID`);
  assert.deepEqual(originalRows.map(row => row.id).sort(), [...fixedIds].sort(), `${encoding}: fixed row inventory mismatch`);
  const fixed = originalRows.map(row => Object.fromEntries(
    fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]),
  ));
  assert.deepEqual(JSON.parse(JSON.stringify(fixed)), fixed, `${encoding}: lossless JSON projection failed`);
  return { encoding, source: model.source, sha256: model.sha256, encodingTolerance: model.encodingTolerance, fixed };
});
const compact = {
  formatVersion: 1,
  purpose: 'Exact fixed-interface measurements projected from the previous accepted support report; inherited evidence remains inherited and absent fields are never synthesized.',
  provenance,
  models,
};
const output = Buffer.from(`${JSON.stringify(compact)}\n`);
const artifact = {
  path: outputPath,
  sha256: sha256(output),
  bytes: output.length,
  purpose: 'Exact previous accepted per-encoding fixed-interface observed bounds and region coverage; compact historical evidence, not a new geometry review',
};
const manifest = JSON.parse(read(manifestPath));
const existing = manifest.artifacts.filter(item => item.path === outputPath);
assert.ok(existing.length <= 1, 'Duplicate compact reference manifest entries');
assert.ok(process.argv.slice(2).every(arg => arg === '--check'), 'Only --check is supported');
if (process.argv.includes('--check')) {
  assert.deepEqual(read(outputPath), output, 'Compact evidence differs from exact frozen projection');
  assert.equal(existing.length, 1, 'Compact evidence is not registered');
  assert.deepEqual(existing[0], artifact, 'Compact evidence manifest entry differs');
} else {
  if (existing.length) Object.assign(existing[0], artifact);
  else manifest.artifacts.push(artifact);
  writeFileSync(path.resolve(root, outputPath), output);
  writeFileSync(path.resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify({ ...artifact, verified: process.argv.includes('--check'), fixedRowsPerEncoding: models.map(model => ({ encoding: model.encoding, count: model.fixed.length })) }));
