/** Independent actual-triangle line sections. A missing/open section never counts as clearance. */
import * as T from 'three';
import assert from 'node:assert/strict';
import {resolveFullPanStrip} from './layered-domain-schema.mjs';
export function lineSection(snapshot:any,origin:number[],direction:number[]){
 const o=new T.Vector3(...origin),d=new T.Vector3(...direction).normalize(),ray=new T.Ray(o,d),hits:any[]=[];
 for(const tri of snapshot.triangles){const [a,b,c]=tri.vertices.map((p:number[])=>new T.Vector3(...p));const p=ray.intersectTriangle(a,b,c,false,new T.Vector3());if(p)hits.push({t:p.clone().sub(o).dot(d),point:p.toArray(),triangleIndex:tri.triangleIndex});}
 hits.sort((a,b)=>a.t-b.t);const unique=hits.filter((h,i)=>i===0||Math.abs(h.t-hits[i-1].t)>1e-9),resolved=unique.length>0&&unique.length%2===0;
 const intervals=resolved?Array.from({length:unique.length/2},(_,i)=>({start:unique[2*i].t,end:unique[2*i+1].t,thickness:unique[2*i+1].t-unique[2*i].t,entry:unique[2*i],exit:unique[2*i+1]})):[];
 return {resolved,hitCount:unique.length,hits:unique,intervals,method:'actual triangle intersections, duplicate-face hits merged only at SAT epsilon 1e-9'};
}
export function verifyLowerWrap(fixed:any,moving:any,{minimumGap,minimumSkinThickness,maximumGap,maximumSkinThickness}:any){
 assert([minimumGap,maximumGap,minimumSkinThickness,maximumSkinThickness].every(Number.isFinite));assert(minimumGap>0&&minimumSkinThickness>0&&maximumGap>=minimumGap&&maximumSkinThickness>=minimumSkinThickness,'Finite positive material and gap bounds required');
 const failures:string[]=[];
 if(!fixed.resolved||!moving.resolved)failures.push('missing or odd/open material section');
 if(fixed.intervals.length!==1||moving.intervals.length!==1)failures.push('expected exactly one closed material interval per skin; disconnected islands are not accepted');
 let gap:number|null=null,thickness:number|null=null;
 if(!failures.length){gap=moving.intervals[0].start-fixed.intervals[0].end;thickness=moving.intervals[0].thickness;
  if(gap<minimumGap||gap>maximumGap)failures.push('underside-facing finite clearance outside design bounds');
  if(thickness<minimumSkinThickness||thickness>maximumSkinThickness)failures.push('actual wrap skin thickness outside design bounds');
 }
 return {passed:!failures.length,gap,thickness,fixed,moving,failures};
}

/** Sampled wing-seat material margin: U-shaped outer wing/underpan sections are not a planar slab. */
export const SEAT_MARGIN_RULES=Object.freeze({directions:32,minimumRadius:.0445,datum:'retained cruise ROOT_LOFT midplane from immutable pre-edit geometry, independently confirmed by actual upper/lower skin',datumMinimumAbsX:1.00,datumMaximumAbsX:1.20,bandHalfSpan:.003,minimumSecondaryMaterialSpan:.006,maximumSecondaryMaterialSpan:.09});
/** Raising/rebasing a hinge must not silently move the unchanged wing-material datum. */
export function verifyRetainedWingSeatDatum(referenceHeight:number,actualAxisHeight:number,reviewedAxisLift:number,upper:{top:number,bottom:number},encodingTolerance:number){
 assert([referenceHeight,actualAxisHeight,reviewedAxisLift].every(Number.isFinite));assert([1e-6,6e-5].includes(encodingTolerance),'Use original source/runtime encoding bounds');
 const failures:string[]=[],compensatedFrameHeight=actualAxisHeight-reviewedAxisLift,frameError=Math.abs(compensatedFrameHeight-referenceHeight);
 const actualUpperSkin=upper?.top,actualLowerSkin=upper?.bottom,valid=[actualUpperSkin,actualLowerSkin].every(Number.isFinite)&&actualUpperSkin>actualLowerSkin;
 const actualMaterialMidpoint=valid?(actualUpperSkin+actualLowerSkin)/2:null,midplaneError=actualMaterialMidpoint===null?Infinity:Math.abs(actualMaterialMidpoint-referenceHeight);
 if(frameError>encodingTolerance)failures.push('Actual raised axis minus the reviewed rebase does not recover the frozen cruise wing datum');
 if(!valid||midplaneError>encodingTolerance)failures.push('Actual upper/lower material does not independently confirm the retained wing midplane');
 return {passed:!failures.length,failures,referenceHeight,actualAxisHeight,reviewedAxisLift,compensatedFrameHeight,frameError,actualUpperSkin,actualLowerSkin,actualMaterialMidpoint,midplaneError,encodingTolerance,axisIsNotWingMidplane:reviewedAxisLift!==0,scope:'Datum only. Original32 circumference rays, .0445 radius, .006 interior material band and all real raised-axis support/bore gates remain unchanged.'};
}
export function verifySeatMarginSection(fixed:any,moving:any,actualWingDatumHeight:number){
 assert(Number.isFinite(actualWingDatumHeight),'Actual verified wing midplane height must be finite');
 const failures:string[]=[],bandCenter=actualWingDatumHeight,requiredBand={datum:SEAT_MARGIN_RULES.datum,center:bandCenter,top:bandCenter+SEAT_MARGIN_RULES.bandHalfSpan,bottom:bandCenter-SEAT_MARGIN_RULES.bandHalfSpan,span:2*SEAT_MARGIN_RULES.bandHalfSpan};
 if(fixed.hitCount!==0||fixed.hits?.length!==0||fixed.intervals?.length!==0)failures.push('fixed skin intersects the required outside-seam seat-margin ray');
 const hits=moving.hits,validHits=Array.isArray(hits)&&hits.every((h:any,i:number)=>Number.isFinite(h.t)&&h.t>=0&&Array.isArray(h.point)&&h.point.length===3&&h.point.every(Number.isFinite)&&(!i||(h.t>hits[i-1].t&&h.point[1]<hits[i-1].point[1]&&h.point[0]===hits[0].point[0]&&h.point[2]===hits[0].point[2]&&h.t+h.point[1]===hits[0].t+hits[0].point[1])));
 const validMoving=validHits&&moving.resolved===true&&[2,4].includes(hits.length)&&moving.hitCount===hits.length&&Array.isArray(moving.intervals)&&moving.intervals.length===hits.length/2;
 if(!validMoving)failures.push('seat margin requires one or two resolved finite ordered moving-material intervals');
 const materialIntervals:any[]=validMoving?Array.from({length:hits.length/2},(_,i)=>{const entry=hits[2*i],exit=hits[2*i+1];return {index:i,top:entry.point[1],bottom:exit.point[1],verticalMaterialSpan:entry.point[1]-exit.point[1],entry,exit};}):[];
 if(validMoving){
  for(const [i,r]of moving.intervals.entries()){const a=hits[2*i],b=hits[2*i+1];if(r.start!==a.t||r.end!==b.t||r.thickness!==b.t-a.t||r.entry?.t!==a.t||r.exit?.t!==b.t)failures.push('moving interval metadata differs from complete actual intersections');}
  const upper=materialIntervals[0];if(!(upper.top>requiredBand.top&&upper.bottom<requiredBand.bottom))failures.push('first moving-material interval must strictly contain the complete interior band around the actual wing midplane');
  if(materialIntervals.length===2){const lower=materialIntervals[1];if(!(lower.top<upper.bottom))failures.push('secondary moving material must be strictly below the upper interval');if(lower.verticalMaterialSpan<SEAT_MARGIN_RULES.minimumSecondaryMaterialSpan||lower.verticalMaterialSpan>SEAT_MARGIN_RULES.maximumSecondaryMaterialSpan)failures.push('secondary moving-material span outside original .006–.09 bounds');}
 }
 return {passed:!failures.length,failures,requiredBand,materialIntervals,fixedHitCount:fixed.hitCount,movingIntervalCount:materialIntervals.length,upperBandFullyInterior:!!materialIntervals.length&&materialIntervals[0].top>requiredBand.top&&materialIntervals[0].bottom<requiredBand.bottom,materialClaimScope:'Sampled circumference upper moving material strictly contains a continuous vertical band; at most one finite lower-pan interval may also occur',gapCertified:false,uniformNormalWallClaimed:false,wholeDiskCoverageClaimed:false};
}
/** Caller must independently require closed, single-component main skins and retain full support/collision gates. */
export function verifySeatMarginFootprint(fixedSnapshot:any,movingSnapshot:any,actualBall:number[],radius:number,actualWingDatumHeight:number){
 assert(Array.isArray(actualBall)&&actualBall.length===3&&actualBall.every(Number.isFinite));assert(Number.isFinite(radius)&&radius>=SEAT_MARGIN_RULES.minimumRadius,'Seat margin radius must retain at least .0445');
 assert(Math.abs(actualBall[0])-radius>=SEAT_MARGIN_RULES.datumMinimumAbsX&&Math.abs(actualBall[0])+radius<=SEAT_MARGIN_RULES.datumMaximumAbsX,'Whole seat circle must remain inside the reviewed zero-center ROOT_LOFT span');
 return Array.from({length:SEAT_MARGIN_RULES.directions},(_,j)=>{const angle=j*2*Math.PI/SEAT_MARGIN_RULES.directions,x=actualBall[0]+radius*Math.cos(angle),z=actualBall[2]+radius*Math.sin(angle),origin=[x,2,z],fixedSection=lineSection(fixedSnapshot,origin,[0,-1,0]),section=lineSection(movingSnapshot,origin,[0,-1,0]);return {angle,x,z,fixedSection,section,...verifySeatMarginSection(fixedSection,section,actualWingDatumHeight)};});
}

/** Broad finite cruise scan rejects reversed layers; it must not select only favorable witnesses. */
export function verticalSectionLookup(snapshot:any){
 const triangles=snapshot.triangles.map((t:any)=>{const[a,b,c]=t.vertices;return {a,b,c,den:(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]),minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minZ:Math.min(a[2],b[2],c[2]),maxZ:Math.max(a[2],b[2],c[2])};});
 return (x:number,z:number)=>{const hits:number[]=[];for(const t of triangles){if(x<t.minX-1e-10||x>t.maxX+1e-10||z<t.minZ-1e-10||z>t.maxZ+1e-10||Math.abs(t.den)<=1e-18)continue;const{a,b,c}=t,u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/t.den,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/t.den;if(Math.min(u,v,1-u-v)>=-1e-10)hits.push(u*a[1]+v*b[1]+(1-u-v)*c[1]);}hits.sort((a,b)=>b-a);return hits.filter((v,i)=>i===0||Math.abs(v-hits[i-1])>1e-9);};
}
export function validateWrapStrips(design:any,completeDesign?:any){
 const finite=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 for(const r of [design.xRange,design.yRange])assert(Array.isArray(r)&&r.length===2&&r.every(finite)&&r[0]<r[1]);
 assert(finite(design.step)&&design.step>0&&design.step<=.01);
 const fullPan=completeDesign?.panDomainBlender!==undefined||design.wrapStrips?.length===1||design.wrapStrips?.some((s:any)=>s.id==='full-pan');
 const strips=fullPan?[resolveFullPanStrip(completeDesign,design)]:design.wrapStrips;
 assert(Array.isArray(strips)&&strips.length>=(fullPan?1:2));assert.equal(new Set(strips.map((s:any)=>s.id)).size,strips.length);
 for(const strip of strips){const [lo,hi]=strip.yRange;assert([lo,hi].every(finite)&&lo<hi&&lo>=design.yRange[0]&&hi<=design.yRange[1]);assert(strip.knots.length>=2);assert.equal(strip.knots[0].y,lo);assert.equal(strip.knots.at(-1).y,hi);
  for(const[k,p]of strip.knots.entries()){assert([p.y,p.xInner,p.xOuter].every(finite));assert(p.xInner>=design.xRange[0]&&p.xOuter<=design.xRange[1]&&p.xOuter-p.xInner>=.01-1e-12,'Reviewed strip must have a finite width of at least .01');if(k)assert(p.y>strip.knots[k-1].y);}
  assert([strip.minimumGap,strip.maximumGap,strip.minimumSkinThickness,strip.maximumSkinThickness].every(finite));assert(strip.minimumGap>0&&strip.maximumGap>=strip.minimumGap&&strip.minimumSkinThickness>0&&strip.maximumSkinThickness>=strip.minimumSkinThickness);
 }
 return strips;
}
function stripBoundsAtY(strip:any,y:number){
 const [lo,hi]=strip.yRange;assert(y>=lo-1e-12&&y<=hi+1e-12);
 const index=y>=hi?strip.knots.length-2:Math.max(0,Math.min(strip.knots.length-2,strip.knots.findIndex((p:any)=>p.y>=y)-1)),a=strip.knots[index],b=strip.knots[index+1],t=(y-a.y)/(b.y-a.y);
 return [a.xInner+(b.xInner-a.xInner)*t,a.xOuter+(b.xOuter-a.xOuter)*t];
}
/** A section gap is a bore only when actual surface endpoints and its interior fit the actual finite axis. */
export function proveBoreSectionGaps(hits:number[],x:number,z:number,bore:any){
 assert(hits.length>=4&&hits.length%2===0&&hits.every(Number.isFinite));
 assert(hits.every((v,i)=>!i||hits[i-1]>v),'Bore proof requires ordered distinct actual section hits');
 const failures:string[]=[],gaps:any[]=[];
 if(!bore)return {passed:false,gaps,failures:['Missing actual finite shaft-bore context']};
 for(const p of [bore.axisStart,bore.axisEnd])assert(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Finite actual axis markers required');
 assert(Number.isFinite(bore.radius)&&bore.radius>0&&Number.isInteger(bore.polygonSides)&&bore.polygonSides>=3);
 assert(Number.isFinite(bore.encodingTolerance)&&bore.encodingTolerance>=0&&bore.encodingTolerance<bore.radius);
 const start=new T.Vector3(...bore.axisStart),axis=new T.Vector3(...bore.axisEnd).sub(start),length=axis.length();assert(Number.isFinite(length)&&length>1e-9,'Degenerate/nonfinite actual bore axis');axis.divideScalar(length);
 const minimumBoundaryRadius=bore.radius*Math.cos(Math.PI/bore.polygonSides)-bore.encodingTolerance,maximumBoundaryRadius=bore.radius+bore.encodingTolerance;
 for(let i=1;i<hits.length-1;i+=2){const upper=hits[i],lower=hits[i+1],points=[0,.25,.5,.75,1].map(fraction=>{
   const point=new T.Vector3(x,upper+(lower-upper)*fraction,z),offset=point.clone().sub(start),axial=offset.dot(axis),radial=offset.addScaledVector(axis,-axial).length(),boundary=fraction===0||fraction===1;
   const axialInside=axial>=-bore.encodingTolerance&&axial<=length+bore.encodingTolerance,radialInside=radial<=maximumBoundaryRadius&&(!boundary||radial>=minimumBoundaryRadius);
   return {fraction,point:point.toArray(),boundary,axial,radial,axialInside,radialInside,passed:axialInside&&radialInside};
  }),passed=points.every(p=>p.passed);gaps.push({upper,lower,points,passed});if(!passed)failures.push('Actual material gap '+((i-1)/2)+' is not bounded by the reviewed finite polygonal shaft bore');
 }
 return {passed:!failures.length,gaps,failures,axisStart:bore.axisStart,axisEnd:bore.axisEnd,axisLength:length,radius:bore.radius,polygonSides:bore.polygonSides,encodingTolerance:bore.encodingTolerance,minimumBoundaryRadius,maximumBoundaryRadius};
}
/** A bore may interrupt the fixed skin; the moving lower pan must remain one complete material interval. */
export function verifyRequiredLayerSection(fixed:number[],moving:number[],limits:any,point:{x:number,z:number,bore?:any}){
 const reasons:string[]=[],overlappingIntervals:any[]=[],reversedIntervals:any[]=[];
 assert([limits.minimumGap,limits.maximumGap,limits.minimumSkinThickness,limits.maximumSkinThickness].every(Number.isFinite)&&limits.minimumGap>0&&limits.maximumGap>=limits.minimumGap&&limits.minimumSkinThickness>0&&limits.maximumSkinThickness>=limits.minimumSkinThickness,'Finite both-sided required material bounds are mandatory');
 for(const hits of [fixed,moving])assert(hits.every(Number.isFinite)&&hits.every((v,i)=>!i||hits[i-1]>v),'Required section needs finite ordered distinct actual hits');
 const fixedClosed=fixed.length>=2&&fixed.length%2===0,movingContinuous=moving.length===2;
 if(!fixedClosed)reasons.push('required pan point has missing or unresolved fixed material');
 if(!movingContinuous)reasons.push('required pan point must contain exactly one complete moving lower-material interval');
 const fixedBoreProof=fixedClosed&&fixed.length>2?proveBoreSectionGaps(fixed,point.x,point.z,point.bore):null;
 if(fixedBoreProof&&!fixedBoreProof.passed)reasons.push('every interruption in fixed skin must be proven as the actual finite shaft bore');
 let gap:number|null=null,skinThickness:number|null=null;
 if(fixedClosed&&movingContinuous){
  gap=fixed.at(-1)!-moving[0];skinThickness=moving[0]-moving[1];
  if(gap<limits.minimumGap||gap>limits.maximumGap)reasons.push('required pan gap outside both-sided bounds');
  if(skinThickness<limits.minimumSkinThickness||skinThickness>limits.maximumSkinThickness)reasons.push('required pan moving skin thickness outside both-sided bounds');
 }
 if(fixedClosed&&moving.length%2===0)for(let ai=0;ai<fixed.length;ai+=2)for(let bi=0;bi<moving.length;bi+=2){
  if(Math.min(fixed[ai],moving[bi])-Math.max(fixed[ai+1],moving[bi+1])>1e-9)overlappingIntervals.push({fixedInterval:ai/2,movingInterval:bi/2});
  if(moving[bi+1]>fixed[ai])reversedIntervals.push({fixedInterval:ai/2,movingInterval:bi/2});
 }
 if(overlappingIntervals.length)reasons.push('actual fixed/moving material intervals overlap');
 if(reversedIntervals.length)reasons.push('moving material interval lies above fixed material');
 const passed=!reasons.length;
 return {passed,reasons,gap,skinThickness,boreInterruptedFixedSkin:!!fixedBoreProof?.passed,fixedBoreProof,fixedIntervalCount:fixedClosed?fixed.length/2:null,movingIntervalCount:moving.length%2===0?moving.length/2:null,movingContinuous,materialClaimed:passed,materialClaimScope:'Exactly one continuous moving lower-pan interval; fixed material may have proven cylindrical bore interruptions',pairing:'Lowest fixed material endpoint to moving top; no bore void is counted as material',overlappingIntervals,reversedIntervals};
}
export function scanLayerGrid(fixed:any,moving:any,design:any,sign:number,bore?:any,completeDesign?:any){
 const strips=validateWrapStrips(design,completeDesign),f=verticalSectionLookup(fixed),m=verticalSectionLookup(moving),reversed:any[]=[],overlapping:any[]=[],coverage:any[]=[],unresolved:any[]=[],unclaimedMultiIntervalSections:any[]=[],boundedOpeningRows:any[]=[],requiredBoreInterruptedRows:any[]=[],unpairedMovingMaterialSections:any[]=[];
 const nx=Math.round((design.xRange[1]-design.xRange[0])/design.step),ny=Math.round((design.yRange[1]-design.yRange[0])/design.step);assert(nx>0&&ny>0&&nx*ny<1000000);let samples=0,paired=0;
 for(let j=0;j<=ny;j++){const y=design.yRange[0]+j*design.step;for(let i=0;i<=nx;i++){const x=sign*(design.xRange[0]+i*design.step),a=f(x,-y),b=m(x,-y);samples++;
  if(a.length%2||b.length%2){unresolved.push({x,y,fixedZ:a,movingZ:b,reason:'odd actual material-section intersection count'});continue;}
  const ux=sign*x,requiredStrips=strips.filter((strip:any)=>{if(y<strip.yRange[0]-1e-12||y>strip.yRange[1]+1e-12)return false;const[inner,outer]=stripBoundsAtY(strip,y);return ux>=inner-1e-12&&ux<=outer+1e-12;}),insideRequiredStrip=requiredStrips.length>0;
  if(!insideRequiredStrip&&a.length===0&&b.length>0){
   unpairedMovingMaterialSections.push({x,y,fixedZ:a,movingZ:b,movingIntervalCount:b.length/2,insideRequiredStrip:false,classification:'unpaired-moving-material',layerPaired:false,boreClaimed:false,rayMasked:false,materialClaimed:false,gapCertified:false,thicknessCertified:false,coverageClaimed:false});
  }
  else if(a.length>2||b.length>2){const proofs=[...(a.length>2?[{mesh:'fixed',...proveBoreSectionGaps(a,x,-y,bore)}]:[]),...(b.length>2?[{mesh:'moving',...proveBoreSectionGaps(b,x,-y,bore)}]:[])],requiredChecks=requiredStrips.map((strip:any)=>({strip:strip.id,...verifyRequiredLayerSection(a,b,strip,{x,z:-y,bore})})),row={x,y,fixedZ:a,movingZ:b,proofs,insideRequiredStrip,requiredChecks};
   if(insideRequiredStrip&&requiredChecks.every((r:any)=>r.passed)){requiredBoreInterruptedRows.push({...row,boreInterruptedFixedSkin:true,materialClaimed:true,materialClaimScope:'Continuous moving lower pan only; fixed skin retains its actual proven bore intervals',rayMasked:false});}
   else if(proofs.every(p=>p.passed)&&!insideRequiredStrip){const cellWidth=Math.max(0,Math.min(design.xRange[1],ux+design.step/2)-Math.max(design.xRange[0],ux-design.step/2)),cellHeight=Math.max(0,Math.min(design.yRange[1],y+design.step/2)-Math.max(design.yRange[0],y-design.step/2));boundedOpeningRows.push({...row,projectedGridCellArea:cellWidth*cellHeight,fullWrapMaterialClaimed:false});}
   else {const failure={...row,reason:insideRequiredStrip?'Mandatory lower-pan section lacks one continuous moving interval, a valid fixed-bore proof, or required material clearance':'Multiple-interval material gap lacks actual finite shaft-bore proof'};unclaimedMultiIntervalSections.push(failure);unresolved.push(failure);}
  }
  else if(insideRequiredStrip&&(a.length===0||b.length===0))unresolved.push({x,y,fixedZ:a,movingZ:b,insideRequiredStrip,reason:'Mandatory lower-pan domain cannot omit fixed or moving material'});
  for(let ai=0;ai<a.length;ai+=2)for(let bi=0;bi<b.length;bi+=2){if(Math.min(a[ai],b[bi])-Math.max(a[ai+1],b[bi+1])>1e-9)overlapping.push({x,y,fixedZ:a,movingZ:b,fixedInterval:ai/2,movingInterval:bi/2,reason:'actual material interval overlap'});if(b[bi+1]>a[ai])reversed.push({x,y,fixedZ:a,movingZ:b,fixedInterval:ai/2,movingInterval:bi/2,gap:b[bi+1]-a[ai]});}
  if(a.length===2&&b.length===2)paired++;
 }}
 const requiredFailures:any[]=[];
 for(const strip of strips){const[lo,hi]=strip.yRange,n=Math.ceil((hi-lo)/design.step),ys=[...new Set([...Array.from({length:n+1},(_,i)=>i===n?hi:lo+(hi-lo)*i/n),...strip.knots.map((p:any)=>p.y)])].sort((a:any,b:any)=>a-b);
  for(const y of ys){const[inner,outer]=stripBoundsAtY(strip,y),width=outer-inner;
   const inset=Math.min(1e-6,width/1000),steps=Math.max(2,Math.ceil(width/design.step)),xs=[...new Set([...Array.from({length:steps+1},(_,i)=>inner+inset+(width-2*inset)*i/steps),(inner+outer)/2])].sort((a:any,b:any)=>a-b),checks=[];
   for(const ux of xs){const x=sign*ux,af=f(x,-y),bf=m(x,-y),result=verifyRequiredLayerSection(af,bf,strip,{x,z:-y,bore}),row={strip:strip.id,x,y,fixedZ:af,movingZ:bf,...result};checks.push(row);if(!result.passed)requiredFailures.push(row);}
   coverage.push({strip:strip.id,y,xRange:[inner,outer],requiredSamples:checks.length,passed:checks.every(x=>x.passed),checks});
  }
 }
 const openingMask={actualBore:bore??null,acceptedOpeningRows:boundedOpeningRows,maskedSampleCount:boundedOpeningRows.length,maskedProjectedGridArea:boundedOpeningRows.reduce((sum,row)=>sum+row.projectedGridCellArea,0),areaMethod:'Sum of disjoint ray-centered grid cells clipped to scan bounds; a finite sampled mask, not exact continuous bore area',fullWrapMaterialClaimed:false};
 const requiredBoreChecks=coverage.flatMap(row=>row.checks).filter(row=>row.passed&&row.boreInterruptedFixedSkin),boreInterruptedFixedSkin={requiredSampleCount:requiredBoreChecks.length,requiredRows:requiredBoreChecks,broadGridSampleCount:requiredBoreInterruptedRows.length,broadGridRows:requiredBoreInterruptedRows,rayMasked:false,materialClaimScope:'Continuous moving lower pan only; every fixed-skin void separately proven as the finite actual shaft bore'};
 return {passed:!reversed.length&&!overlapping.length&&!unresolved.length&&!requiredFailures.length,samples,pairedSections:paired,design,requiredDomains:strips,reversed,overlapping,unresolved,unclaimedMultiIntervalSections,unpairedMovingMaterialSections,unpairedMovingMaterialSectionCount:unpairedMovingMaterialSections.length,openingMask,boreInterruptedFixedSkin,coverage,requiredStripFailures:requiredFailures,limitations:['Every sampled point in the complete explicitly reviewed lower-pan domain is mandatory; moving material must remain exactly one closed interval','Fixed skin may have multiple closed intervals only when every internal gap is proven as the actual finite shaft bore; gap is measured from the lowest real fixed material endpoint to the complete moving-pan top, and no required ray is masked','Outside the required domain, positive even moving sections with no fixed material are reported only as unpaired actual material: no layer pairing, bore allowance, ray mask, gap, thickness or coverage certification; actual mesh closure and single-component topology remain caller prerequisites','Where fixed material exists, outside-domain multiple intervals still require every actual gap boundary and quarter/midpoint to fit the finite marker-defined 64-sided shaft bore; their sampled projected mask is reported separately and is not claimed as full-wrap material','All material interval overlaps and reversed interval pairs remain failures, including at bore-validated rays','Finite grid and connected piecewise-linear design domains do not establish continuous geometric clearance between samples']};
}
