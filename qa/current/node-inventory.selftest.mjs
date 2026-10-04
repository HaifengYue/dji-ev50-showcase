/** Pure synthetic regressions; never load a production model or evaluate motion poses. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {glbNodeInventory} from './node-inventory.mjs';
import {captureScope} from './verify-inheritance.mjs';

const glb = json => {
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(padded);
  const bytes = Buffer.alloc(20 + padded.length);
  bytes.writeUInt32LE(0x46546c67, 0);bytes.writeUInt32LE(2, 4);bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);bytes.writeUInt32LE(0x4e4f534a, 16);padded.copy(bytes, 20);
  return bytes;
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const source = () => ({asset:{version:'2.0'},scene:0,scenes:[{name:'Scene',nodes:[0,3,4]}],
  nodes:[{name:'WingPivot_R',children:[1,2]},{name:'Wing',mesh:0},{name:'BraceWing_R'},
    {name:'RootAxisStart_R'},{name:'Fixed.001',mesh:0}],meshes:[{primitives:[{attributes:{}}]}]});
const inventory = json => {const bytes=glb(json);return glbNodeInventory(bytes,digest(bytes));};
const capture = inv => ({modelSha256:inv.modelSha256,activeNodeNames:['WingPivot_R'],meshes:[
  {name:'Fixed001',hierarchy:{qaGroup:'固定机体',nearestActiveAncestor:null,ancestors:[
    {name:'Fixed001',type:'Mesh',isActive:false},{name:'Scene',type:'Group',isActive:false}]}},
  {name:'Wing',hierarchy:{qaGroup:'WingPivot_R',nearestActiveAncestor:'WingPivot_R',ancestors:[
    {name:'Wing',type:'Mesh',isActive:false},{name:'WingPivot_R',type:'Object3D',isActive:true},
    {name:'Scene',type:'Group',isActive:false}]}}
]});

export function runNodeInventorySelftests() {
  let checks=0;
  const test = fn => {fn();checks++;};
  test(()=>{const inv=inventory(source());assert.equal(inv.nodeCount,6);assert.equal(inv.meshCount,2);assert(inv.nodes.some(n=>n.name==='Fixed001'));});
  test(()=>{const inv=inventory(source()),scope=captureScope(capture(inv),{transformChanges:['RootAxisStart_R','BraceWing_R']},inv);
    assert.deepEqual(scope.rerunMeshes,[]);assert.deepEqual(scope.transformedAncestorDescendants,[
      {ancestor:'BraceWing_R',meshDescendants:[]},{ancestor:'RootAxisStart_R',meshDescendants:[]}]);});
  test(()=>{const inv=inventory(source()),scope=captureScope(capture(inv),{transformChanges:['WingPivot_R','BraceWing_R'],geometryChanges:['Fixed001']},inv);
    assert.deepEqual(scope.rerunMeshes,['Fixed001','Wing']);assert.deepEqual(scope.inheritanceCandidates,[]);
    assert.deepEqual(scope.transformedAncestorDescendants.find(n=>n.ancestor==='WingPivot_R').meshDescendants,['Wing']);});
  test(()=>{const inv=inventory(source());assert.throws(()=>captureScope(capture(inv),{transformChanges:['UnknownMarker']},inv),/完整节点清单/);});
  test(()=>{const inv=inventory(source());assert.throws(()=>captureScope(capture(inv),{transformChanges:['BraceWing_R']}),/完整节点清单/);
    assert.throws(()=>captureScope({...capture(inv),modelSha256:'old-baseline'}, {}, inv),/当前模型绑定/);});
  test(()=>{const inv=inventory(source()),current=capture(inv);current.meshes[1].hierarchy.ancestors.splice(1,1);
    current.meshes[1].hierarchy.qaGroup='固定机体';current.meshes[1].hierarchy.nearestActiveAncestor=null;current.activeNodeNames=[];
    assert.throws(()=>captureScope(current,{transformChanges:['WingPivot_R']},inv),/父级与当前实际节点不同/);});
  test(()=>{const inv=inventory(source()),current=capture(inv);current.meshes.pop();assert.throws(()=>captureScope(current,{},inv));});
  test(()=>{const json=source();json.nodes[2].mesh=0;const inv=inventory(json),current=capture(inv);
    assert.throws(()=>captureScope(current,{transformChanges:['BraceWing_R']},inv));});
  test(()=>{const bytes=glb(source());assert.throws(()=>glbNodeInventory(bytes,'0'.repeat(64)),/model hash differs/);
    const changed=Buffer.from(bytes);changed.writeUInt32LE(bytes.length+4,8);assert.throws(()=>glbNodeInventory(changed,digest(changed)),/Truncated/);});
  test(()=>{const json=source();json.nodes[2].name='Fixed001';assert.throws(()=>inventory(json),/Ambiguous sanitized/);});
  test(()=>{const json=source();json.nodes[2].children=[0];assert.throws(()=>inventory(json),/cycle or a multiply-parented/);});
  test(()=>{const json=source();json.scenes[0].nodes.push(1);assert.throws(()=>inventory(json),/cycle or a multiply-parented/);});
  test(()=>{const json=source();json.nodes.push({name:'Unreachable'});assert.throws(()=>inventory(json),/Unreachable/);});
  test(()=>{const json=source();json.meshes[0].primitives.push({attributes:{}});assert.throws(()=>inventory(json),/Multi-primitive/);});
  test(()=>{const json=source();json.nodes[2].extensions={KHR_lights_punctual:{light:0}};assert.throws(()=>inventory(json),/extensions/);});
  return {passed:true,checks,noProductionModelLoaded:true};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(runNodeInventorySelftests());
