/** 纯内存夹具：不读GLB、不写项目、不运行物理检查。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {localModuleDependencies,resolveLocalModule} from './local-module-dependencies.mjs';

test('省略扩展名和目录index仅递归收集实际引用的本地模块',()=>{
 const files=new Map([
  ['src/entry.mjs',`import './alpha'; export {view} from './view'; import('./esm'); const next=tsImport('./typed',import.meta.url); require('./folder'); import 'external-package'; // import './unused'
const note="./unused";`],
  ['src/alpha.ts',`export {nested} from './deep';`],
  ['src/view.tsx','export const view=1;'],
  ['src/esm.mjs','export {};'],
  ['src/typed.mts','export {};'],
  ['src/folder/index.ts',`import '../tail.mjs';`],
  ['src/deep/index.tsx','export const nested=1;'],
  ['src/tail.mjs','export {};'],
  ['src/unused.ts','throw new Error("未使用模块不可被锁入");'],
 ]);
 const queue=['src/entry.mjs'],seen=new Set(queue);
 for(let i=0;i<queue.length;i++)for(const dependency of localModuleDependencies(queue[i],files.get(queue[i]),file=>files.has(file)))if(!seen.has(dependency)){seen.add(dependency);queue.push(dependency);}
 assert.deepEqual([...seen].sort(),[...files.keys()].filter(file=>!file.includes('unused')).sort());
});

test('支持四种要求的目录index和显式扩展名以及TypeScript的JavaScript路径',()=>{
 for(const extension of ['.ts','.tsx','.mjs','.mts']){
  const files=new Set(['src/folder/index'+extension,'src/explicit'+extension]);
  assert.deepEqual(localModuleDependencies('src/main.mjs',`import './folder'; export * from './explicit${extension}';`,file=>files.has(file)),[...files]);
 }
 assert.equal(resolveLocalModule('src/main.mjs','./typed.js',file=>file==='src/typed.ts'),'src/typed.ts');
 assert.equal(resolveLocalModule('src/main.mjs','./typed.mjs',file=>file==='src/typed.mts'),'src/typed.mts');
});

test('缺失真实相对导入必须失败，包括传递边和各种导入语法',()=>{
 for(const source of ["import './missing';","export * from './missing';","import('./missing');","require('./missing');","tsImport('./missing',import.meta.url);","import missing = require('./missing');"])
  assert.throws(()=>localModuleDependencies('src/main.mts',source,()=>false),/缺少实际本地模块 src\/main.mts -> \.\/missing/);
 const files=new Map([['src/main.mjs',"import './nested';"],['src/nested.ts',"import './missing';"]]);
 const [nested]=localModuleDependencies('src/main.mjs',files.get('src/main.mjs'),file=>files.has(file));
 assert.throws(()=>localModuleDependencies(nested,files.get(nested),file=>files.has(file)),/src\/nested.ts -> \.\/missing/);
});
