/** Current native-baseline identity. No historical construction inputs are read. */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import assert from 'node:assert/strict'; import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const STAGE=path.resolve(ROOT,process.env.TRANSWING_INTEGRATED_STAGE??'build/model');
assert.ok(STAGE.startsWith(path.join(ROOT,'build')+path.sep));
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const aliases=['WingLowerClosure_L','WingLowerClosure_R'];
export const readJson=name=>JSON.parse(fs.readFileSync(path.join(STAGE,name),'utf8'));
export function identityContext(){
 const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/data/current-model-contract.json'),'utf8'));
 const receipt=readJson('BAKE_RECEIPT.json'),reference=readJson('SOURCE_GEOMETRY_REFERENCE.json');
 const sourcePath=path.join(ROOT,contract.source),expectedSha=contract.sourceSha256;
 assert.equal(sha(fs.readFileSync(sourcePath)),expectedSha,'Native baseline changed without explicit contract update');
 assert.equal(reference.sourceCandidateSha256,expectedSha);assert.equal(receipt.sourceCandidateSha256,expectedSha);
 assert.equal(sha(fs.readFileSync(path.join(STAGE,'SOURCE_GEOMETRY_REFERENCE.json'))),receipt.sourceGeometryReferenceSha256);
 const rows=reference.rows,nodeNames=Object.keys(rows).sort(),meshNames=nodeNames.filter(n=>rows[n].type==='MESH');
 assert.equal(meshNames.length,contract.expectedMeshes);assert.equal(nodeNames.length,contract.expectedNodes);
 assert.deepEqual(receipt.meshOwnerNames.slice().sort(),meshNames);assert.deepEqual(reference.currentMeshOwnerNames.slice().sort(),meshNames);
 const requiredCritical=contract.criticalMeshOwners.slice().sort();assert.equal(new Set(requiredCritical).size,requiredCritical.length);
 for(const n of requiredCritical)assert.ok(meshNames.includes(n),'Missing required exact mesh '+n);
 return {contract,receipt,reference,nodeNames,meshNames,requiredCritical,inheritedCritical:requiredCritical,sourcePath,sourceCandidateSha256:expectedSha,newMeshOwnersComparedToFrozenM:[]};
}
export function verifyBakedOutput(context,name,bytes){
 const row=context.receipt.outputs.find(row=>path.resolve(ROOT,row.path)===path.join(STAGE,name));
 assert.ok(row,'Baked artifact absent from signed-by-hash receipt: '+name);
 assert.equal(bytes.length,row.bytes,'Baked byte length changed: '+name);
 assert.equal(sha(bytes),row.sha256,'Baked bytes changed: '+name);
}
export function rawNodes(json){
 const map=new Map();
 for(const node of json.nodes??[]){assert.ok(node.name,'Unnamed source node');assert.ok(!map.has(node.name),'Duplicate raw node name '+node.name);map.set(node.name,node);}
 const parents=new Map();
 for(const node of json.nodes??[])for(const child of node.children??[]){assert.ok(json.nodes[child],'Invalid child index');const name=json.nodes[child].name;assert.ok(!parents.has(name),'Multiple raw parents: '+name);parents.set(name,node.name);}
 return {map,parents};
}
export function verifyRawInventory(context,json,label){
 const {map,parents}=rawNodes(json);
 assert.deepEqual([...map.keys()].sort(),context.nodeNames,label+' complete node inventory changed');
 assert.deepEqual([...map.values()].filter(node=>node.mesh!==undefined).map(node=>node.name).sort(),context.meshNames,label+' complete mesh-owner inventory changed');
 for(const name of context.nodeNames){assert.equal(parents.get(name)??null,context.reference.rows[name].parent,label+' parent changed: '+name);}
 return {map,parents};
}
