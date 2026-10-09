/** Parse the current script/import graph without executing acceptance workloads. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = path.resolve(root, '../../threejs');
const hostRequire = createRequire(path.join(host, 'package.json'));
const scriptRequire = createRequire(import.meta.url);
const ts = hostRequire('typescript');
for (const dependency of Object.keys(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).dependencies)) {
  scriptRequire.resolve(dependency);
}
const seen = new Set();
let importCount = 0;
function resolveImport(specifier, source) {
  if (isBuiltin(specifier)) return;
  let resolved;
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(source), specifier);
    resolved = [base, ...['.ts', '.mts', '.mjs', '.js'].map(ext => base + ext)]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(resolved, `Missing import ${specifier} from ${path.relative(root, source)}`);
  } else {
    resolved = createRequire(source).resolve(specifier);
  }
  importCount++;
  if (!resolved.includes(`${path.sep}node_modules${path.sep}`)) inspect(resolved);
}
function inspect(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, `${file}: ${source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
  const constants = new Map();
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      resolveImport(node.moduleSpecifier.text, file);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const target = node.arguments[0];
      const specifier = ts.isStringLiteral(target) ? target.text : ts.isIdentifier(target) ? constants.get(target.text) : undefined;
      if (specifier) resolveImport(specifier, file);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const directory of ['scripts', 'scripts/pipeline', 'qa/lib', 'qa']) {
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (/\.(?:mjs|mts|ts)$/.test(name)) inspect(path.join(root, directory, name));
  }
}
const version = JSON.parse(fs.readFileSync(path.join(host, 'node_modules/three/package.json'), 'utf8')).version;
console.log(JSON.stringify({ parsedModules: seen.size, resolvedImports: importCount, hostThreeVersion: version, acceptanceWorkloadsExecuted: false }));
