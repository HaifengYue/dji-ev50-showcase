/** 精简参照及原始证据的身份核对；只接受当前工程内的相对路径。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
export const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
export const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const safe=p=>{assert(!path.isAbsolute(p)&&!path.normalize(p).startsWith('..'),'参照路径不可逃出当前工程');return p;};
export function verifiedReference(name){const p='qa/reference/'+name,manifest=readJson('qa/reference/reference-manifest.json'),row=manifest.artifacts.find(r=>path.basename(r.path)===name);assert(row,'参照清单缺少 '+name);const bytes=fs.readFileSync(p);assert.equal(sha256(bytes),row.sha256,'参照字节漂移 '+name);return {path:p,sha256:row.sha256,data:JSON.parse(bytes.toString())};}
export function acceptedReference(){const r=verifiedReference('accepted-reference.json');assert.equal(r.data.formatVersion,1);assert.deepEqual(r.data.models.map(m=>m.encoding),['source','runtime']);return r;}
export function resolveEvidence(originalPath){const manifest=readJson('qa/reference/evidence-map.json'),row=manifest.entries.find(r=>r.originalPath===originalPath);assert(row,'必要原始证据未归并 '+originalPath);const p=safe(row.path),bytes=fs.readFileSync(p);assert.equal(sha256(bytes),row.sha256,'原始证据字节漂移 '+p);return {originalPath,path:p,sha256:row.sha256,data:JSON.parse(bytes.toString())};}
export function verifyOriginalCode(originalPath,expectedSha256){const manifest=readJson('qa/reference/code-migration.json'),row=manifest.files.find(r=>r.source===originalPath);assert(row,'代码迁移表缺少受保护算法 '+originalPath);const p=safe(row.destination),bytes=fs.readFileSync(p);assert.equal(sha256(bytes),row.destinationSha256,'受保护算法不再是已核对的路径迁移结果 '+p);assert.equal(manifest.editIndexUnit,'utf16-code-units','必须明示Node字符串切片的偏移单位');let restored=bytes.toString();
 for(const e of [...row.edits].sort((a,b)=>b.destinationStart-a.destinationStart)){assert.equal(restored.slice(e.destinationStart,e.destinationEnd),e.replacementText,'精确可逆片段不匹配 '+p);restored=restored.slice(0,e.destinationStart)+e.originalText+restored.slice(e.destinationEnd);}

 const restoredSha=sha256(restored);assert.equal(restoredSha,row.sourceSha256,'反向重建原代码失败 '+p);assert.equal(restoredSha,expectedSha256,'算法与已验收指纹不符 '+originalPath);return {originalPath,path:p,sha256:sha256(bytes),acceptedOriginalSha256:expectedSha256,exactReversiblePathMigration:true};
}
