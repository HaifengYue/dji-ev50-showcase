/** 当前工程的运动参照来源核对：原始证据、精确路径逆变换与仅注释改写三条链分别验证。 */
import fs from 'node:fs';import assert from 'node:assert/strict';
import{verifiedReference,acceptedReference,resolveEvidence,verifyOriginalCode,readJson,sha256}from'./reference-records.mjs';
export function verifyMotionReferenceInputs(){
 const record=verifiedReference('accepted-motion-reference.json'),r=record.data,accepted=acceptedReference().data;
 assert.equal(record.sha256,'c336364b318c85bb7fa6ddf1e45ede1ea5a78b1dc33ae74cd41c346ebabb7905');assert.equal(r.acceptedSummarySha256,accepted.acceptedSummarySha256);
 assert.deepEqual(r.models.map(m=>[m.encoding,m.acceptedModelSha256]),accepted.models.map(m=>[m.encoding,m.acceptedModelSha256]));
 for(const e of r.evidence)assert.equal(resolveEvidence(e.path).sha256,e.sha256,'旧姿态来源报告漂移 '+e.path);
 const dependencyProofs=r.dependencies.map(d=>{if(d.path==='package-lock.json'){assert.equal(sha256(fs.readFileSync(d.path)),d.sha256);return {path:d.path,sha256:d.sha256,exactBytes:true};}return verifyOriginalCode(d.path,d.sha256);});
 const origin=verifiedReference('accepted-motion-grid-origin.json'),o=origin.data;assert.equal(o.passed,true);assert.equal(o.referenceSha256,record.sha256);assert.equal(o.acceptedSummarySha256,r.acceptedSummarySha256);assert.equal(o.sourceValidator.sha256,'5d55fcd489db086ac18f5d301166a1f4c13d30d2c4e6a2285d94586bdd037be3');assert.equal(resolveEvidence(o.historicalReport.path).sha256,o.historicalReport.sha256);assert.deepEqual([o.group.id,o.group.stateCount,o.group.stateParametersSha256],(()=>{const g=r.grid.groups.find(g=>g.id==='rotor-envelope');return[g.id,g.stateCount,g.stateParametersSha256]})());
 const method=verifiedReference('motion-method-origin.json'),m=method.data;assert.equal(m.referenceSha256,record.sha256);assert.equal(m.generatorOriginalSha256,r.generator.sha256);
 const methodProof=verifyOriginalCode(r.generator.path,m.currentOriginalTreeSha256),map=readJson('qa/reference/code-migration.json');assert.equal(map.editIndexUnit,'utf16-code-units');const row=map.files.find(x=>x.source===r.generator.path);assert(row);let text=fs.readFileSync(row.destination,'utf8');
 for(const e of [...row.edits].sort((a,b)=>b.destinationStart-a.destinationStart)){assert.equal(text.slice(e.destinationStart,e.destinationEnd),e.replacementText);text=text.slice(0,e.destinationStart)+e.originalText+text.slice(e.destinationEnd);}
 assert.equal(sha256(text),m.currentOriginalTreeSha256);for(const change of [...m.commentReplacements].reverse()){assert.equal(text.split(change.current).length,2,'注释逆向片段必须唯一');text=text.replace(change.current,change.original);}assert.equal(sha256(text),r.generator.sha256,'路径/中文注释逆向后生成方法不恒等');
 return {...record,dependencyProofs,gridOrigin:{path:origin.path,sha256:origin.sha256},methodOrigin:{path:method.path,sha256:method.sha256,methodProof,exactCommentOnlyRestoration:true}};
}
