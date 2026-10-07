/** Independent V27 identity inputs. Parent metadata is inventory evidence, never material acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const STAGE=path.resolve(ROOT,process.env.TRANSWING_INTEGRATED_STAGE??'qa/revision-20261007-inset/baked-integrated-a');
assert.ok(STAGE.startsWith(path.join(ROOT,'qa/revision-20261007-inset')+path.sep),'V27 outputs must remain inside the independent inset QA stage');
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const aliases=['WingLowerClosure_L','WingLowerClosure_R'];
export const criticalPattern=/^(WingLowerClosure.*|Nacelle_[LR]_Front|Pod_wing_saddle_[LR]_Front|BraceWingSeat_[LR]|BraceRod_mesh_[LR]|BraceRod(Eye|EyeNeck|Ferrule)_[LR]_Root|Drive_.+|CargoHinge.+|ControlHinge.+|RootBearingHousing_.+|RootHingeShaft_[LR]|RootBearing(Fixed|Seal)_[LR]_(Front|Rear)|RootCarrier(Moving|Thrust|Bridge)_[LR]|RootFixedBearingPedestal_[LR]|RootFairing.+|ActuatorSideSlot_.+|Fuselage|CargoHoodShell|CargoOpeningLip|Composite_wing_[LR]|V_tail_[LR]|ControlSurface_.+|ControlFlexure.+|ControlHorn_.+|Motor_cowl_.+|Landing_wear_tip_.+|Fixed_root_[LR]|Fixed_root_blue_[LR]|Wing_blue_leading_[LR]|Blade_[LR]_(Front|Rear)_[AB]|RootHingeEndcap_.+)$/;
export const readJson=name=>JSON.parse(fs.readFileSync(path.join(STAGE,name),'utf8'));
export function identityContext(){
 const receipt=readJson('BAKE_RECEIPT.json'),reference=readJson('SOURCE_GEOMETRY_REFERENCE.json');
 const expectedSha=process.env.TRANSWING_INTEGRATED_EXPECTED_SHA??'51ec3c493b62d0d4caac924ddf1e26b6889288affa5ccd5376f0eb249be6e72c';
 const sourcePath=path.resolve(ROOT,reference.sourceCandidate);
 assert.ok(sourcePath.startsWith(path.join(ROOT,'qa/revision-20261007')+path.sep));
 assert.equal(reference.sourceCandidateSha256,expectedSha,'Reference candidate must be explicitly pinned');
 assert.equal(receipt.sourceCandidateSha256,expectedSha,'Bake receipt candidate mismatch');
 assert.equal(receipt.sourceCandidate,reference.sourceCandidate);
 assert.equal(sha(fs.readFileSync(sourcePath)),expectedSha,'Actual candidate bytes changed');
 assert.equal(sha(fs.readFileSync(path.join(STAGE,'SOURCE_GEOMETRY_REFERENCE.json'))),receipt.sourceGeometryReferenceSha256,'Bake geometry reference changed');
 const rows=reference.rows;
 assert.ok(rows&&Object.keys(rows).length>0,'Complete source object inventory is required');
 assert.ok(Object.values(rows).every(row=>['MESH','EMPTY'].includes(row.type)));
 const meshNames=Object.keys(rows).filter(name=>rows[name].type==='MESH').sort(),nodeNames=Object.keys(rows).sort();
 assert.equal(meshNames.length,receipt.expectedMeshes,'Actual reference mesh inventory disagrees with bake receipt');
 assert.equal(nodeNames.length,receipt.expectedNodes,'Actual reference node inventory disagrees with bake receipt');
 const metadataLockPath=path.join(ROOT,'V26_PIPELINE_METADATA_INPUTS.json');
 const metadataLockBytes=fs.readFileSync(metadataLockPath),metadataLock=JSON.parse(metadataLockBytes);
 assert.equal(sha(metadataLockBytes),receipt.frozenParentMetadataInputLockSha256,'Frozen V25 metadata lock changed');
 for(const [stageName,parentPath] of [['v25-parent-validation.json','assets/baseline-v25-20261007/model-validation.json'],['v25-parent-manifest.json','assets/baseline-v25-20261007/manifest.json']]){
  const locked=metadataLock.files.find(row=>row.path===parentPath),bytes=fs.readFileSync(path.join(STAGE,stageName));
  assert.ok(locked,'Missing frozen V25 metadata identity '+parentPath);
  assert.equal(bytes.length,locked.bytes,'Frozen V25 metadata byte length changed');
  assert.equal(sha(bytes),locked.sha256,'Frozen V25 metadata identity changed');
 }
 const parent=readJson('v25-parent-validation.json');
 assert.equal(parent.modelVersion,25);
 const inheritedCritical=parent.quantization.float32PositionExceptions;
 assert.ok(Array.isArray(inheritedCritical)&&inheritedCritical.length>0);
 assert.equal(new Set(inheritedCritical).size,inheritedCritical.length);
 for(const name of inheritedCritical){
  assert.ok(rows[name],'Inherited critical owner/alias disappeared: '+name);
  assert.equal(rows[name].type,aliases.includes(name)?'EMPTY':'MESH','Inherited critical node changed type: '+name);
 }
 for(const name of aliases){assert.equal(rows[name]?.type,'EMPTY');assert.equal(rows[name].parent,'WingPivot_'+name.slice(-1));}
 for(const side of ['L','R'])assert.equal(rows['Composite_wing_'+side]?.type,'MESH');
 assert.deepEqual(reference.currentMeshOwnerNames.slice().sort(),meshNames,'Source mesh-owner listing disagrees with full reference');
 assert.deepEqual(receipt.meshOwnerNames.slice().sort(),meshNames,'Bake mesh-owner listing disagrees with full reference');
 const priorPath=path.resolve(ROOT,reference.priorGeometryReference);
 assert.ok(priorPath.startsWith(ROOT+path.sep),'Prior verification reference outside project');
 const priorBytes=fs.readFileSync(priorPath),prior=JSON.parse(priorBytes);
 assert.equal(sha(priorBytes),reference.priorGeometryReferenceSha256,'Frozen prior inventory reference changed');
 assert.equal(sha(priorBytes),receipt.priorGeometryReferenceSha256);
 const priorMeshNames=new Set(Object.keys(prior.rows).filter(name=>prior.rows[name].type==='MESH'));
 const explicitlyNew=meshNames.filter(name=>!priorMeshNames.has(name));
 assert.deepEqual(reference.newMeshOwnersComparedToFrozenM.slice().sort(),explicitlyNew,'Source new-owner inventory incomplete');
 assert.deepEqual(receipt.newMeshOwnersComparedToFrozenM.slice().sort(),explicitlyNew,'Bake new-owner inventory incomplete');
 const requiredCritical=[...new Set([...inheritedCritical.filter(name=>!aliases.includes(name)),...meshNames.filter(name=>criticalPattern.test(name)),...explicitlyNew])].sort();
 return {receipt,reference,meshNames,nodeNames,requiredCritical,inheritedCritical,sourcePath,sourceCandidateSha256:expectedSha,newMeshOwnersComparedToFrozenM:explicitlyNew};
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
