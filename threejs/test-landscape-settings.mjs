import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('./src/landscape-settings.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const {
  isLandscapePreset,
  readLandscapePreset,
  rememberLandscapePreset,
  landscapeUrl,
  LANDSCAPE_STORAGE_KEY,
} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const base = new URL('https://example.test/hangar/?aircraft=skytrans&control=local#view');
assert.equal(LANDSCAPE_STORAGE_KEY, 'skycaptain.landscape.v1');
for (const value of ['mountains', 'islands']) assert.equal(isLandscapePreset(value), true);
for (const value of ['', 'desert', 'ISLANDS', '<script>', null, {}, 1])
  assert.equal(isLandscapePreset(value), false);
assert.equal(readLandscapePreset(base), 'mountains');
assert.equal(
  readLandscapePreset(base, () => 'islands'),
  'islands',
);
assert.equal(
  readLandscapePreset(new URL('?landscape=mountains', base), () => 'islands'),
  'mountains',
);
assert.equal(
  readLandscapePreset(new URL('?landscape=islands', base), () => {
    throw Error('Must not access storage');
  }),
  'islands',
);
assert.equal(
  readLandscapePreset(new URL('?landscape=invalid', base), () => 'islands'),
  'islands',
);
assert.equal(
  readLandscapePreset(base, () => 'invalid'),
  'mountains',
);
assert.equal(
  readLandscapePreset(base, () => {
    throw Error('Storage blocked');
  }),
  'mountains',
);
let saved;
assert.equal(
  rememberLandscapePreset('islands', (value) => {
    saved = value;
  }),
  true,
);
assert.equal(saved, 'islands');
assert.equal(
  rememberLandscapePreset('mountains', () => {
    throw Error('Quota');
  }),
  false,
);
assert.equal(
  rememberLandscapePreset('invalid', () => {
    throw Error('Must not write');
  }),
  false,
);
const changed = landscapeUrl(base, 'islands');
assert.equal(base.searchParams.has('landscape'), false, 'Input URL is immutable');
assert.equal(changed.origin, base.origin);
assert.equal(changed.pathname, base.pathname);
assert.equal(changed.hash, base.hash);
assert.equal(changed.searchParams.get('aircraft'), 'skytrans');
assert.equal(changed.searchParams.get('control'), 'local');
assert.equal(changed.searchParams.get('landscape'), 'islands');
assert.equal(landscapeUrl(base, 'invalid').href, base.href);
console.log(
  'PASS landscape selection: validated query, durable preference, blocked storage and URL isolation',
);
