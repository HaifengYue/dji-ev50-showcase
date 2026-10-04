/** Conservative convex-patch coverage, not a vertex/centroid surface survey. */
import { pointTriangleDistanceSq } from '../lib/solid-contact.mjs';

type Point = number[];
type Triangle = { vertices: Point[]; triangleIndex?: number; bounds?: { min: Point; max: Point } };
type Plane = { normal: Point; offset: number };
export type LocalDeformationDomain = { minimumAbsX: number; maximumAbsX: number; longitudinalY: number[]; verticalZ: number[] };
export type CoverageOptions = { epsilon?: number; maximumFragments?: number; maximumFailures?: number; maximumPasses?: number };
const dot = (a: Point, b: Point) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a: Point, b: Point) => a.map((x, i) => x - b[i]);
const cross = (a: Point, b: Point) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const same = (a: Point, b: Point) => a.every((x, i) => x === b[i]);
const clean = (ps: Point[]) => { const out: Point[] = []; for (const p of ps) if (!out.length || !same(p, out[out.length-1])) out.push(p); if (out.length > 1 && same(out[0], out[out.length-1])) out.pop(); return out; };
const signed = (p: Point, plane: Plane) => dot(p, plane.normal) - plane.offset;

/** Closed halfspace clipping. It retains line/point patches at protected boundaries. */
function clip(poly: Point[], plane: Plane, sign: 1 | -1): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i+1)%poly.length], da = sign*signed(a, plane), db = sign*signed(b, plane);
    if (da >= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da/(da-db); out.push(a.map((x, k) => x+t*(b[k]-x)));
    }
  }
  return clean(out);
}
function boxPlanes(min: Point, max: Point): Plane[] {
  return [0,1,2].flatMap(k => { const n=[0,0,0]; n[k]=1; return [{normal:n,offset:min[k]},{normal:n.map(x=>-x),offset:-max[k]}]; });
}
function subtractConvex(poly: Point[], planes: Plane[], retainBoundary: boolean): { outside: Point[][]; inside: Point[] } {
  const outside: Point[][] = []; let inside = poly;
  for (const plane of planes) {
    if (!inside.length) break;
    const ds = inside.map(p => signed(p, plane));
    if (ds.some(d => retainBoundary ? d <= 0 : d < 0)) {
      const piece = clip(inside, plane, -1); if (piece.length) outside.push(piece);
    }
    if (retainBoundary && ds.every(d => d === 0)) return {outside,inside:[]};
    inside = clip(inside, plane, 1);
  }
  return {outside,inside};
}
function validateDomain(d: LocalDeformationDomain) {
  if (!(Number.isFinite(d.minimumAbsX) && Number.isFinite(d.maximumAbsX) && d.minimumAbsX > 0 && d.minimumAbsX < d.maximumAbsX &&
    [d.longitudinalY,d.verticalZ].every(v => v?.length === 2 && v.every(Number.isFinite) && v[0] < v[1]))) throw new Error('Invalid explicit local deformation domain');
}
/** World coordinates are [Blender X, Blender Z, -Blender Y]. */
export function clipOutsideDomain(triangle: Triangle, domain: LocalDeformationDomain): Point[][] {
  validateDomain(domain);
  if(triangle.vertices?.length!==3 || !triangle.vertices.every(p=>p?.length===3 && p.every(Number.isFinite)))throw new Error('Source triangle requires three finite world-space vertices');
  let patches = [triangle.vertices];
  for (const [lo,hi] of [[domain.minimumAbsX,domain.maximumAbsX],[-domain.maximumAbsX,-domain.minimumAbsX]]) {
    const planes=boxPlanes([lo,domain.verticalZ[0],-domain.longitudinalY[1]],[hi,domain.verticalZ[1],-domain.longitudinalY[0]]);
    patches=patches.flatMap(poly=>subtractConvex(poly,planes,true).outside);
  }
  return patches;
}
const bounds = (ps: Point[]) => ({min:[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...ps.map(p=>p[k])))});
const overlaps = (a: any,b: any,e: number) => [0,1,2].every(k=>a.min[k]<=b.max[k]+e && b.min[k]<=a.max[k]+e);
function candidates(poly: Point[], snapshot: any, epsilon: number): Triangle[] {
  const b=bounds(poly),out: Triangle[]=[];
  if (snapshot.bvh) {
    const stack=[snapshot.bvh]; while(stack.length) { const node=stack.pop(); if(!overlaps(b,node.bounds,epsilon))continue;
      if(node.indices) for(const i of node.indices) { const t=snapshot.triangles[i]; if(overlaps(b,t.bounds??bounds(t.vertices),epsilon))out.push(t); }
      else stack.push(node.left,node.right);
    }
  } else for(const t of snapshot.triangles) if(overlaps(b,t.bounds??bounds(t.vertices),epsilon))out.push(t);
  return out;
}
function targetPrism(t: Triangle, epsilon: number): Plane[] | null {
  const [a,b,c]=t.vertices,n=cross(sub(b,a),sub(c,a)),length=Math.hypot(...n); if(!Number.isFinite(length)||length===0)return null;
  const normal=n.map(x=>x/length),planes:Plane[]=[];
  for(let i=0;i<3;i++) { const p=t.vertices[i],q=t.vertices[(i+1)%3],edgeNormal=cross(normal,sub(q,p)); planes.push({normal:edgeNormal,offset:dot(edgeNormal,p)}); }
  const h=dot(normal,a); planes.push({normal,offset:h-epsilon},{normal:normal.map(x=>-x),offset:-h-epsilon}); return planes;
}
/** Every accepted convex fragment lies in the epsilon-neighborhood of ONE convex target triangle.
 * Distance to a convex set is convex: bounding ALL fragment vertices therefore bounds EVERY
 * point of the fragment. Prism partitioning supplies full-area coverage across retriangulations.
 * Unproven residuals, nonfinite arithmetic, and resource exhaustion fail closed. */
export function proveOutsidePatchCoverage(source: {triangles: Triangle[]} | Triangle[], target: any, domain: LocalDeformationDomain, options: CoverageOptions = {}) {
  const epsilon=options.epsilon??1e-6,maximumFragments=options.maximumFragments??20000,maximumFailures=options.maximumFailures??8,maximumPasses=options.maximumPasses??16;
  if(!Number.isFinite(epsilon)||epsilon<0||epsilon>1e-6)throw new Error('Coverage tolerance must be finite and at most 1e-6');
  if([maximumFragments,maximumFailures,maximumPasses].some(n=>!Number.isInteger(n)||n<1))throw new Error('Coverage resource limits must be positive integers');
  const triangles=Array.isArray(source)?source:source.triangles,failures:any[]=[],stats={sourceTriangles:triangles.length,protectedPatches:0,targetTriangleCandidates:0,convexCertificates:0,certificateVertices:0,wholeFragmentRescanCertificates:0,coveragePasses:0,largestResidualSet:0,failedPatches:0};
  function certified(poly: Point[], t: Triangle) { return poly.length>0 && poly.every(p=>p.every(Number.isFinite) && pointTriangleDistanceSq(p,t)<=epsilon*epsilon); }
  // Exact states only: no area cutoff, coordinate rounding, or approximate vertex welding.
  const stateKey=(patches:Point[][])=>patches.map(poly=>poly.map(p=>p.join(',')).sort().join(';')).sort().join('|');
  for(const tri of triangles) for(const patch of clipOutsideDomain(tri,domain)) {
    stats.protectedPatches++; let remaining=[patch]; const near=candidates(patch,target,epsilon); stats.targetTriangleCandidates+=near.length;
    const targets=near.map(t=>({t,prism:targetPrism(t,epsilon)})).filter(r=>r.prism!==null),seenStates=new Set([stateKey(remaining)]);let limitReason:string|null=null;
    for(let pass=0;pass<maximumPasses && remaining.length;pass++) {
      stats.coveragePasses++;
      for(const {t,prism} of targets) {
        const next:Point[][]=[];
        for(const poly of remaining) {
          if(certified(poly,t)) { stats.convexCertificates++;stats.certificateVertices+=poly.length;continue; }
          const cut=subtractConvex(poly,prism!,false);
          if(cut.inside.length && certified(cut.inside,t)) { next.push(...cut.outside);stats.convexCertificates++;stats.certificateVertices+=cut.inside.length; }
          else next.push(poly); // A numerical or geometric uncertainty never removes area.
        }
        remaining=next;stats.largestResidualSet=Math.max(stats.largestResidualSet,remaining.length);
        if(remaining.length>maximumFragments){limitReason='coverage-fragment-limit';break;} if(!remaining.length)break;
      }
      if(limitReason || !remaining.length)break;
      // A later target can produce a smaller fragment wholly covered by an EARLIER
      // triangle. Recheck every residual against every candidate with the identical
      // convex-distance certificate, including near-collinear numerical fragments.
      remaining=remaining.filter(poly=>{
        if(!targets.some(({t})=>certified(poly,t)))return true;
        stats.convexCertificates++;stats.wholeFragmentRescanCertificates++;stats.certificateVertices+=poly.length;return false;
      });
      if(!remaining.length)break;
      const key=stateKey(remaining);if(seenStates.has(key))break;seenStates.add(key);
      if(pass+1===maximumPasses)limitReason='coverage-pass-limit';
    }
    if(remaining.length) { stats.failedPatches++;if(failures.length<maximumFailures)failures.push({triangleIndex:tri.triangleIndex,reason:limitReason??'unproven-protected-patch',targetTriangleCandidates:near.length,residualPatches:remaining.length,witnessPolygon:remaining[0]}); }
  }
  return {passed:stats.failedPatches===0,epsilon,method:'Closed domain clipping; convex target-triangle neighborhood certificates over full polygon partitions',stats,failures};
}
const canonical = (t: Triangle) => { const v=t.vertices.map(p=>p.join(',')); return [v.join('|'),[v[1],v[2],v[0]].join('|'),[v[2],v[0],v[1]].join('|')].sort()[0]; };
function changedTriangles(source: any, target: any): Triangle[] {
  const counts=new Map<string,number>();for(const t of target.triangles){const k=canonical(t);counts.set(k,(counts.get(k)??0)+1);}
  return source.triangles.filter((t:Triangle)=>{const k=canonical(t),n=counts.get(k)??0;if(n){counts.set(k,n-1);return false;}return true;});
}
/** Direct integration entry point: compares changed oriented triangle multisets in BOTH directions. */
export function verifyOutsidePatchCoverage(before: any, after: any, domain: LocalDeformationDomain, options: CoverageOptions = {}) {
  const beforeToAfter=proveOutsidePatchCoverage(changedTriangles(before,after),after,domain,options),afterToBefore=proveOutsidePatchCoverage(changedTriangles(after,before),before,domain,options);
  return {passed:beforeToAfter.passed&&afterToBefore.passed,epsilon:beforeToAfter.epsilon,beforeToAfter,afterToBefore};
}
