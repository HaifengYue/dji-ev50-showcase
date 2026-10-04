/** Stable missing-representative regression plus actual current-model round-trip checks. */
import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';
import {loadAudit} from './snapshot-audit.mts';
import {containedComponents,solidTopology} from './solid-contact.mjs';
import {createWorldTriangles} from './triangle-contact.mjs';
// Two perpendicular open triangles. A deliberate singular test transform drops
// triangle0 while triangle1 survives. This is a cache regression fixture only,
// not an authorized transform or physical model acceptance case.
const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float64Array([0,0,0,1,0,0,0,0,1, 2,0,0,3,0,0,2,1,0]),3));
const fixture=await loadAudit(),paint:any=fixture.scene.getObjectByName('Wing_blue_leading_L');assert(paint?.isMesh);const stale=fixture.topology.get(paint.name);paint.geometry=geometry;
const box=new T.Mesh(new T.BoxGeometry(20,20,20));box.name='closed-test-container';
const topology=fixture.topology;topology.set(box.name,solidTopology(createWorldTriangles(box),1e-12));
paint.scale.z=0;paint.updateWorldMatrix(true,false);
const raw=createWorldTriangles(paint),outer=createWorldTriangles(box),missing=stale.representatives.filter((p:any)=>!raw.triangles.some((t:any)=>t.triangleIndex===p.triangleIndex));
assert.deepEqual(missing,[{triangleIndex:0,vertexIndex:0}]);assert.equal(raw.skippedDegenerate,1);
assert.throws(()=>containedComponents(raw,outer,stale,topology.get(box.name)),TypeError);
const snap=fixture.snap(paint),result=containedComponents(snap,createWorldTriangles(box),topology.get(paint.name),topology.get(box.name));
assert.equal(result.length,1);assert.equal(result[0].contained,paint.name);assert.equal(result[0].sourceTriangleIndex,1);
assert.equal(topology.get(paint.name).closed,false);assert.equal(topology.get(paint.name).componentCount,1);
assert(fixture.topologyRefreshes.some(r=>r.missingPreviousRepresentatives.length===1));
for(const collapse of [false,true,false,true]){paint.scale.z=collapse?0:1;paint.updateWorldMatrix(true,false);const s=fixture.snap(paint);assert(topology.get(paint.name).representatives.every((r:any)=>s.triangles.some((t:any)=>t.triangleIndex===r.triangleIndex)));}
// Structural closure remains mandatory; deliberate removal of a test face is rejected.
const structural:any=fixture.scene.getObjectByName('Fuselage');assert(fixture.topology.get(structural.name).closed);structural.geometry=new T.BoxGeometry(1,1,1);structural.geometry.setIndex(Array.from(structural.geometry.index!.array).slice(0,-3));structural.scale.x*=.5;structural.updateWorldMatrix(true,false);assert.throws(()=>fixture.snap(structural),/lost current-snapshot closure/);
const pose={label:'actual current model representative round trip',wing:11/360,fold:[0,.25,.75,1],phase:[11*.07,0,0,0]},actual=await loadAudit(),states=[0,11/360,1,11/360,0],checks:any[]=[];
for(const wing of states){actual.pose({...pose,wing});for(const mesh of actual.meshes){const s=actual.snap(mesh),t=actual.topology.get(mesh.name);assert(t.representatives.every((r:any)=>s.triangles.some((triangle:any)=>triangle.triangleIndex===r.triangleIndex)));checks.push({wing,mesh:mesh.name,actualTriangles:s.triangles.length,components:t.componentCount,closed:t.closed});}}
const report={passed:true,runtimeSha256:actual.sha256,regressionFixture:{kind:'deterministic synthetic two-triangle open-surface cache test',singularTransformIsOnlyTestInput:true,sourceTriangles:2,remainingTriangle:1,missingOldRepresentatives:missing,oldErrorReproducedAndRejected:true,currentContainmentPerformed:true,structuralClosureLossRejected:true},actualCurrentModel:{meshCount:actual.meshes.length,orderedWingStates:states,checks},thresholdsUnchanged:{relativeDegeneracy:64*Number.EPSILON,weld:1e-12,materialBoundary:1e-8,SAT:1e-9},refreshes:actual.topologyRefreshes};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2));console.log({passed:true,currentMeshes:actual.meshes.length,actualChecks:checks.length});
