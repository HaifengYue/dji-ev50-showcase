/** Pure design/schema tests; no GLB, Blender, render or asset scan. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FULL_PAN_DOMAIN,FULL_PAN_LIMITS,fullPanStripFromDesign,resolveFullPanStrip} from './layered-domain-schema.mjs';
import {reviewLayeredContractValues} from './layered-contract-logic.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
export const syntheticFullPanDesign=()=>({panDomainBlender:clone(FULL_PAN_DOMAIN),nominalPanThickness:.010,nominalCruiseVerticalGap:.015,
  curveKnotsBlender:[{y:-1.9,absX:1.4},{y:-1.6,absX:1.3},{y:-1.4,absX:1.2},{y:-1.1,absX:1.5},{y:-.9,absX:1.55}],
  layerScanBlender:{xRange:[.64,1.9],yRange:[-1.8,-1.01],step:.01}});

export function runFullPanSchemaSelftests(){
 let checks=0;const test=fn=>{fn();checks++;},explicit=()=>{const d=syntheticFullPanDesign();d.layerScanBlender.wrapStrips=[fullPanStripFromDesign(d)];return d;};
 test(()=>{const d=syntheticFullPanDesign(),before=JSON.stringify(d),s=resolveFullPanStrip(d);assert.equal(s.id,'full-pan');assert.deepEqual(s.yRange,[-1.78,-1.05]);assert.equal(s.knots.length,5);assert(s.knots.every(p=>p.xInner===.653));assert.equal(JSON.stringify(d),before);});
 test(()=>{const d=explicit();assert.deepEqual(resolveFullPanStrip(d),d.layerScanBlender.wrapStrips[0]);});
 for(const mutate of [
  d=>d.panDomainBlender.y[0]= -1.7,d=>d.panDomainBlender.y[1]= -1.1,
  d=>d.panDomainBlender.innerAbsX=.7,d=>d.panDomainBlender.outerInsetFromCurve=.03,
  d=>d.nominalPanThickness=.012,d=>d.nominalCruiseVerticalGap=.02,
  d=>d.curveKnotsBlender.reverse(),d=>d.curveKnotsBlender.pop()
 ])test(()=>{const d=syntheticFullPanDesign();mutate(d);assert.throws(()=>resolveFullPanStrip(d));});
 for(const mutate of [
  s=>s.knots.forEach(p=>p.xInner=p.xOuter-.01),s=>s.knots.forEach(p=>p.xOuter=p.xInner+.01),
  s=>s.yRange[0]= -1.6,s=>s.yRange[1]= -1.1,s=>s.knots.splice(1,1),
  s=>s.knots[2].xOuter-=.01,s=>s.id='front',s=>s.maximumGap=.021,s=>s.minimumSkinThickness=.005,s=>s.maximumSkinThickness=.1
 ])test(()=>{const d=explicit();mutate(d.layerScanBlender.wrapStrips[0]);assert.throws(()=>resolveFullPanStrip(d));});
 test(()=>{const d=explicit();d.layerScanBlender.wrapStrips.push(clone(d.layerScanBlender.wrapStrips[0]));assert.throws(()=>resolveFullPanStrip(d));});
 test(()=>assert.throws(()=>resolveFullPanStrip(undefined,explicit().layerScanBlender)));
 const fixture=()=>{const d=syntheticFullPanDesign(),previous={mechanism:{rootClearance:.006,sliderTravel:[0,1],sides:{L:{},R:{}}},rootInterface:{axisHalfGap:.003},internalDrive:{stroke:[0,1],loweredLayout:{},layoutV22:{}},jointRefinements:{newCollisionExemptions:[]}},n={...clone(previous),version:24,layeredWingJoint:{design:clone(d)}},c={reviewed:true,removedNodes:[],addedNodes:[],parentChanges:[],animationTimelineChangeNodes:[]},s={reviewed:true,classification:[],decorations:[],incidentalContacts:[],poses:[],fixed:[],fits:[]},wing={reviewed:true,design:{...d,anchorInteriorWitnessRadius:.0445,lowerWrapWitnessesBlender:Array.from({length:8},(_,i)=>({x:.8+i*.02,y:-1.3,...FULL_PAN_LIMITS}))}};return {previous,n,c,s,prior:clone(s),wing};};
 test(()=>{const a=fixture();assert(reviewLayeredContractValues(a.previous,a.n,a.c,a.s,a.prior,a.wing).originalMaterialAreaThresholdsPreserved);});
 test(()=>{const a=fixture();a.wing.design.curveKnotsBlender[2].absX+=.02;assert.throws(()=>reviewLayeredContractValues(a.previous,a.n,a.c,a.s,a.prior,a.wing),/manifest curveKnotsBlender/);});
 return {passed:true,checks,noAssetScan:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(runFullPanSchemaSelftests());
