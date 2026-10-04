/** Actual layered skins, displaced shared hinge and inset rod seat, source and decoded runtime. */
import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';
import {loadAudit} from './audit-scene.mts';import {lineSection,verifyLowerWrap,scanLayerGrid,verifySeatMarginFootprint,SEAT_MARGIN_RULES} from './layered-sections.mts';
import {verifiedReference} from './reference-records.mjs';
import {surfaceDistance} from '../lib/solid-contact.mjs';
const c=JSON.parse(fs.readFileSync('qa/contracts/layered-wing-refinement.json','utf8'));assert(c.reviewed);const d=c.design;
assert(d.lowerWrapWitnessesBlender.length>=8,'At least eight independent interior wrap witnesses required');
const previous=verifiedReference('previous-accepted-reference.json'),old=previous.data.models.find(m=>m.encoding==='source'),reports=[];
const gltf=(p:number[])=>new T.Vector3(p[0],p[2],-p[1]);
for(const [kind,source]of [['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']]){
 const a=await loadAudit(source);assert.equal(a.sha256,c[kind+'Sha256']);a.pose({wing:1,fold:[1,1,1,1],label:'actual cruise layered-skin sections'});
 const rows=[],failures=[];const encoding=kind==='source'?1e-6:6e-5;
 for(const[side,sign]of [['L',-1],['R',1]] as const){
  const get=(name:string)=>{const o=a.scene.getObjectByName(name);assert(o,'Missing actual node '+name);return o;};
  const pivot=get('WingPivot_'+side),actualPivot=pivot.getWorldPosition(new T.Vector3()),expectedPivot=gltf(d.rightPivotBlender.map((v:number,i:number)=>i===0?v*sign:v)),actualAnchor=get('BraceWing_'+side).getWorldPosition(new T.Vector3()),expectedAnchor=gltf(d.rightAnchorCruiseBlender.map((v:number,i:number)=>i===0?v*sign:v));
  const oldPivot=new T.Vector3(...old.nodes.find(n=>n.name==='WingPivot_'+side).position),oldAnchor=oldPivot.clone().add(new T.Vector3(...previous.data.manifest.mechanism.sides[side].wingAnchorLocal));
  if(actualPivot.distanceTo(expectedPivot)>encoding)failures.push({side,reason:'actual hinge center misses reviewed new placement',actual:actualPivot.toArray(),expected:expectedPivot.toArray()});
  if(actualAnchor.distanceTo(expectedAnchor)>encoding)failures.push({side,reason:'actual rod ball misses reviewed new placement',actual:actualAnchor.toArray(),expected:expectedAnchor.toArray()});
  if(!(Math.abs(actualPivot.x)>Math.abs(oldPivot.x)&&actualPivot.z>oldPivot.z))failures.push({side,reason:'hinge did not move outboard and forward as the reviewed annotation mapping requires'});
  if(!(actualAnchor.z>oldAnchor.z))failures.push({side,reason:'rod attachment did not move forward into wing'});
  const start=get('RootAxisStart_'+side).getWorldPosition(new T.Vector3()),end=get('RootAxisEnd_'+side).getWorldPosition(new T.Vector3()),axis=end.clone().sub(start).normalize();
  const centers=['RootAxisStart_','RootAxisEnd_','RootBearingCenter_'].flatMap(p=>p==='RootBearingCenter_'?[p+side+'_Front',p+side+'_Rear']:[p+side]);
  const coaxis=centers.map(name=>({name,deviation:get(name).getWorldPosition(new T.Vector3()).sub(actualPivot).cross(axis).length()}));if(coaxis.some(r=>r.deviation>1e-6))failures.push({side,reason:'physical marker/bearing centers are not on the relocated shared hinge axis',coaxis});
  const fixed=get('Fixed_root_'+side),moving=get('Composite_wing_'+side);assert([fixed,moving].every(mesh=>a.topology.get(mesh.name).closed&&a.topology.get(mesh.name).componentCount===1),'Layer pairing requires each actual main wing skin to be closed and single-connected');const fsnap=a.snap(fixed),msnap=a.snap(moving);
  const sections=d.lowerWrapWitnessesBlender.map((p:any)=>{const ray=[p.x*sign,2,-p.y],r=verifyLowerWrap(lineSection(fsnap,ray,[0,-1,0]),lineSection(msnap,ray,[0,-1,0]),p);if(!r.passed)failures.push({side,reason:'lower wrap/upper relief section failed',sample:p,result:r});
   const nearestActualSurfaces=r.passed?{fixedUndersideToMoving:surfaceDistance(r.fixed.intervals[0].exit.point,msnap),movingInnerSkinToFixed:surfaceDistance(r.moving.intervals[0].entry.point,fsnap)}:null;
   if(nearestActualSurfaces&&Object.values(nearestActualSurfaces).some((x:any)=>!Number.isFinite(x.distance)||x.distance<=1e-9))failures.push({side,reason:'paired actual skin witness has no finite surface clearance',sample:p,nearestActualSurfaces});
   return {sample:p,...r,nearestActualSurfaces,gapDirection:'vertical section; nearest actual all-face distances reported separately, not claimed as a global minimum'};});
  const actualBore={axisStart:start.toArray(),axisEnd:end.toArray(),radius:.045,polygonSides:64,encodingTolerance:encoding,axisMarkers:['RootAxisStart_'+side,'RootAxisEnd_'+side]};
  const layerGrid=scanLayerGrid(fsnap,msnap,d.layerScanBlender,sign,actualBore,d);if(!layerGrid.passed)failures.push({side,reason:'complete finite lower-pan scan found reversed layers, material overlap, unproven openings, unresolved sections or absent lower wrap',layerGrid});
  const seatFootprint=verifySeatMarginFootprint(fsnap,msnap,actualAnchor.toArray(),d.anchorInteriorWitnessRadius,actualPivot.y);for(const witness of seatFootprint)if(!witness.passed)failures.push({side,reason:'seat circumference lacks continuous upper-band material, bounded optional lower material or fixed-skin separation',witness});
  rows.push({side,actualPivot:actualPivot.toArray(),previousPivot:oldPivot.toArray(),actualAnchor:actualAnchor.toArray(),previousAnchor:oldAnchor.toArray(),coaxis,sections,layerGrid,seatFootprint});
 }
 reports.push({passed:failures.length===0,source,sha256:a.sha256,kind,rows,failures});
}
const r={passed:reports.every(r=>r.passed),reports,seatMarginRules:SEAT_MARGIN_RULES,method:'Independent exact decoded triangles and real node transforms; mandatory pan remains one complete lower interval below fixed material; seat circumference separately requires an interior shared-wing-midplane material band and permits one bounded lower-pan interval',limitations:['Finite section witnesses establish sampled layer thickness and clearance only; fullstroke SAT/solid containment and support are separate mandatory gates','Seat circumference evidence covers 32 actual rays, not a complete disk; vertical material spans are not uniform normal wall thickness or certified inter-interval gaps','Concept model coordinates are not measured manufacturing tolerances; no structural or aerodynamic certification']};fs.writeFileSync(process.env.QA_OUT??'qa/current/layered-geometry-report.json',JSON.stringify(r,null,2)+'\n');console.log({passed:r.passed,failures:reports.flatMap(r=>r.failures)});if(!r.passed)process.exitCode=1;
