import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {verifyRepairSolidOrientation} from './repair-solid-orientation.mts';
import {verifiedReference} from '../current/reference-records.mjs';
import {createMicrofoldCorrectionContext,proveOriginalMicrofold,faceSha256,DIRECTION_MESHES,DIRECTION_REFERENCE_SHA256,MICROFOLD_RULES} from './oriented-microfold-corrections.mts';import * as T from 'three';
import {createWorldTriangles} from '../lib/triangle-contact.mjs';
import {certifyConvexPatches,verifyAdaptiveOutsidePatchCoverage} from './adaptive-patch-coverage.mts';
import {measureUndersideContinuity,classifyProfileMaterial} from './underside-continuity.mts';
import {verifyFixedSurfaceTranslation,verifyCompleteSurfacePreservation,verifyOrientedFullSurfaceCoverage} from './fixed-wing-surface-translation.mts';
import {inFiniteBoreNeighborhood,verifyAxisTranslation,verifyTranslatedMaterialSection,verifyTranslatedSection,verifyNaturalBottom,inProjectedBoreFootprint,saddleLiftAtWorld,boreMaterialException,recoveredBoreMaterial,verifyJoinContinuity,NATURAL_FIT_LIMIT} from './wing-shape-logic.mts';
assert(verifyTranslatedSection([.10,0],[.125,.025],.025,1e-6).passed);
assert(!verifyTranslatedSection([.10,0],[.125,0],.025,1e-6).passed,'lifting only top skin must fail');
assert(!verifyTranslatedSection([.10,0],[.13,.025],.025,1e-6).passed,'thickening must fail');
assert(!verifyTranslatedSection([.10,0],[.10,0],.025,1e-6).passed,'normal-only cosmetic alteration must fail');
assert(!verifyTranslatedSection([.10,0],[.125,.08,.07,.025],.025,1e-6).passed,'hidden interval cannot count as one material wall');
assert(verifyNaturalBottom([.10,0],[.01001,.00001],.00001,1e-6).passed);
assert(!verifyNaturalBottom([.10,0],[-.01499,-.02499],.00001,1e-6).passed,'old depression must fail despite any normal choice');
assert(!verifyNaturalBottom([.10,.02],[.01001,.00001],.00001,1e-6).passed,'flat plate replacing curved underside must fail');
assert(!verifyNaturalBottom([.10,0],[.0100111,.0000111],.00001,1e-6).passed,'construction inset must not relax source encoding tolerance');
assert(!verifyNaturalBottom([.10,0],[.010071,.000071],.00001,6e-5).passed,'runtime encoding tolerance not relaxed');
assert(inProjectedBoreFootprint(0,0,[0,0,0],[1,1,0],.045));
assert(!inProjectedBoreFootprint(2,0,[0,0,0],[1,1,0],.045),'finite bore must not exclude infinite axis');
assert.equal(saddleLiftAtWorld([.62,-.2,1.2]),.029);
for(const p of [[0,-.2,1.2],[.6,-.2,0],[.6,.03,1.2],[.6,-.2,2]])assert.equal(saddleLiftAtWorld(p),0,'outside reviewed C1 deformation support must stay fixed');
function extrudedSection(outline:number[][]){
 const n=outline.length,pts=[...outline.map(p=>[p[0],p[1],.9]),...outline.map(p=>[p[0],p[1],1.9])],faces:number[][]=[];
 const cap=T.ShapeUtils.triangulateShape(outline.map(p=>new T.Vector2(...p)),[]);
 for(const t of cap){faces.push(t,[t[0]+n,t[2]+n,t[1]+n]);}
 for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,i+n,j+n],[i,j+n,j]);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float64Array(pts.flat()),3));g.setIndex(faces.flat());const mesh=new T.Mesh(g);mesh.updateMatrixWorld();return createWorldTriangles(mesh);
}
const noBoreStart=[8,8,8],noBoreEnd=[9,9,9];
const flat=measureUndersideContinuity(extrudedSection([[.5,0],[2,0],[2,-.2],[.5,-.2]]),noBoreStart,noBoreEnd,1e-6);
assert.equal(flat.unexpectedBoundaryCount,0,'Continuous real planar underside has no internal step walls');assert.equal(flat.maximumAngleDegrees,0);
const stepped=measureUndersideContinuity(extrudedSection([[.5,0],[2,0],[2,-.2],[1,-.2],[1,-.225],[.5,-.225]]),noBoreStart,noBoreEnd,1e-6);
assert(stepped.unexpectedBoundaryCount>=2,'Closed stepped underside must expose its vertical wall despite any shader normals');
assert(Math.abs(stepped.criticalEdgeProfiles.maximumExtrapolatedStep-.025)<1e-12,'Finite cross-edge geometry must measure the actual .025 step');
const creased=measureUndersideContinuity(extrudedSection([[.5,0],[2,0],[2,-.2],[1,-.4],[.5,-.2]]),noBoreStart,noBoreEnd,1e-6);
assert(creased.criticalEdgeProfiles.maximumTangentMismatchDegrees>30,'A continuous but sharply creased underside must fail smooth-tangent evidence');

const snap=(triangles:number[][][])=>({sourceTriangleCount:triangles.length,skippedDegenerate:0,triangles:triangles.map((vertices,triangleIndex)=>({vertices,triangleIndex}))});
const squarePatch=[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],squareTargets=snap([[[0,0,0],[1,0,0],[0,0,1]],[[1,0,0],[1,0,1],[0,0,1]]]);
assert(certifyConvexPatches([squarePatch],squareTargets).passed,'True complete coplanar cover remains certifiable');
const islandTargets=snap([[[0,0,0],[.001,0,0],[0,0,.001]],[[1,0,0],[.999,0,0],[1,0,.001]],[[0,0,1],[.001,0,1],[0,0,.999]]]);
assert(!certifyConvexPatches([[[0,0,0],[1,0,0],[0,0,1]]],islandTargets,{maximumDepth:24}).passed,'Vertices on distinct tiny target islands do not establish whole-area coverage');
const lo=.5-2e-6,hi=.5+2e-6,narrowHole=snap([[[0,0,0],[lo,0,0],[lo,0,1]],[[0,0,0],[lo,0,1],[0,0,1]],[[hi,0,0],[1,0,0],[1,0,1]],[[hi,0,0],[1,0,1],[hi,0,1]]]);
assert(!certifyConvexPatches([squarePatch],narrowHole,{maximumDepth:32,maximumPieces:50000}).passed,'A narrow unfilled strip over 1e-6 must not vanish by area or vertex-only sampling');
assert(!certifyConvexPatches([squarePatch],squareTargets,{maximumDepth:0}).passed,'Unproved depth-limited cover fails closed');
assert(!certifyConvexPatches([[[.4,0,.4],[.6,0,.4],[.4,0,.6]]],snap([])).passed,'Missing entire small patch cannot be accepted');
assert.throws(()=>certifyConvexPatches([squarePatch],squareTargets,{epsilon:1.01e-6}));
const originalAxisStart=[1.5894893407821655,-.30948927998542786,1.380510687828064],originalAxisEnd=[1.4105106592178345,-.13051071763038635,1.559489369392395];
assert(boreMaterialException([-.17106193827999397,-.26893807346691856],1.37,1.58,originalAxisStart,originalAxisEnd,1e-6).excluded,'Actual finite cutter beyond short marker endpoints must be evidenced');
assert(!boreMaterialException([-.17,-.27],.70,1.58,originalAxisStart,originalAxisEnd,1e-6).excluded,'Unrelated wing material cannot inherit a bore exception');

assert(verifyNaturalBottom([.1,0],[.010089,.000089],.00001,1e-6,NATURAL_FIT_LIMIT).passed,'Explicit separately reviewed fit residual admits only its own geometric allowance');
assert(!verifyNaturalBottom([.1,0],[.010091,.000091],.00001,6e-5,NATURAL_FIT_LIMIT).passed,'Encoding tolerance is not added to or used to enlarge the fixed 8e-5 design fit limit');
assert(recoveredBoreMaterial([],[-.14226095252509421,-.16063515004357012],1.5,1.48,originalAxisStart,originalAxisEnd,1e-6).excluded,'Each inverse-translated new material endpoint is inside the frozen old finite inscribed bore');
assert(!recoveredBoreMaterial([],[-.1,-.9],1.5,1.48,originalAxisStart,originalAxisEnd,1e-6).excluded,'An empty old ray cannot authorize arbitrary new material outside the old bore volume');
const realRegression=JSON.parse(fs.readFileSync('qa/nacelle/wing-shape-regressions.json','utf8'));
assert.equal(realRegression.sourceSha256,'1a67145c90a2b9b5ed55106d66ba21db7182bcfaa68cb84029c8e99b79eb1a3e');
assert.equal(realRegression.runtimeSha256,'48896bc2356067db9faa7bbb993cced3c3248de6a42b324ff31a583ff1255e89');
for(const [i,r]of realRegression.cases.entries()){
 assert(Math.abs(r.zone.maximumExtrapolatedStep-[.0002910866147572966,.0009368541923442941][i])<1e-15,'Previously rejected geometry must remain a fixed measured counterexample');
 assert(!verifyJoinContinuity(r.zone,[]).passed,'Both real old left and right interior join defects must be rejected');
 assert(classifyProfileMaterial(r.zone.worstByStep[0].samples,1e-6).requiresInteriorJoinGate,'The complete real rejected hits must remain inside the hard gate after material classification');
 const p=r.zone.worstByStep[0],v=p.samples.map((p:any)=>p.bottom),step=Math.abs((2*v[1]-v[0])-(2*v[2]-v[3]));assert(Math.abs(step-r.zone.maximumExtrapolatedStep)<1e-12,'Counterexample must agree with its actual saved cross-edge triangle-section hits');
}

const fourSamples=(hits:number[])=>Array.from({length:4},(_,i)=>({x:i*.002,z:0,hits,bottom:hits.at(-1)}));
assert(classifyProfileMaterial(fourSamples([-.2,-.21]),1e-6,()=>[-.1,-.21]).requiresInteriorJoinGate,'Thin-to-thin pan profiles cannot be exempted even when an old bulk bottom coincides');
const originalBulk=classifyProfileMaterial(fourSamples([-.1,-.2]),1e-6,()=>[-.1,-.2,-.21,-.22]);
assert(originalBulk.unchangedOriginalBulk&&originalBulk.nativeBulkCorrespondence.every(p=>p.matchingOldBulkIntervals[0].index===0),'Original upper bulk interval is matched explicitly, never the lower old thin pan');
assert(classifyProfileMaterial(fourSamples([-.1,-.2]),1e-6,()=>[-.19,-.2]).requiresInteriorJoinGate,'A same-height old thin pan is not original thick-wing evidence');
assert(classifyProfileMaterial(fourSamples([-.1,-.2]),1e-6,()=>[-.1,-.2,-.1,-.2]).requiresInteriorJoinGate,'Ambiguous duplicate bulk correspondences remain unproved');

const restored=classifyProfileMaterial(fourSamples([-.1,-.3]),1e-6,()=>[-.1,-.34],()=>-.2);
assert(restored.restoredOriginalSymmetricBulk&&!restored.unchangedOriginalBulk&&!restored.requiresInteriorJoinGate,'Restored native airfoil must be proven from old actual upper plus frozen center, never labeled unchanged old bottom');
assert(classifyProfileMaterial(fourSamples([-.1,-.299998]),1e-6,()=>[-.1,-.34],()=>-.2).requiresInteriorJoinGate,'Symmetry residual above original source tolerance cannot be excused as native shape');
assert(classifyProfileMaterial(fourSamples([-.1,-.11]),1e-6,()=>[-.1,-.34],()=>-.105).requiresInteriorJoinGate,'Perfect symmetry still cannot exempt thin-to-thin pan material');
assert(classifyProfileMaterial(fourSamples([-.1,-.3]),1e-6,()=>[-.1,-.34,-.1,-.34],()=>-.2).requiresInteriorJoinGate,'Ambiguous old actual upper provenance must remain unproved');
assert(!verifyJoinContinuity({edgeCount:100,criticalProfileCount:100,maximumExtrapolatedStep:0,maximumTangentMismatchDegrees:0},[],undefined,[{mid:[0,0,0],adjacentTriangles:1}]).passed,'Bad lower-envelope adjacency must fail closed rather than silently skip a critical edge');
const shifted=(p:number[])=>p.map((v,i)=>v+(i===1?.029:0));
assert(verifyAxisTranslation(originalAxisStart,originalAxisEnd,shifted(originalAxisStart),shifted(originalAxisEnd),1e-6).passed,'Reviewed shaft/wing equal vertical shift accepted');
assert(!verifyAxisTranslation(originalAxisStart,originalAxisEnd,originalAxisStart,originalAxisEnd,1e-6).passed,'Old unchanged shaft height must fail the new design');
assert(!verifyAxisTranslation(originalAxisStart,originalAxisEnd,originalAxisStart.map((v,i)=>v+(i===1?.010:0)),originalAxisEnd.map((v,i)=>v+(i===1?.010:0)),6e-5).passed,'Insufficient .010 proposal cannot pass .029 shaft target');
assert(!verifyAxisTranslation(originalAxisStart,originalAxisEnd,shifted(originalAxisStart).map((v,i)=>v+(i===0?.0001:0)),shifted(originalAxisEnd).map((v,i)=>v+(i===0?.0001:0)),6e-5).passed,'Unapproved spanwise shift must fail');
assert(!verifyAxisTranslation(originalAxisStart,originalAxisEnd,shifted(originalAxisStart),shifted(originalAxisEnd).map((v,i)=>v+(i===2?.0001:0)),6e-5).passed,'Shaft tilt/separation change must fail');
assert(!verifyAxisTranslation(originalAxisStart,originalAxisEnd,shifted(originalAxisStart).map((v,i)=>v-(i===1?.058:0)),shifted(originalAxisEnd).map((v,i)=>v-(i===1?.058:0)),1e-6).passed,'Wrong-sign axis height must fail');
assert(verifyTranslatedMaterialSection([.2,.15,.05,0],[.229,.179,.079,.029],1e-6).passed,'Every actual bore-separated material interval translates exactly');
assert(verifyTranslatedMaterialSection([],[],1e-6).passed,'Empty fixed rays stay explicitly empty without material claims');
assert(!verifyTranslatedMaterialSection([],[.1,0],1e-6).passed,'New matter on an original empty fixed ray is no longer a bore exception');
assert(!verifyTranslatedMaterialSection([.2,.15,.05,0],[.229,.179,.079,.030],1e-6).passed,'Small lower skin thickness change is rejected');
assert(!verifyTranslatedMaterialSection([.2,.15,.05,0],[.229,.150,.050,.029],1e-6).passed,'Unmoved bore walls cannot pass translated external skins');
assert(!verifyTranslatedMaterialSection([.2,.15,.05,0],[.229,.029],1e-6).passed,'Filling the bore cannot pass all-interval comparison');
const completeSurfaceRef={sourceTriangleCount:2,skippedDegenerate:0,positions:[[0,0,0],[1,0,0],[0,0,1],[.4,0,.4],[.4,.1,.4],[.5,0,.4]],indices:[[0,1,2],[3,4,5]]};
const completeShift=snap(completeSurfaceRef.indices.map(t=>t.map(i=>shifted(completeSurfaceRef.positions[i]))));
assert(verifyFixedSurfaceTranslation(completeSurfaceRef,completeShift,2).passed,'Both outer skin and a true interior bore-wall patch translate completely');
const wrongBore=snap(completeSurfaceRef.indices.map((t,k)=>t.map(i=>k===1?completeSurfaceRef.positions[i]:shifted(completeSurfaceRef.positions[i]))));
assert(!verifyFixedSurfaceTranslation(completeSurfaceRef,wrongBore,2).passed,'Whole-surface comparison may not exempt an unmoved interior bore wall');
assert(verifyNaturalBottom([.2,.15,.1,0],[.01001,.00001],.00001,1e-6).passed,'Proven old fixed bore interruption does not mask the actual natural lowest skin');
assert(!verifyNaturalBottom([.2,.15,.1,0],[.1,.09,.01001,.00001],.00001,1e-6).passed,'New moving multiple intervals remain forbidden even where old fixed has a bore');
const flippedSurface=snap(completeSurfaceRef.indices.map(t=>t.slice().reverse().map(i=>shifted(completeSurfaceRef.positions[i]))));
const flippedResult=verifyFixedSurfaceTranslation(completeSurfaceRef,flippedSurface,2);
assert(flippedResult.fullSurfaceCoverage.passed,'The reversed-face negative case has identical complete unoriented geometry');
assert(!flippedResult.passed&&!flippedResult.orientedFullSurfaceCoverage.passed,'Identical surface coordinates with reversed winding must fail the independent oriented certificate');
assert.throws(()=>verifyFixedSurfaceTranslation(completeSurfaceRef,{...completeShift,skippedDegenerate:1},2),'A snapshot that filtered any actual triangle cannot certify complete coverage');
assert.throws(()=>verifyFixedSurfaceTranslation(completeSurfaceRef,completeShift,3),'Independent raw index count cannot exceed the coverage snapshot');
const zeroAreaRef={sourceTriangleCount:1,skippedDegenerate:0,positions:[[0,0,0],[1,0,0],[2,0,0]],indices:[[0,1,2]]};
assert.throws(()=>verifyFixedSurfaceTranslation(zeroAreaRef,snap([zeroAreaRef.positions.map(shifted)]),1),'Disabling relative filtering still rejects a truly zero-area raw face');
assert(inFiniteBoreNeighborhood([0,.02,0],[-.1,0,0],[.1,0,0],.045),'Actual3D near-hole point remains a diagnostic bore boundary');
assert(!inFiniteBoreNeighborhood([0,.2,0],[-.1,0,0],[.1,0,0],.045),'Identical horizontal projection far below or above the real bore may not mask natural underside edges');
assert(!inFiniteBoreNeighborhood([1.2,0,0],[-.1,0,0],[.1,0,0],.045),'Infinite-axis extension outside the actual finite bore cannot mask an edge');
const unchangedRepairTarget=snap(completeSurfaceRef.indices.map(t=>t.map(i=>completeSurfaceRef.positions[i])));
assert(verifyCompleteSurfacePreservation(completeSurfaceRef,unchangedRepairTarget,2).passed,'Local repair reference requires complete zero-translation preservation');
assert(!verifyCompleteSurfacePreservation(completeSurfaceRef,completeShift,2).passed,'A repair may not inherit the separate fixed-wing translation allowance');
const directionEvidence=verifiedReference('nacelle-oriented-repair-corrections-v2.json'),directionRef=verifiedReference('nacelle-pre-repair-wing-reference.json'),directionMesh=directionRef.data.meshes.find((m:any)=>m.name==='Fixed_root_L');
const directionSnapshot=snap(directionMesh.indices.map((t:number[])=>t.map(i=>directionMesh.positions[i]))),testPermission={reviewed:true,evidenceSha256:directionEvidence.sha256,direction:'beforeToAfter',meshNames:DIRECTION_MESHES,rules:MICROFOLD_RULES},context=createMicrofoldCorrectionContext(directionEvidence,testPermission,'Fixed_root_L',directionRef.sha256);context.validateBeforeSnapshot(directionSnapshot);
const firstEntry=directionEvidence.data.entries.find((e:any)=>e.referenceSha256===directionRef.sha256&&e.meshName==='Fixed_root_L'),permittedFace=directionSnapshot.triangles.find((t:any)=>faceSha256(t.vertices)===firstEntry.faceSha256)!,neighborFace=directionSnapshot.triangles.find((t:any)=>faceSha256(t.vertices)===firstEntry.neighborFaceSha256)!;
const thinFold=[[0,0,0],[1,0,0],[.5,0,1e-8]],opposedNeighbor=[[1,0,0],[0,0,0],[.5,0,1]],ordinaryNeighbor=[[0,0,0],[1,0,0],[.5,0,1]],temporary=fs.mkdtempSync(path.join(os.tmpdir(),'transwing-direction-selftest-'));let mutationCount=0;
const tampered=(change:(data:any)=>void)=>{const data=JSON.parse(JSON.stringify(directionEvidence.data));change(data);const bytes=JSON.stringify(data),file=path.join(temporary,String(mutationCount++)+'.json');fs.writeFileSync(file,bytes);const record={path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};return createMicrofoldCorrectionContext(record,{...testPermission,evidenceSha256:record.sha256},'Fixed_root_L',directionRef.sha256);};
const mutateEntry=(data:any)=>data.entries.find((e:any)=>e.referenceSha256===directionRef.sha256&&e.meshName==='Fixed_root_L');
const tetraPoints=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetraFaces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],tetra=tetraFaces.map(t=>t.map(i=>tetraPoints[i]));
const directionCases=[
 ['true original shared-edge microfold',()=>assert(proveOriginalMicrofold(thinFold,opposedNeighbor).passed)],
 ['thin ordinary surface is not a defect',()=>assert(!proveOriginalMicrofold(thinFold,ordinaryNeighbor).passed)],
 ['near opposite face without shared edge is not a defect',()=>assert(!proveOriginalMicrofold(thinFold,opposedNeighbor.map(p=>p.map((v,i)=>v+(i===0?1e-9:0)))).passed)],
 ['root repair domain cannot expand',()=>assert(!proveOriginalMicrofold(thinFold.map(p=>p.map((v,i)=>v+(i===0?2:0))),opposedNeighbor.map(p=>p.map((v,i)=>v+(i===0?2:0)))).passed)],
 ['microfold altitude cannot expand',()=>assert(!proveOriginalMicrofold([[0,0,0],[1,0,0],[.5,0,2e-7]],opposedNeighbor).passed)],
 ['zero-area face is never exempted',()=>assert.throws(()=>proveOriginalMicrofold([[0,0,0],[1,0,0],[2,0,0]],opposedNeighbor))],
 ['listed original directed identity is available only after all predicates',()=>assert(context.permissionFor('beforeToAfter',permittedFace))],
 ['unlisted source face stays strict',()=>assert.equal(context.permissionFor('beforeToAfter',directionSnapshot.triangles[0]),null)],
 ['current-to-original never reuses source permission',()=>assert.equal(context.permissionFor('afterToBefore',permittedFace),null)],
 ['reversed original identity is not listed',()=>assert.equal(context.permissionFor('beforeToAfter',{...permittedFace,vertices:permittedFace.vertices.slice().reverse()}),null)],
 ['wrong reference cannot inherit a correction',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,testPermission,'Fixed_root_L','0'.repeat(64)))],
 ['attachments cannot inherit wing corrections',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,testPermission,'Landing_wear_tip_L',directionRef.sha256))],
 ['authorization rules cannot expand',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,{...testPermission,rules:{...MICROFOLD_RULES,maximumAltitude:2e-7}},'Fixed_root_L',directionRef.sha256))],
 ['evidence digest must bind permission',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,{...testPermission,evidenceSha256:'0'.repeat(64)},'Fixed_root_L',directionRef.sha256))],
 ['missing original identity fails closed',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,testPermission,'Fixed_root_L',directionRef.sha256).validateBeforeSnapshot({...directionSnapshot,triangles:directionSnapshot.triangles.filter((t:any)=>t!==permittedFace)}))],
 ['missing real shared neighbor fails closed',()=>assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,testPermission,'Fixed_root_L',directionRef.sha256).validateBeforeSnapshot({...directionSnapshot,triangles:directionSnapshot.triangles.filter((t:any)=>t!==neighborFace)}))],
 ['missing construction trace fails closed',()=>assert.throws(()=>tampered(data=>{mutateEntry(data).provenance=null;}).validateBeforeSnapshot(directionSnapshot))],
 ['original area cannot be falsified',()=>assert.throws(()=>tampered(data=>{mutateEntry(data).area*=2;}).validateBeforeSnapshot(directionSnapshot))],
 ['link cause must directly include the removed original face point',()=>assert.throws(()=>tampered(data=>{mutateEntry(data).provenance.removed=directionMesh.positions.find((p:number[])=>!permittedFace.vertices.some((q:number[])=>p.every((v,i)=>v===q[i])));}).validateBeforeSnapshot(directionSnapshot))],
 ['fabricated link edge cannot rely only on a trace triangle',()=>assert.throws(()=>tampered(data=>{const p=mutateEntry(data).provenance,edges=new Set(directionMesh.indices.flatMap((t:number[])=>[0,1,2].map(i=>[directionMesh.positions[t[i]].join(','),directionMesh.positions[t[(i+1)%3]].join(',')].sort().join('|'))));p.retained=directionMesh.positions.find((v:number[])=>!edges.has([p.removed.join(','),v.join(',')].sort().join('|')));p.linkEdgeBeforeTriangle=[p.removed,p.retained,p.beforeTriangle[0]];}).validateBeforeSnapshot(directionSnapshot))],
 ['closed outward tetrahedron has exact positive volume',()=>assert(verifyRepairSolidOrientation(snap(tetra)).passed)],
 ['reversed whole solid has negative exact volume',()=>assert(!verifyRepairSolidOrientation(snap(tetra.map(t=>t.slice().reverse()))).passed)],
 ['one flipped face violates actual shared-edge winding',()=>assert(!verifyRepairSolidOrientation(snap(tetra.map((t,i)=>i===0?t.slice().reverse():t))).passed)],
 ['open material cannot claim outward closure',()=>assert(!verifyRepairSolidOrientation(snap(tetra.slice(1))).passed)],
 ['disconnected positive solids fail the single-body requirement',()=>assert(!verifyRepairSolidOrientation(snap([...tetra,...tetra.map(t=>t.map(p=>p.map((v,i)=>v+(i===0?2:0))))])).passed)],
 ['point-connected shells fail exact one-cycle vertex links',()=>assert(!verifyRepairSolidOrientation(snap([...tetra,...tetra.map(t=>t.map(p=>p.map(v=>-v))).map(t=>t.slice().reverse())])).passed)],
 ['true zero-area indexed face is not omitted from orientation',()=>assert(!verifyRepairSolidOrientation(snap([...tetra,[[2,0,0],[3,0,0],[4,0,0]]])).passed)],
 ['forged optional context cannot weaken generic helper',()=>assert.throws(()=>verifyCompleteSurfacePreservation(completeSurfaceRef,unchangedRepairTarget,2,[0,0,0],{}))],
 ['permission cannot cross the source coordinate frame',()=>assert.throws(()=>verifyCompleteSurfacePreservation(completeSurfaceRef,completeShift,2,[0,.029,0],context))],
 ['unreviewed permission cannot run as formal',()=>{const prior=process.env.QA_PREFLIGHT;delete process.env.QA_PREFLIGHT;try{assert.throws(()=>createMicrofoldCorrectionContext(directionEvidence,{...testPermission,reviewed:false},'Fixed_root_L',directionRef.sha256));}finally{if(prior!==undefined)process.env.QA_PREFLIGHT=prior;}}],
] as const;
const microWallBytes=fs.readFileSync('qa/nacelle/oriented-microfold-regressions.json'),microWallSha256=crypto.createHash('sha256').update(microWallBytes).digest('hex');assert.equal(microWallSha256,'c76bf9fadd9071d2241fb4c35256dbc43104a6f9b6d7c453f6bc5eb5dd3fec93');const microWalls=JSON.parse(microWallBytes.toString());assert.equal(microWalls.candidateSourceSha256,'c771baebcc19cfbcabd55e638a85fe96dec13ee08f65758dcffa8ae3f687d96e');assert.equal(microWalls.referenceSha256,DIRECTION_REFERENCE_SHA256.preRepair);
const actualWallCases=microWalls.cases.map((c:any)=>['actual rejected new micro-wall '+c.mesh,()=>{const before={triangles:c.targetTriangles},after=snap([c.vertices]),domain={minimumAbsX:10,maximumAbsX:11,longitudinalY:[10,11],verticalZ:[10,11]},distance=verifyAdaptiveOutsidePatchCoverage(before,after,domain),orientation=verifyOrientedFullSurfaceCoverage(before,after,domain);assert(distance.rows.find((r:any)=>r.direction==='afterToBefore').passed,'Every point of the actual new micro-wall remains within original1e-6 geometric coverage');assert(!orientation.directions.find((r:any)=>r.direction==='afterToBefore').passed,'Its real current-to-original orientation must still fail, however small its area');}] as const),allDirectionCases=[...directionCases,...actualWallCases];
try{for(const [,run]of allDirectionCases)run();}finally{fs.rmSync(temporary,{recursive:true,force:true});}
const report={passed:true,cases:79+allDirectionCases.length,originalDirectionCorrectionCases:allDirectionCases.map(([name])=>name),actualRejectedMicroWallFixtureSha256:microWallSha256,sourceEncodingTolerance:1e-6,runtimeEncodingTolerance:6e-5,usesNormals:false};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2)+'\n');console.log(report);
