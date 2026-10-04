/**
 * Exact self-intersection predicates for decoded IEEE-754 mesh-local positions.
 * All strict decisions use BigInt integer/rational arithmetic. No epsilon, SAT,
 * relative-area threshold, vertex welding radius, or sampled rays exclude pairs.
 * Closed AABBs contain every indexed triangle, including exactly degenerate ones.
 * A shared vertex/edge is legal only if it contains the WHOLE exact intersection.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {triangleTriangleContact} from '../lib/triangle-contact.mjs';
const abs=x=>x<0n?-x:x;
const gcd=(a,b)=>{a=abs(a);b=abs(b);while(b){[a,b]=[b,a%b];}return a;};
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0n);
const zero=a=>a.every(x=>x===0n);
const same=(a,b)=>a.every((v,k)=>v===b[k]);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const REQUIRED_MESHES=Object.freeze(['Fixed_root_L','Fixed_root_R','Composite_wing_L','Composite_wing_R','Fuselage']);
export const REQUIRED_ENCODINGS=Object.freeze(['source','runtime']);
/** Exact n*2**e decomposition, including subnormal numbers. */
export function dyadic(v){assert(Number.isFinite(v),'Nonfinite coordinate');if(v===0)return [0n,0];const b=new DataView(new ArrayBuffer(8));b.setFloat64(0,v,false);const bits=b.getBigUint64(0,false),ex=Number((bits>>52n)&2047n),fr=bits&((1n<<52n)-1n);let n=ex?fr+(1n<<52n):fr,e=ex?ex-1023-52:-1074;if(bits>>63n)n=-n;while(n&&n%2n===0n){n/=2n;e++;}return[n,e];}
const homogeneous=p=>[...p,1n];
function normalize(p){assert(p[3]!==0n);if(p[3]<0n)p=p.map(x=>-x);const g=p.reduce(gcd);return g>1n?p.map(x=>x/g):p;}
const hpEqual=(p,q)=>p.slice(0,3).every((x,k)=>x*q[3]===q[k]*p[3]);
const hpCompare=(p,q,k)=>{const x=p[k]*q[3]-q[k]*p[3];return x<0n?-1:x>0n?1:0;};
const hpKey=p=>normalize(p).join('/');
const dedup=p=>[...new Map(p.map(x=>[hpKey(x),x])).values()];
function meet(p,q,fp,fq){return normalize([...p.slice(0,3).map((x,k)=>x*fq-q[k]*fp),p[3]*fq-q[3]*fp]);}
const midpoint=(p,q)=>normalize([...p.slice(0,3).map((v,k)=>v*q[3]+q[k]*p[3]),2n*p[3]*q[3]]);
function section(t,ds){const p=[];for(let i=0;i<3;i++){if(ds[i]===0n)p.push(homogeneous(t.p[i]));const j=(i+1)%3;if(ds[i]*ds[j]<0n)p.push(meet(homogeneous(t.p[i]),homogeneous(t.p[j]),ds[i],ds[j]));}return dedup(p);}
const field=(t,p)=>dot(t.n,p.slice(0,3).map((x,k)=>x-t.p[0][k]*p[3]));
function inside(t,p){const signs=t.p.map((a,i)=>dot(t.n,cross(sub(t.p[(i+1)%3],a),p.slice(0,3).map((v,k)=>v-a[k]*p[3]))));return {strict:signs.every(x=>x>0n),boundaryEdges:signs.filter(x=>x===0n).length};}
function clip(poly,f){const out=[];if(!poly.length)return out;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],fp=f(p),fq=f(q);if(fp>=0n)out.push(p);if((fp>=0n)!==(fq>=0n))out.push(meet(p,q,fp,fq));}return dedup(out);}
function coplanar(a,b){let poly=a.p.map(homogeneous);for(let i=0;i<3;i++){const v=b.p[i],edge=sub(b.p[(i+1)%3],v);poly=clip(poly,p=>dot(b.n,cross(edge,p.slice(0,3).map((x,k)=>x-v[k]*p[3]))));}return poly;}
function hpOnSegment(p,a,b){const v=sub(b,a),w=p.slice(0,3).map((x,k)=>x-a[k]*p[3]);return zero(cross(v,w))&&dot(w,v)>=0n&&dot(w,v)<=dot(v,v)*p[3];}
const whollyShared=(points,shared)=>shared.length===1?points.every(p=>hpEqual(p,homogeneous(shared[0]))):shared.length===2?points.every(p=>hpOnSegment(p,shared[0],shared[1])):false;
function positiveArea(poly){if(poly.length<3)return false;const p=poly[0];for(let i=1;i+1<poly.length;i++){const q=poly[i],r=poly[i+1],v=q.slice(0,3).map((x,k)=>x*p[3]-p[k]*q[3]),w=r.slice(0,3).map((x,k)=>x*p[3]-p[k]*r[3]);if(!zero(cross(v,w)))return true;}return false;}
export function exactTriangleContact(a,b,{witnesses=true}={}){
 assert(!a.degenerate&&!b.degenerate,'Exact zero-area triangle is a hard input failure');
 const shared=a.p.filter(p=>b.p.some(q=>same(p,q))),da=a.p.map(p=>dot(b.n,sub(p,b.p[0]))),db=b.p.map(p=>dot(a.n,sub(p,a.p[0])));
 const separated=ds=>ds.every(x=>x>0n)||ds.every(x=>x<0n);
 if(separated(da)||separated(db))return {kind:'disjoint',sharedVertices:shared.length};
 const direction=cross(a.n,b.n);let points,kind;
 if(zero(direction)){
  if(da.some(x=>x!==0n))return{kind:'disjoint',sharedVertices:shared.length};
  points=coplanar(a,b);if(!points.length)return {kind:'disjoint',sharedVertices:shared.length};
  kind=positiveArea(points)?'coplanar_positive_area_overlap':points.length===1?'exact_point_touch':'coplanar_boundary_segment_touch';
 }else{
  // Distinct planes intersect on their common edge line. A nondegenerate
  // triangle's intersection with its own edge line is precisely that edge.
  if(shared.length===2)return {kind:'legal_shared_edge',sharedVertices:2};
  const sa=section(a,da),sb=section(b,db);if(!sa.length||!sb.length)return {kind:'disjoint',sharedVertices:shared.length};
  const axis=direction.findIndex(x=>x!==0n);sa.sort((p,q)=>hpCompare(p,q,axis));sb.sort((p,q)=>hpCompare(p,q,axis));
  const lo=hpCompare(sa[0],sb[0],axis)>=0?sa[0]:sb[0],hi=hpCompare(sa.at(-1),sb.at(-1),axis)<=0?sa.at(-1):sb.at(-1);
  if(hpCompare(lo,hi,axis)>0)return {kind:'disjoint',sharedVertices:shared.length};points=dedup([lo,hi]);
  if(points.length===1)kind='exact_point_touch';else{const p=midpoint(lo,hi),ia=inside(a,p),ib=inside(b,p);kind=ia.strict&&ib.strict?'strict_interior_transversal_crossing':ia.strict||ib.strict?'edge_to_interior_intersection':'boundary_segment_touch';}
 }
 if(whollyShared(points,shared))return {kind:shared.length===1?'legal_shared_vertex':'legal_shared_edge',sharedVertices:shared.length};
 return {kind,sharedVertices:shared.length,...witnesses?{exactIntersection:points.map(p=>normalize(p).map(String))}:{}};
}
function bounds(points){return{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};}
const overlap=(a,b)=>a.min.every((x,k)=>x<=b.max[k]&&b.min[k]<=a.max[k]);
export function prepareMesh(raw){
 assert(raw&&raw.name&&Array.isArray(raw.positions)&&Array.isArray(raw.indices),'Missing raw indexed mesh');
 assert.equal(raw.positionCount,raw.positions.length,'Position count mismatch');assert.equal(raw.indexCount,raw.indices.length,'Index count mismatch');assert(raw.indexCount>0&&raw.indexCount%3===0,'Missing/truncated index buffer');assert.equal(raw.triangleCount,raw.indexCount/3,'Triangle coverage count mismatch');
 for(const p of raw.positions)assert(Array.isArray(p)&&p.length===3&&p.every(Number.isFinite),'Invalid decoded position');
 for(const i of raw.indices)assert(Number.isSafeInteger(i)&&i>=0&&i<raw.positionCount,'Invalid triangle index');
 const ds=raw.positions.map(p=>p.map(dyadic));let exponent=0;for(const p of ds)for(const[n,e]of p)if(n&&e<exponent)exponent=e;
 const positions=ds.map(p=>p.map(([n,e])=>n<<BigInt(e-exponent))),triangles=[];
 for(let i=0;i<raw.indexCount;i+=3){const ids=raw.indices.slice(i,i+3),p=ids.map(j=>positions[j]),vertices=ids.map(j=>raw.positions[j]),n=cross(sub(p[1],p[0]),sub(p[2],p[0]));triangles.push({triangleIndex:i/3,vertexIndices:ids,p,n,degenerate:zero(n),vertices,bounds:bounds(vertices)});}
 return {name:raw.name,raw,positions,exponent,triangles,geometrySha256:hash({positions:raw.positions,indices:raw.indices}),indexedTriangleCoverageSha256:hash(triangles.map(t=>[t.triangleIndex,t.vertexIndices]))};
}
function tree(ts,ids){const b={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};for(const i of ids)for(let k=0;k<3;k++){b.min[k]=Math.min(b.min[k],ts[i].bounds.min[k]);b.max[k]=Math.max(b.max[k],ts[i].bounds.max[k]);}if(ids.length<=8)return{bounds:b,ids};const spans=b.max.map((x,k)=>x-b.min[k]),axis=spans.indexOf(Math.max(...spans));ids.sort((i,j)=>ts[i].bounds.min[axis]+ts[i].bounds.max[axis]-ts[j].bounds.min[axis]-ts[j].bounds.max[axis]||i-j);const mid=ids.length>>1;return{bounds:b,left:tree(ts,ids.slice(0,mid)),right:tree(ts,ids.slice(mid))};}
export function enumerateClosedCandidates(mesh,visit){
 const ts=mesh.triangles,root=tree(ts,ts.map((_,i)=>i)),covered=[];const collect=n=>n.ids?covered.push(...n.ids):(collect(n.left),collect(n.right));collect(root);covered.sort((a,b)=>a-b);assert.deepEqual(covered,ts.map((_,i)=>i),'BVH lost or duplicated an actual indexed triangle');
 const stats={indexedTriangles:ts.length,bvhCoveredTriangles:covered.length,bvhNodePairs:0,leafTrianglePairs:0,closedAABBCandidates:0},stack=[[root,root]];
 while(stack.length){const[a,b]=stack.pop();stats.bvhNodePairs++;if(!overlap(a.bounds,b.bounds))continue;if(a===b){if(a.ids){for(let x=0;x<a.ids.length;x++)for(let y=x+1;y<a.ids.length;y++){stats.leafTrianglePairs++;const i=a.ids[x],j=a.ids[y];if(overlap(ts[i].bounds,ts[j].bounds)){stats.closedAABBCandidates++;visit(Math.min(i,j),Math.max(i,j));}}}else stack.push([a.left,a.left],[a.left,a.right],[a.right,a.right]);}
 else if(a.ids&&b.ids){for(const i0 of a.ids)for(const j0 of b.ids){stats.leafTrianglePairs++;const i=Math.min(i0,j0),j=Math.max(i0,j0);if(overlap(ts[i].bounds,ts[j].bounds)){stats.closedAABBCandidates++;visit(i,j);}}}
 else if(a.ids)stack.push([a,b.left],[a,b.right]);else if(b.ids)stack.push([a.left,b],[a.right,b]);else stack.push([a.left,b.left],[a.left,b.right],[a.right,b.left],[a.right,b.right]);
 }
 return stats;
}
/** Optional approximate near-contact output never contributes to strict success. */
export function scanMesh(mesh,{nearDiagnostics=false}={}){
 const started=performance.now(),counts={},strictContacts=[],nearContacts=[],degenerateTriangles=mesh.triangles.filter(t=>t.degenerate).map(t=>({triangleIndex:t.triangleIndex,vertexIndices:t.vertexIndices,vertices:t.vertices}));
 const noteNear=(a,b,i,j)=>{const hit=triangleTriangleContact(a.vertices,b.vertices,{epsilon:1e-9,degenerateEpsilon:0});if(hit)nearContacts.push({a:i,b:j,kind:'exact_disjoint_float64_SAT_near_diagnostic',epsilon:1e-9,...hit});};
 const coverage=enumerateClosedCandidates(mesh,(i,j)=>{const a=mesh.triangles[i],b=mesh.triangles[j];if(a.degenerate||b.degenerate){counts.exact_degenerate_pair=(counts.exact_degenerate_pair??0)+1;return;}const c=exactTriangleContact(a,b);counts[c.kind]=(counts[c.kind]??0)+1;if(!['disjoint','legal_shared_edge','legal_shared_vertex'].includes(c.kind))strictContacts.push({a:i,b:j,...c,verticesA:a.vertices,verticesB:b.vertices});else if(nearDiagnostics&&c.kind==='disjoint')noteNear(a,b,i,j);});
 // Separate conservative padded boxes. No numerical SAT result can delete a
 // strict candidate; these lists explicitly have diagnostic-only semantics.
 if(nearDiagnostics){const padded={...mesh,triangles:mesh.triangles.map(t=>({...t,bounds:{min:t.bounds.min.map(v=>v-1e-9),max:t.bounds.max.map(v=>v+1e-9)}}))};enumerateClosedCandidates(padded,(i,j)=>{const a=mesh.triangles[i],b=mesh.triangles[j];if(a.degenerate||b.degenerate||overlap(a.bounds,b.bounds))return;noteNear(a,b,i,j);});}
 return {name:mesh.name,passed:strictContacts.length===0&&degenerateTriangles.length===0,geometrySha256:mesh.geometrySha256,indexedTriangleCoverageSha256:mesh.indexedTriangleCoverageSha256,exactCoordinateScalePowerOfTwo:mesh.exponent,coverage,classifications:counts,strictContactCount:strictContacts.length,strictContacts,degenerateTriangles,nearDiagnostic:{enabled:nearDiagnostics,coordinateSystem:'decoded mesh local, not world clearance',epsilon:1e-9,strictAcceptanceInfluence:false,count:nearContacts.length,pairs:nearContacts},milliseconds:Math.round(performance.now()-started)};
}
export function assertCompleteModelReports(models){assert.deepEqual(models.map(m=>m.encoding).sort(),[...REQUIRED_ENCODINGS].sort(),'Both source and decoded runtime must be scanned exactly once');for(const m of models){assert.deepEqual(m.meshes.map(s=>s.name).sort(),[...REQUIRED_MESHES].sort(),'Every required mesh must be scanned exactly once');for(const s of m.meshes){assert.equal(s.coverage.indexedTriangles,s.coverage.bvhCoveredTriangles,'Candidate index coverage incomplete');assert.equal(Object.values(s.classifications).reduce((a,b)=>a+b,0),s.coverage.closedAABBCandidates,'Unclassified candidate pair');}}}
/** Local positions and the affine matrix are each exact decoded Float64 values.
 * Applying this map with rationals avoids creating false identity with rounded
 * world coordinates. Its nonzero determinant proves self-intersection invariance.
 */
export function exactWorldVertices(mesh){const m=mesh.raw.localToWorld;assert(Array.isArray(m)&&m.length===16&&m.every(Number.isFinite),'Missing affine matrix');assert(m[3]===0&&m[7]===0&&m[11]===0&&m[15]===1,'Projective transform unsupported');const d=m.map(dyadic),e=Math.min(0,...d.filter(([n])=>n!==0n).map(([,e])=>e)),a=d.map(([n,f])=>n<<BigInt(f-e)),det=dot([a[0],a[1],a[2]],cross([a[4],a[5],a[6]],[a[8],a[9],a[10]]));assert(det!==0n,'Singular matrix cannot preserve local self-intersection');const unit=1n<<BigInt(-mesh.exponent),den=1n<<BigInt(-e-mesh.exponent);return mesh.positions.map(p=>normalize([[0,1,2].map(k=>a[k]*p[0]+a[k+4]*p[1]+a[k+8]*p[2]+a[k+12]*unit),den].flat()));}
export function orientedWorldTriangleKeys(mesh){const keys=exactWorldVertices(mesh).map(hpKey);return mesh.triangles.map(t=>{const a=t.vertexIndices.map(i=>keys[i]);return [a.join('|'),[a[1],a[2],a[0]].join('|'),[a[2],a[0],a[1]].join('|')].sort()[0];});}
export function orientedPairKey(keys,a,b){return [keys[a],keys[b]].sort().join(' <> ');}
/** Exact closed triangle vs either signed-X deformation box. */
export function triangleTouchesDomain(points,domain){for(const sign of [-1,1]){const lo=[sign<0?-domain.maximumAbsX:domain.minimumAbsX,domain.verticalZ[0],-domain.longitudinalY[1]],hi=[sign<0?-domain.minimumAbsX:domain.maximumAbsX,domain.verticalZ[1],-domain.longitudinalY[0]];let poly=points;for(let k=0;k<3;k++)for(const [value,s]of[[lo[k],1n],[hi[k],-1n]]){const[n,e]=dyadic(value),num=e>=0?n<<BigInt(e):n,den=e<0?1n<<BigInt(-e):1n;poly=clip(poly,p=>s*(p[k]*den-num*p[3]));}if(poly.length)return true;}return false;}
export function inheritFuselageContacts(currentMesh,currentReport,baselineMesh,baselineReport,domain){const currentKeys=orientedWorldTriangleKeys(currentMesh),baseKeys=orientedWorldTriangleKeys(baselineMesh),old=new Map();for(const p of baselineReport.strictContacts){const key=orientedPairKey(baseKeys,p.a,p.b);old.set(key,(old.get(key)??0)+1);}const world=exactWorldVertices(currentMesh),inherited=[],rejected=[];for(const p of currentReport.strictContacts){const key=orientedPairKey(currentKeys,p.a,p.b),count=old.get(key)??0,touchesDomain=[p.a,p.b].some(i=>triangleTouchesDomain(currentMesh.triangles[i].vertexIndices.map(j=>world[j]),domain));if(count>0&&!touchesDomain){old.set(key,count-1);inherited.push({...p,orientedExactWorldPairSha256:hash(key),exactDirectedFacesInherited:true,trianglesDisjointFromDeformationDomain:true});}else rejected.push({...p,reason:touchesDomain?'Strict contact touches bounded deformation domain':'No unused exact oriented baseline triangle pair identity'});}return {passed:rejected.length===0&&currentReport.degenerateTriangles.length===0,baselineStrictContacts:baselineReport.strictContactCount,inheritedCount:inherited.length,rejectedCount:rejected.length,inherited,rejected,unusedBaselinePairOccurrences:[...old.values()].reduce((a,b)=>a+b,0)};}
