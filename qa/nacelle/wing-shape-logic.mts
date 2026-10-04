/** Independent geometric acceptance; never uses shader normals as material evidence. */
import assert from 'node:assert/strict';
export const CENTRAL_LIFT=.029;
export const SHAFT_LIFT=.029;
export const MOVING_CONSTRUCTION_INSET=.00001;
export const NATURAL_FIT_LIMIT=.00008;
export const JOIN_LIMITS=Object.freeze({maximumExtrapolatedStep:.00015,maximumTangentMismatchDegrees:5,stencilHalfStep:.002,minimumInteriorJoinEdges:50,minimumInteriorProfiles:20});
export const ENCODING_TOLERANCE={source:1e-6,runtime:6e-5};
export const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
/** Physical vertex law independently transcribed from the reviewed finite C1 design. */
export function saddleLiftAtWorld(p:number[]){const [x,z,minusY]=p,y=-minusY;return CENTRAL_LIFT*smooth((Math.abs(x)-.25)/.19)*smooth((y+1.97)/.14)*smooth((-.75-y)/.14)*(1-smooth((z+.10)/.12));}
export function inDomainWorld(p:number[],d:any){const[x,z,negY]=p,y=-negY;return Math.abs(x)>=d.minimumAbsX&&Math.abs(x)<=d.maximumAbsX&&y>=d.longitudinalY[0]&&y<=d.longitudinalY[1]&&z>=d.verticalZ[0]&&z<=d.verticalZ[1];}
/** Historical projected-neighborhood diagnostic only; never authorizes current fixed-wing exemptions. */
export function inProjectedBoreFootprint(x:number,z:number,start:number[],end:number[],radius:number){const dx=end[0]-start[0],dz=end[2]-start[2],dd=dx*dx+dz*dz,t=dd?Math.max(0,Math.min(1,((x-start[0])*dx+(z-start[2])*dz)/dd)):0;return Math.hypot(x-start[0]-t*dx,z-start[2]-t*dz)<=radius;}
/** Actual 3D cutter vicinity for lower-envelope diagnostics, never an XY-only mask. */
export function inFiniteBoreNeighborhood(point:number[],start:number[],end:number[],radius:number,halfLength=1.1){
 assert([point,start,end].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)));assert(Number.isFinite(radius)&&radius>0&&Number.isFinite(halfLength)&&halfLength>0);
 const origin=start.map((v,i)=>(v+end[i])/2),d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d);assert(length>1e-9);const axis=d.map(v=>v/length),v=point.map((v,i)=>v-origin[i]),axial=v.reduce((s,v,i)=>s+v*axis[i],0),radial=Math.hypot(...v.map((v,i)=>v-axial*axis[i]));
 return Math.abs(axial)<=halfLength&&radial<=radius;
}
export function verifyTranslatedSection(before:number[],after:number[],lift:number,tolerance:number){
 assert(tolerance>0&&tolerance<=6e-5);const failures:string[]=[];
 if(before.length!==2||after.length!==2)failures.push('exact two-surface section required');
 const lowerDelta=after.at(-1)!-before.at(-1)!,upperDelta=after[0]-before[0],thicknessError=(after[0]-after.at(-1)!)-(before[0]-before.at(-1)!);
 if(![lowerDelta,upperDelta,thicknessError].every(Number.isFinite))failures.push('nonfinite section');
 if(Math.abs(lowerDelta-lift)>tolerance||Math.abs(upperDelta-lift)>tolerance)failures.push('both actual skins must translate by reviewed lift');
 if(Math.abs(thicknessError)>tolerance)failures.push('actual vertical thickness changed');
 return {passed:!failures.length,failures,lowerDelta,upperDelta,thicknessError};
}
/** The reviewed shaft moves only vertically, together with the complete fixed wing and bore. */
export function verifyAxisTranslation(beforeStart:number[],beforeEnd:number[],afterStart:number[],afterEnd:number[],tolerance:number){
 assert(tolerance>0&&tolerance<=6e-5);const failures:string[]=[],expectedDelta=[0,SHAFT_LIFT,0];
 const points=[beforeStart,beforeEnd,afterStart,afterEnd],finite=points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
 if(!finite)return {passed:false,failures:['four finite actual axis endpoints required'],expectedDelta};
 const endpointDeltas=[afterStart.map((v,i)=>v-beforeStart[i]),afterEnd.map((v,i)=>v-beforeEnd[i])],maximumEndpointError=Math.max(...endpointDeltas.flatMap(d=>d.map((v,i)=>Math.abs(v-expectedDelta[i]))));
 const beforeVector=beforeEnd.map((v,i)=>v-beforeStart[i]),afterVector=afterEnd.map((v,i)=>v-afterStart[i]),maximumVectorError=Math.max(...afterVector.map((v,i)=>Math.abs(v-beforeVector[i]))),lengthError=Math.abs(Math.hypot(...afterVector)-Math.hypot(...beforeVector));
 if(Math.hypot(...beforeVector)<=1e-9||Math.hypot(...afterVector)<=1e-9)failures.push('degenerate actual hinge axis');
 if(maximumEndpointError>tolerance)failures.push('both original hinge-axis endpoints must shift only by the reviewed vertical .029');
 if(maximumVectorError>tolerance||lengthError>tolerance)failures.push('shaft direction or marker separation changed');
 return {passed:!failures.length,failures,expectedDelta,endpointDeltas,maximumEndpointError,maximumVectorError,lengthError,encodingTolerance:tolerance};
}
/** Includes every genuine bore interval and every empty ray; no fixed-wing hole exception exists. */
export function verifyTranslatedMaterialSection(before:number[],after:number[],tolerance:number){
 assert(tolerance>0&&tolerance<=6e-5);const failures:string[]=[];
 const valid=(h:number[])=>Array.isArray(h)&&h.length%2===0&&h.every((v,i)=>Number.isFinite(v)&&(!i||h[i-1]>v));
 if(!valid(before)||!valid(after))failures.push('complete finite ordered even actual material intersections required');
 if(before.length!==after.length)failures.push('all material and bore intervals must retain their exact count');
 const endpointDeltas=before.map((v,i)=>after[i]-v),intervalThicknessErrors=Array.from({length:Math.floor(before.length/2)},(_,i)=>(after[2*i]-after[2*i+1])-(before[2*i]-before[2*i+1]));
 if(endpointDeltas.some(v=>!Number.isFinite(v)||Math.abs(v-CENTRAL_LIFT)>tolerance))failures.push('every actual endpoint including bore walls must translate by reviewed lift');
 if(intervalThicknessErrors.some(v=>!Number.isFinite(v)||Math.abs(v)>tolerance))failures.push('actual material interval thickness changed');
 const empty=before.length===0&&after.length===0;
 return {passed:!failures.length,failures,empty,materialIntervalCount:before.length/2,endpointDeltas,intervalThicknessErrors,lowerDelta:empty?null:endpointDeltas.at(-1),upperDelta:empty?null:endpointDeltas[0],thicknessError:empty?null:Math.max(...intervalThicknessErrors.map(Math.abs)),maximumEndpointTranslationError:endpointDeltas.length?Math.max(...endpointDeltas.map(v=>Math.abs(v-CENTRAL_LIFT))):0};
}
export function verifyNaturalBottom(beforeFixed:number[],moving:number[],expectedInset:number,tolerance:number,maximumFitResidual=0){
 assert(tolerance>0&&tolerance<=6e-5);assert(maximumFitResidual===0||maximumFitResidual===NATURAL_FIT_LIMIT,'Natural shape fitting is a separately fixed design bound, never a relaxed encoding tolerance');const failures:string[]=[];
 const limit=maximumFitResidual||tolerance;
 if(beforeFixed.length<2||beforeFixed.length%2||!beforeFixed.every((v,i)=>Number.isFinite(v)&&(!i||beforeFixed[i-1]>v))||moving.length!==2||!moving.every((v,i)=>Number.isFinite(v)&&(!i||moving[i-1]>v)))failures.push('complete frozen fixed material and exactly one actual moving material interval required');
 const bottomOffset=moving.at(-1)!-beforeFixed.at(-1)!,residual=bottomOffset-expectedInset;
 if(!Number.isFinite(residual)||Math.abs(residual)>limit)failures.push('moving underside does not follow original airfoil underside plus declared inward construction inset');
 return {passed:!failures.length,failures,bottomOffset,residual,maximumFitResidual:maximumFitResidual||null,encodingTolerance:tolerance,comparisonLimit:limit,limitKind:maximumFitResidual?'independent natural-surface fitting residual':'encoding equality'};
}
export function canonicalOrientedTriangle(vertices:any[]){const p=vertices.map(v=>Array.isArray(v)?v.join(','):String(v));return [p.join('|'),[p[1],p[2],p[0]].join('|'),[p[2],p[0],p[1]].join('|')].sort()[0];}

/** Historical candidate2 diagnostic only; current complete fixed-wing acceptance never calls this exception. */
export function boreMaterialException(beforeHits:number[],x:number,z:number,start:number[],end:number[],encodingTolerance:number){
 const origin=start.map((v,i)=>(v+end[i])/2),d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d),axis=d.map(v=>v/length),witnesses:any[]=[];
 for(const oldHeight of beforeHits)for(const shift of [0,CENTRAL_LIFT]){const point=[x,oldHeight+shift,z],v=point.map((p,i)=>p-origin[i]),axial=v.reduce((s,p,i)=>s+p*axis[i],0),radial=Math.hypot(...v.map((p,i)=>p-axial*axis[i]));if(Math.abs(axial)<=1.1+encodingTolerance&&radial<=.045+encodingTolerance)witnesses.push({point,oldHeight,shift,axial,radial});}
 // A new bore may interrupt the interior while both skin endpoints stay outside.
 // Intersect only actual frozen closed material intervals, original or translated,
 // with the same finite cylinder; the minimizing radial witness proves the exception.
 for(let i=0;i+1<beforeHits.length;i+=2)for(const shift of [0,CENTRAL_LIFT]){
  const lo0=beforeHits[i+1]+shift,hi0=beforeHits[i]+shift,c=(x-origin[0])*axis[0]+(z-origin[2])*axis[2],ay=axis[1];
  const axialHeights=[origin[1]+(-1.1-c)/ay,origin[1]+(1.1-c)/ay],lo=Math.max(lo0,Math.min(...axialHeights)),hi=Math.min(hi0,Math.max(...axialHeights));if(lo>hi)continue;
  const optimal=origin[1]+c*ay/(1-ay*ay),height=Math.max(lo,Math.min(hi,optimal)),point=[x,height,z],v=point.map((p,k)=>p-origin[k]),axial=v.reduce((s,p,k)=>s+p*axis[k],0),radial=Math.hypot(...v.map((p,k)=>p-axial*axis[k]));
  if(radial<=.045+encodingTolerance)witnesses.push({point,shift,intervalIndex:i/2,frozenMaterialInterval:[lo0,hi0],axial,radial,interiorCylinderIntersection:true});
 }
 return {excluded:witnesses.length>0,radius:.045,finiteCutterHalfLength:1.1,origin,axis,witnesses};
}

/** Historical candidate2 diagnostic; new design rejects ALL changes to original fixed empty rays. */
export function recoveredBoreMaterial(beforeHits:number[],afterHits:number[],x:number,z:number,start:number[],end:number[],encodingTolerance:number){
 const origin=start.map((v,i)=>(v+end[i])/2),d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d),axis=d.map(v=>v/length),interiorRadius=.045*Math.cos(Math.PI/64)-encodingTolerance;
 if(beforeHits.length||afterHits.length<2||afterHits.length%2)return {excluded:false,witnesses:[],reason:'not an original-empty/new-closed-material ray'};
 const witnesses=afterHits.map(height=>{const originalPoint=[x,height-CENTRAL_LIFT,z],v=originalPoint.map((p,k)=>p-origin[k]),axial=v.reduce((s,p,k)=>s+p*axis[k],0),radial=Math.hypot(...v.map((p,k)=>p-axial*axis[k]));return {newPoint:[x,height,z],originalPoint,axial,radial,passed:Math.abs(axial)<=1.1-encodingTolerance&&radial<=interiorRadius};});
 return {excluded:witnesses.every(p=>p.passed),witnesses,interiorRadius,finiteCutterHalfLength:1.1,oldThicknessComparable:false,proof:'Every endpoint of every inverse-translated new material interval is inside the ORIGINAL finite inscribed cutter. Convexity proves each entire interval belongs to the independently bounded translated old bore volume.'};
}
export function verifyJoinContinuity(zone:any,unresolvedProfiles:any[],limits=JOIN_LIMITS,topologyFailures:any[]=[]){
 const failures:string[]=[];
 if(!Array.isArray(topologyFailures)||topologyFailures.length)failures.push('actual lower-envelope edge adjacency is unresolved or nonmanifold');
 if(!zone||zone.edgeCount<limits.minimumInteriorJoinEdges||zone.criticalProfileCount<limits.minimumInteriorProfiles)failures.push('insufficient actual interior join coverage');
 if(unresolvedProfiles.some(p=>p.zone?.category==='interior outer join band'))failures.push('unresolved actual interior join material section');
 if(!zone||!Number.isFinite(zone.maximumExtrapolatedStep)||zone.maximumExtrapolatedStep>limits.maximumExtrapolatedStep)failures.push('interior finite-scale geometric step exceeds independent design limit');
 if(!zone||!Number.isFinite(zone.maximumTangentMismatchDegrees)||zone.maximumTangentMismatchDegrees>limits.maximumTangentMismatchDegrees)failures.push('interior finite-scale geometric tangent mismatch exceeds independent design limit');
 return {passed:!failures.length,failures,limits,scope:'Actual interior outer join band; separate free rims and join/free-rim intersections remain visible diagnostics. These finite-scale surface-fit limits do not replace encoding precision, wall, gap or collision gates.'};
}
