/** Supplements, never relaxes, the original conservative polygon coverage algorithm. */
import assert from 'node:assert/strict';
import {pointTriangleDistanceSq} from '../lib/solid-contact.mjs';
import {verifyOutsidePatchCoverage} from '../current/patch-coverage.mts';
type Point=number[];
const bounds=(ps:Point[])=>({min:[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...ps.map(p=>p[k])))});
const overlaps=(a:any,b:any,e:number)=>[0,1,2].every(k=>a.min[k]<=b.max[k]+e&&b.min[k]<=a.max[k]+e);
function candidates(poly:Point[],target:any,epsilon:number){const b=bounds(poly),out:any[]=[];
 if(target.bvh){const stack=[target.bvh];while(stack.length){const n=stack.pop();if(!overlaps(b,n.bounds,epsilon))continue;if(n.indices){for(const i of n.indices){const t=target.triangles[i];if(overlaps(b,t.bounds??bounds(t.vertices),epsilon))out.push(t);}}else stack.push(n.left,n.right);}}
 else for(const t of target.triangles)if(overlaps(b,t.bounds??bounds(t.vertices),epsilon))out.push(t);return out;
}
export function certifyConvexPatches(patches:Point[][],target:any,options:{epsilon?:number,maximumDepth?:number,maximumPieces?:number}={}){
 const epsilon=options.epsilon??1e-6,maximumDepth=options.maximumDepth??64,maximumPieces=options.maximumPieces??500000;
 assert(Number.isFinite(epsilon)&&epsilon>=0&&epsilon<=1e-6);assert(Number.isInteger(maximumDepth)&&maximumDepth>=0);assert(Number.isInteger(maximumPieces)&&maximumPieces>0);
 const stats={initialConvexPatches:patches.length,visitedPieces:0,certifiedPieces:0,certificateVertices:0,maximumDepthReached:0},failures:any[]=[];
 const certificate=(poly:Point[],near:any[])=>near.some(t=>poly.every(p=>p.every(Number.isFinite)&&pointTriangleDistanceSq(p,t)<=epsilon*epsilon));
 for(const patch of patches){assert(patch.length&&patch.every(p=>p.length===3&&p.every(Number.isFinite)));const near=candidates(patch,target,epsilon),stack:{poly:Point[],depth:number}[]=[{poly:patch,depth:0}];
  while(stack.length){const {poly,depth}=stack.pop()!;stats.visitedPieces++;stats.maximumDepthReached=Math.max(stats.maximumDepthReached,depth);
   if(stats.visitedPieces>maximumPieces){failures.push({reason:'adaptive piece budget exhausted',depth,remainingPieces:stack.length+1,witnessPolygon:poly});return {passed:false,epsilon,stats,failures};}
   if(certificate(poly,near)){stats.certifiedPieces++;stats.certificateVertices+=poly.length;continue;}
   if(depth>=maximumDepth||!near.length){failures.push({reason:!near.length?'no actual target triangle nearby':'adaptive depth exhausted',depth,witnessPolygon:poly});return {passed:false,epsilon,stats,failures};}
   // Every convex polygon is retained as a complete triangle fan. Degenerate
   // points/lines remain part of the proof; no area/length cutoff exists.
   if(poly.length>3){for(let i=1;i<poly.length-1;i++)stack.push({poly:[poly[0],poly[i],poly[i+1]],depth:depth+1});continue;}
   if(poly.length===1){failures.push({reason:'uncovered point',depth,witnessPolygon:poly});return {passed:false,epsilon,stats,failures};}
   const pairs=poly.length===2?[[0,1]]:[[0,1],[1,2],[2,0]],longest=pairs.map(([a,b])=>({a,b,length:Math.hypot(...poly[a].map((v,k)=>v-poly[b][k]))})).sort((a,b)=>b.length-a.length)[0],{a,b}=longest,m=poly[a].map((v,k)=>v+(poly[b][k]-v)/2);
   if(m.every((v,k)=>v===poly[a][k])||m.every((v,k)=>v===poly[b][k])){failures.push({reason:'no representable exact subdivision progress',depth,witnessPolygon:poly});return {passed:false,epsilon,stats,failures};}
   if(poly.length===2)stack.push({poly:[poly[a],m],depth:depth+1},{poly:[m,poly[b]],depth:depth+1});
   else{const c=[0,1,2].find(i=>i!==a&&i!==b)!;stack.push({poly:[poly[a],m,poly[c]],depth:depth+1},{poly:[m,poly[b],poly[c]],depth:depth+1});}
  }
 }
 return {passed:true,epsilon,stats,failures};
}
export function verifyAdaptiveOutsidePatchCoverage(before:any,after:any,domain:any){
 const initial=verifyOutsidePatchCoverage(before,after,domain,{epsilon:1e-6,maximumFailures:before.triangles.length*16+after.triangles.length*16+1,includeResidualPolygons:true}),rows:any[]=[];
 for(const [direction,target]of [['beforeToAfter',after],['afterToBefore',before]]as const){const first=(initial as any)[direction];assert.equal(first.failures.length,first.stats.failedPatches,'Every unproven original patch must be retained');const patches=first.failures.flatMap((f:any)=>{assert(Array.isArray(f.unprovenPolygons)&&f.unprovenPolygons.length===f.residualPatches);return f.unprovenPolygons;});const supplement=certifyConvexPatches(patches,target);rows.push({direction,firstPass:{...first,failures:first.failures.map(({unprovenPolygons,...f}:any)=>f)},supplement,passed:supplement.passed});}
 return {passed:rows.every(r=>r.passed),epsilon:1e-6,method:'Original full patch proof plus recursive convex-patch certificates for every retained residual; ALL vertices of each certified piece must be within 1e-6 of ONE actual target triangle',rows};
}
