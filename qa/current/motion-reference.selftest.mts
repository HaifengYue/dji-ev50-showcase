import{verifyMotionReferenceInputs}from'./motion-reference-adapter.mjs';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {acceptedDependencies,acceptedPoseGrid,assertSamePoseGrid,captureAuditMotion,compareMotionCapture,expectedPoseGrid,float64Bytes,geometryFingerprint,makePoseGrid,pairInheritance,poseGridHash,poseValues,type Pose} from './motion-reference.mts';

const smallGrid=()=>makePoseGrid([{id:'synthetic',states:[{wing:0},{wing:.5},{wing:1}]}]);
function fixture(options:{offset?:number;geometryChange?:boolean;groupChange?:boolean;missing?:boolean;added?:boolean;mutate?:boolean;mutateNormal?:boolean;omit?:boolean}={}) {
  const scene=new T.Scene();scene.name='Scene';
  const wing=new T.Group();wing.name='Wing';scene.add(wing);
  const extra=new T.Group();extra.name='Other';scene.add(extra);
  const active=new Set(['Wing','Other']);
  const geometry=()=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setAttribute('normal',new T.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));g.setIndex([0,1,2]);return g;};
  const a:any=new T.Mesh(geometry());a.name='A';a.qaGroup='Wing';wing.add(a);
  const b:any=new T.Mesh(geometry());b.name='B';b.qaGroup='固定机体';scene.add(b);
  if(options.geometryChange)a.geometry.attributes.normal.setX(0,1e-20);
  if(options.groupChange){extra.add(a);a.qaGroup='Other';}
  if(options.missing)scene.remove(b);
  const meshes:any[]=options.missing?[a]:[a,b];
  if(options.added){const c:any=new T.Mesh(geometry());c.name='C';c.qaGroup='固定机体';scene.add(c);meshes.push(c);}
  if(options.omit)meshes.pop();
  return {scene,meshes,active,sha256:'synthetic',pose(p:Pose){a.position.x=p.wing+(options.offset??0);if(options.mutate)a.geometry.setAttribute('position',a.geometry.attributes.position.clone());if(options.mutateNormal)a.geometry.setAttribute('normal',a.geometry.attributes.normal.clone());scene.updateMatrixWorld(true);}};
}
const capture=(options:Parameters<typeof fixture>[0]={})=>captureAuditMotion(fixture(options),smallGrid());

test('all original accepted reports reconstruct the complete 3,224-state grid without loading GLBs',()=>{
  const reference=verifyMotionReferenceInputs(),grid=reference.data.grid;assertSamePoseGrid(grid);assert.equal(grid.stateCount,3224);
  assert.deepEqual(grid.groups.map(g=>g.stateCount),[30,836,672,399,766,521]);assert.equal(reference.dependencyProofs.length,8);
});
test('canonical hash ignores labels, fills original defaults, and discards spin phases only while folded',()=>{
  const defaultPose={wing:.5};
  const explicit={label:'different label',wing:.5,fold:[1,1,1,1],phase:[99,88,77,66],surfaces:{L_Inboard:0,R_Inboard:0,L_Outboard:0,R_Outboard:0,Tail_L:0,Tail_R:0},hatch:0};
  assert.equal(poseGridHash([defaultPose]),poseGridHash([explicit]));
  assert.notEqual(poseGridHash([{wing:.5,fold:[0,1,1,1],phase:[0,0,0,0]}]),poseGridHash([{wing:.5,fold:[0,1,1,1],phase:[1e-15,0,0,0]}]));
  assert.notEqual(poseGridHash([{wing:0},{wing:1}]),poseGridHash([{wing:1},{wing:0}]));
});
test('exact byte encoding preserves signed zero and tiny finite differences and rejects NaN',()=>{
  assert.notDeepEqual(float64Bytes([0]),float64Bytes([-0]));assert.notDeepEqual(float64Bytes([1]),float64Bytes([1+Number.EPSILON]));
  assert.throws(()=>float64Bytes([NaN]));assert.throws(()=>poseValues({wing:0,fold:[0]}));
});
test('grid validation rejects missing/reordered poses or falsified declared hash',()=>{
  const grid=expectedPoseGrid();grid.groups[0].states.pop();assert.throws(()=>assertSamePoseGrid(grid));
  const other=expectedPoseGrid();other.groups.reverse();assert.throws(()=>assertSamePoseGrid(other));
  const third=expectedPoseGrid();third.stateParametersSha256='0'.repeat(64);assert.throws(()=>assertSamePoseGrid(third));
});
test('exact motion+geometry+ancestry allows inheritance with explicit baseline relation',()=>{
  const result=compareMotionCapture(capture(),capture(),smallGrid());assert.equal(result.passed,true);assert.deepEqual(result.exactMotionMeshes,['A','B']);assert.deepEqual(result.changedMotionMeshes,[]);
  assert.deepEqual(pairInheritance(result,'A','B'),{canInherit:true,baselineRelation:'relative',currentRelation:'relative',requiresRerun:false});
});
test('sub-tolerance matrix differences force rerun and do not imply integrity failure',()=>{
  const result=compareMotionCapture(capture(),capture({offset:1e-15}),smallGrid());assert.equal(result.passed,true);assert.deepEqual(result.changedMotionMeshes,['A']);assert.deepEqual(result.exactMotionMeshes,['B']);assert.equal(pairInheritance(result,'A','B').canInherit,false);
});
test('raw corner-normal differences forbid inheritance even when motion is bit-identical',()=>{
  const result=compareMotionCapture(capture(),capture({geometryChange:true}),smallGrid());assert.deepEqual(result.changedMotionMeshes,[]);assert.deepEqual(result.changedGeometryMeshes,['A']);assert.deepEqual(result.rerunMeshes,['A']);
});
test('active-ancestor identity changes forbid inheritance even with bit-identical world matrices',()=>{
  const result=compareMotionCapture(capture(),capture({groupChange:true}),smallGrid());assert.deepEqual(result.changedMotionMeshes,[]);assert.deepEqual(result.changedGroupMeshes,['A']);assert.equal(pairInheritance(result,'A','B').canInherit,false);
});
test('missing meshes fail closed; new meshes need explicit caller authorization and are rerun',()=>{
  assert.throws(()=>compareMotionCapture(capture(),capture({missing:true}),smallGrid()),/Missing accepted meshes/);
  assert.throws(()=>compareMotionCapture(capture(),capture({added:true}),smallGrid()),/explicit caller authorization/);
  const result=compareMotionCapture(capture(),capture({added:true}),smallGrid(),{allowedAddedMeshes:['C']});assert.deepEqual(result.addedMeshes,['C']);assert.equal(pairInheritance(result,'A','C').requiresRerun,true);assert.equal(pairInheritance(result,'B','C').currentRelation,'same-rigid');
  assert.throws(()=>pairInheritance(result,'A','unknown'));
});
test('actual scene omission and in-pose geometry replacement both fail immediately',()=>{
  assert.throws(()=>capture({omit:true}),/omitted actual scene meshes/);assert.throws(()=>capture({mutate:true}),/Rigid audit geometry mutated/);assert.throws(()=>capture({mutateNormal:true}),/Rigid audit normals mutated/);
});
test('oriented topology fingerprint preserves cyclic orientation and rejects reversed winding',()=>{
  const a=fixture().meshes[0],before=geometryFingerprint(a);a.geometry.setIndex([1,2,0]);assert.deepEqual(geometryFingerprint(a),before);
  a.geometry.setIndex([0,2,1]);assert.notDeepEqual(geometryFingerprint(a),before);
});
test('comparison refuses a capture with missing matrix coverage despite matching counts elsewhere',()=>{
  const base=capture(),current=capture();current.meshes[0].groups=[];assert.throws(()=>compareMotionCapture(base,current,smallGrid()),/incomplete pose coverage/);
});

// node:test完成后仅在所有自测成功时记录正式阶段证据。
process.once('exit',()=>{if(!process.exitCode&&process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify({passed:true,checks:12,stateCount:3224,noModelLoaded:true},null,2)+'\n');});
