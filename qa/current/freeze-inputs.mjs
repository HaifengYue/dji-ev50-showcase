/** 只冻结实际生产、独立重建、继承和检查依赖；排除私有原图、临时探针及发行脚本。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {acceptedReference,resolveEvidence,verifyOriginalCode} from './reference-records.mjs';
import {localModuleDependencies} from './local-module-dependencies.mjs';
import {fileURLToPath} from 'node:url';

/** 只读取实际依赖并返回完整集合；可供汇总独立重算，不创建输出目录。 */
export function collectFrozenInputs(){
const files=new Set(),queue=[];
function add(p){p=path.normalize(p);assert(!path.isAbsolute(p)&&!p.startsWith('..'));assert(fs.statSync(p).isFile(),'缺少实际依赖 '+p);if(!files.has(p)){files.add(p);queue.push(p);}}
for(const p of ['public/models/xp4.glb','assets/blender/xp4-source.glb','assets/blender/xp4.blend','qa/current/author/source-reexport.glb','public/models/nacelle-system-concept.glb','assets/blender/nacelle-system-concept-source.glb','public/models/manifest.json','package.json','package-lock.json','scripts/package.json','scripts/package-lock.json','qa/current/run-safety.sh','qa/current/freeze-inputs.mjs','qa/current/summarize.mjs','qa/current/stages.json','qa/contracts/fuselage-slot-refinement.json','qa/contracts/supports.json','qa/contracts/wing-anchor-refinement.json','qa/contracts/drive-contact-contracts.json','qa/contracts/drive-motion.json','qa/contracts/reference-supports.json','qa/contracts/wing-anchor-target-mapping.json','scripts/data/preserved-front-surfaces.blend','scripts/data/preserved-front-surfaces.json','qa/reference/accepted-reference.json','qa/reference/source-protected-surfaces.json','qa/reference/reference-manifest.json','qa/reference/evidence-map.json','qa/reference/code-migration.json','qa/current/reference-records.mjs','qa/current/reference-data.mts'])add(p);
// 必要原始证据按来源映射逐字节验收；不保留旧完整模型或迭代目录。
const referenceManifest=JSON.parse(fs.readFileSync('qa/reference/reference-manifest.json','utf8'));
assert.equal(referenceManifest.formatVersion,1);for(const row of referenceManifest.artifacts){assert(row.path.startsWith('qa/reference/')&&row.path.endsWith('.json'),'只冻结当前精简数学参照及来源JSON');const bytes=fs.readFileSync(row.path);assert.equal(bytes.length,row.bytes,'参照字节数不符 '+row.path);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),row.sha256,'参照哈希不符 '+row.path);add(row.path);}
const evidenceMap=JSON.parse(fs.readFileSync('qa/reference/evidence-map.json','utf8'));
assert.equal(evidenceMap.formatVersion,1);for(const row of evidenceMap.entries){const evidence=resolveEvidence(row.originalPath);assert.equal(evidence.sha256,row.sha256);add(evidence.path);}
const accepted=acceptedReference();for(const row of accepted.data.codeFingerprints){const code=verifyOriginalCode(row.originalPath,row.sha256);add(code.path);}
for(const n of ['source-solids','source-kinematics','source-runtime-geometry','source-motor-animation','source-native-drive','generator-reproducibility','regenerated-runtime-geometry','regeneration-exact'])add(`qa/current/author/${n}.json`);
const rebuilt=JSON.parse(fs.readFileSync('qa/current/author/generator-reproducibility.json','utf8')),root=path.normalize(path.join(path.dirname(rebuilt.regeneratedSourcePath),'../..'));
add(rebuilt.regeneratedSourcePath);add(path.join(root,'public/models/xp4.glb'));add(path.join(root,'public/models/nacelle-system-concept.glb'));
for(const r of rebuilt.generatorHashes){add(path.join('scripts',r.file));add(path.join(root,'scripts',r.file));}
for(const p of ['scripts/reexport-source.py','scripts/verify-source.py','scripts/verify-solids.py','scripts/verify-motor-animation.py','scripts/verify-native-drive.py','scripts/verify-source-runtime.mjs','scripts/verify-regeneration.mjs','scripts/verify-regeneration-exact.mjs'])add(p);
const runner=fs.readFileSync('qa/current/run-safety.sh','utf8');for(const m of runner.matchAll(/(?:node(?: --import tsx| --test)?|python3?)\s+["']?([^\s"']+\.(?:mjs|mts|py))/g))if(!m[1].includes('$'))add(m[1]);
// 下列 SDK 实际被 python-render 脚本以子进程调用，不能只依赖 JS 静态 import 收集。
for(const entry of fs.readdirSync('python/transwing_sim',{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.py'))add('python/transwing_sim/'+entry.name);
for(let i=0;i<queue.length;i++){
 const p=queue[i];if(!/\.(ts|tsx|mjs|mts|js|jsx|cts|cjs|py)$/.test(p))continue;const s=fs.readFileSync(p,'utf8');
 if(!p.endsWith('.py'))for(const dependency of localModuleDependencies(p,s))add(dependency);
 // Python活动生成模块与局部模板按真实引用递归锁定，不能只依赖手写generatorHashes名单。
 if(p.endsWith('.py')){
  for(const match of s.matchAll(/^\s*(?:from\s+([A-Za-z_]\w*)(?:\.\w+)*\s+import|import\s+([^\n;#]+))/gm)){
   const modules=match[1]?[match[1]]:match[2].split(',').map(v=>v.trim().split(/\s+/)[0].split('.')[0]);
   for(const module of modules){const local=path.join(path.dirname(p),module+'.py');if(fs.existsSync(local)&&fs.statSync(local).isFile())add(local);}
  }
  for(const match of s.matchAll(/["'](scripts\/data\/[^"'\n]+\.(?:json|blend))["']/g))add(match[1]);
 }
 for(const m of s.matchAll(/["']([^"'\n]+\.(?:ts|tsx|mjs|mts|py))["']/g)){const q=m[1];if(q.includes('$')||q.includes('://'))continue;const c=q.startsWith('.')?path.normalize(path.join(path.dirname(p),q)):path.normalize(q);if(fs.existsSync(c)&&fs.statSync(c).isFile())add(c);}
}
// 不锁入并未被实际读取的旧可选契约；当前姿态/包络验证没有这两项输入。
for(const p of files)assert(!/package_delivery|split_delivery|package_project|author-diagnostics|preflight|private-reference|original-photo|reference-private/.test(p),'非正式或私有输入 '+p);
for(const p of ['qa/contracts/fuselage-slot-refinement.json','qa/contracts/supports.json'])assert.equal(JSON.parse(fs.readFileSync(p)).reviewed,true);
return [...files].sort();
}

function main(){
const out=process.env.QA_DIR??'qa/current/results';fs.mkdirSync(out,{recursive:true});assert(!fs.existsSync(path.join(out,'input-sha256.txt')),'不能覆盖已冻结证据');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),rows=collectFrozenInputs().map(path=>({path,sha256:sha(path)}));
fs.writeFileSync(path.join(out,'input-sha256.txt'),rows.map(r=>`${r.sha256}  ${r.path}\n`).join(''));fs.writeFileSync(path.join(out,'input-lock.json'),JSON.stringify({lockedAt:new Date().toISOString(),scope:'当前实际生产、源/重建资产、精简参考、严格未变配对继承与独立物理检查依赖；不包含发行脚本、私有原图或候选预检',files:rows},null,2)+'\n');console.log({files:rows.length,runtimeSha256:sha('public/models/xp4.glb'),sourceSha256:sha('assets/blender/xp4-source.glb')});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
