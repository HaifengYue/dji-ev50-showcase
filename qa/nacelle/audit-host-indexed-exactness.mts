/** Portable C7 read-only raw-indexed supplemental audit. Run from checkout: node --import tsx PATH_TO_SCRIPT --out=JSON --input-lock=SUPPLEMENT_LOCK. QA_OUT and QA_INPUT_LOCK also supported; neither is required. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const options=Object.fromEntries(process.argv.slice(2).map(s=>{assert(/^--(?:project|out|input-lock)=/.test(s),'Use --project=CHECKOUT, optional --out=JSON_PATH and --input-lock=LOCK_JSON');const i=s.indexOf('=');return [s.slice(2,i),s.slice(i+1)];}));
const project=path.resolve(options.project??process.cwd());
const req=createRequire(project+'/package.json');
const T=await import(pathToFileURL(req.resolve('three')).href);
const {GLTFLoader}=await import(pathToFileURL(req.resolve('three/examples/jsm/loaders/GLTFLoader.js')).href);
const {subdivideOriginalSeam}=await import(project+'/qa/nacelle/host-decoration-subdivision.mts');
const digest=(x:any)=>crypto.createHash('sha256').update(x).digest('hex');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const expectedSource='801b02ca6b12c326a04e0a1fe7741a99f168c629384ae836f490f7779428570e';
const expectedPrevious='82ca7f6f9e98cb11737da6f1cb8b1507f71baf0ffcb57734b9beb7bb23e70126';
const hashes={
 'qa/reference/nacelle-previous-host-decorations.json':'152134fbdd0b276b43cdaf6a38e5bce094e1e4dd09612a173712c23c4b7c6184',
 'qa/reference/nacelle-host-decoration-subdivision-reference.json':'7c9b35fba54bf7abb80867e4f2955cb2959a6b12fc5e2c5e8fa03e24baa5a88d',
 'qa/reference/nacelle-previous-fuselage.json':'85535d86587aed302ff6892175c4b430c2db55ee85a8023d2eb76fad2ba6ad48',
};
const subdivisionPath=project+'/qa/nacelle/host-decoration-subdivision.mts';
assert.equal(digest(fs.readFileSync(subdivisionPath)),'65cbf65a11e7919f7aea2d8745a060eb6d275f26b72a5966c2d546f83fa5640d','Reviewed deterministic subdivision code required');
const tracked=[project+'/assets/blender/xp4-source.glb',...Object.keys(hashes).map(x=>project+'/'+x),subdivisionPath];
const inputHashes=Object.fromEntries(tracked.map(p=>[p,digest(fs.readFileSync(p))]));
const chosenLock=options['input-lock']??process.env.QA_INPUT_LOCK;
let supplementalInputLock:any=null;
const lockedPaths=new Set<string>();
if(chosenLock){const lockPath=path.resolve(chosenLock),lockBytes=fs.readFileSync(lockPath),lock=JSON.parse(lockBytes.toString());assert(Array.isArray(lock.files)&&lock.files.length>0);const names=new Set<string>();for(const row of lock.files){assert(typeof row.path==='string'&&!path.isAbsolute(row.path));const absolute=path.resolve(project,row.path);assert(absolute.startsWith(project+path.sep)&&!names.has(absolute),'Supplement lock paths must be unique checkout-relative files');assert(typeof row.sha256==='string'&&/^[0-9a-f]{64}$/.test(row.sha256));names.add(absolute);lockedPaths.add(absolute);assert.equal(digest(fs.readFileSync(absolute)),row.sha256,'Selected supplementary lock mismatch: '+row.path);}for(const p of tracked)assert(lockedPaths.has(p),'Selected supplement lock must cover every audit input: '+p);supplementalInputLock={path:lockPath,sha256:digest(lockBytes),fileCount:lock.files.length,passed:true};}
// No default read of qa/current/results/input-lock.json: the original 290-input lock remains historical after the supplementary QA patch.
assert.equal(inputHashes[tracked[0]],expectedSource);
for(const [p,h]of Object.entries(hashes))assert.equal(inputHashes[project+'/'+p],h);
const baseline=read(project+'/qa/reference/nacelle-previous-host-decorations.json').models.find((m:any)=>m.encoding==='source');
const native=read(project+'/qa/reference/nacelle-host-decoration-subdivision-reference.json');
const host=read(project+'/qa/reference/nacelle-previous-fuselage.json').models.find((m:any)=>m.encoding==='source');
assert.equal(baseline.acceptedModelSha256,expectedPrevious);assert.equal(native.acceptedSourceSha256,expectedPrevious);assert.equal(host.modelSha256,expectedPrevious);
async function decode(path:string){const b=fs.readFileSync(path),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');g.scene.updateMatrixWorld(true);return g.scene;}
// Do not call the production preservation verifier or read its report: read actual raw indexed geometry directly.
function capture(scene:any,name:string){const matches:any[]=[];scene.traverse((o:any)=>{if(o.name===name)matches.push(o);});assert.equal(matches.length,1);const o=matches[0];assert(o.isMesh&&!o.isSkinnedMesh&&!o.isInstancedMesh);assert.equal(o.parent.name,'Scene');assert.equal(Object.keys(o.geometry.morphAttributes??{}).length,0);const p=o.geometry.getAttribute('position'),i=o.geometry.getIndex();assert(p&&p.itemSize===3&&i&&i.itemSize===1&&i.count%3===0);assert.equal(o.geometry.drawRange.start,0);assert(o.geometry.drawRange.count===Infinity||o.geometry.drawRange.count===i.count);const positions=Array.from({length:p.count},(_,j)=>new T.Vector3(p.getX(j),p.getY(j),p.getZ(j)).applyMatrix4(o.matrixWorld).toArray());const indices=Array.from({length:i.count},(_,j)=>i.getX(j));assert(positions.every(p=>p.every(Number.isFinite)));assert(indices.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length));return {name,positions,indices,positionCount:p.count,triangleCount:i.count/3};}
const pk=(p:number[])=>JSON.stringify(p);
const tk=(ps:number[][])=>[0,1,2].map(r=>JSON.stringify([ps[r],ps[(r+1)%3],ps[(r+2)%3]])).sort()[0];
function triangles(s:any){return Array.from({length:s.indices.length/3},(_,id)=>({id,key:tk(s.indices.slice(id*3,id*3+3).map((j:number)=>s.positions[j]))}));}
function bag(rows:{id:number,key:string}[]){const m=new Map<string,number[]>();for(const r of rows){const a=m.get(r.key)??[];a.push(r.id);m.set(r.key,a);}return m;}
const smooth=(x:number)=>{const a=Math.min(1,Math.max(0,x));return a*a*(3-2*a);};
const lift=(p:number[])=>{const[x,z,negY]=p,y=-negY;return .029*smooth((Math.abs(x)-.25)/.19)*smooth((y+1.97)/.14)*smooth((-.75-y)/.14)*(1-smooth((z+.10)/.12));};
// Independent old-host nearest point and barycentric evaluation, on immutable original triangles only.
const hostTriangles=host.indices.map((ids:number[])=>{const ps=ids.map(i=>host.positions[i]);return {triangle:new T.Triangle(...ps.map((p:number[])=>new T.Vector3(...p))),deltas:ps.map(lift)};});
function hostMap(p:number[]){const q=new T.Vector3(...p),closest=new T.Vector3();let best=Infinity,delta=0,hostTriangle=-1;for(let i=0;i<hostTriangles.length;i++){const h=hostTriangles[i];h.triangle.closestPointToPoint(q,closest);const d=closest.distanceToSquared(q);if(d>=best)continue;const bary=h.triangle.getBarycoord(closest,new T.Vector3());assert(bary);delta=bary.toArray().reduce((s:number,w:number,k:number)=>s+w*h.deltas[k],0);best=d;hostTriangle=i;}assert(hostTriangle>=0);return {delta,point:[p[0],p[1]+delta,p[2]],hostTriangle};}
const currentScene=await decode(tracked[0]),rows=[];
for(const mesh of native.meshes){
 assert(['Lower_fuselage_join','Lower_fuselage_join002'].includes(mesh.name));const original=mesh.surface,current=capture(currentScene,mesh.name),old=baseline.nodes.find((n:any)=>n.name===mesh.name).surface;
 assert.equal(original.positionCount,56);assert.equal(original.triangleCount,104);assert.deepEqual(old.positions,baseline.nodes.find((n:any)=>n.name===mesh.name).surface.positions);assert.deepEqual(old.indices,baseline.nodes.find((n:any)=>n.name===mesh.name).surface.indices);
 assert.deepEqual(triangles(original).map(t=>t.key).sort(),triangles(old).map(t=>t.key).sort(),'Native reference must equal the complete actual accepted55 oriented multiset');
 const originalMap=original.positions.map(hostMap),allowed=triangles(original).filter(t=>original.indices.slice(3*t.id,3*t.id+3).some((j:number)=>originalMap[j].delta!==0)).map(t=>t.id);assert.deepEqual(allowed,Array.from({length:16},(_,i)=>i));
 const made=subdivideOriginalSeam(original,allowed),mapped=made.surface.positions.map(hostMap);assert.equal(made.surface.positionCount,1344);assert.equal(made.surface.triangleCount,2680);assert.equal(made.protectedOriginalFaces,88);
 const usedRaw=new Set<number>(current.indices),allPhysical=new Set(current.positions.map(pk)),usedPhysical=new Set(current.indices.map((i:number)=>pk(current.positions[i])));
 assert.equal(current.triangleCount,2680);assert.equal(allPhysical.size,1344);assert.equal(usedPhysical.size,1344);assert.equal(usedRaw.size,current.positionCount,'No raw unused position may satisfy exact old-vertex preservation');
 const rawUnused=Array.from({length:current.positionCount},(_,i)=>i).filter(i=>!usedRaw.has(i));assert.equal(rawUnused.length,0);
 const oldZeroIds=originalMap.map((m:any,i:number)=>m.delta===0?i:null).filter((i:any)=>i!==null);assert.equal(oldZeroIds.length,48);
 const oldBag=bag(triangles(old)),currentBag=bag(triangles(current)),protectedRows=triangles(original).filter(t=>t.id>=16),protectedBag=bag(protectedRows),protectedCorrespondence=[];
 assert.equal(protectedRows.length,88);
 for(const [key,originalIds]of protectedBag){const oldIds=oldBag.get(key)??[],actualIds=currentBag.get(key)??[];assert.equal(oldIds.length,originalIds.length);assert.equal(actualIds.length,originalIds.length,'Full oriented protected-face multiplicity must remain exactly equal');for(let j=0;j<originalIds.length;j++)protectedCorrespondence.push({originalTriangle:originalIds[j],accepted55RawTriangle:oldIds[j],currentRawTriangle:actualIds[j],orientedCoordinates:JSON.parse(key),maximumEndpointError:0});}
 const protectedCurrentIds=new Set(protectedCorrespondence.map(r=>r.currentRawTriangle)),protectedUsedPhysical=new Set([...protectedCurrentIds].flatMap(id=>current.indices.slice(3*id,3*id+3).map((i:number)=>pk(current.positions[i]))));
 assert.equal(protectedUsedPhysical.size,48);const outsideVertexEvidence=oldZeroIds.map((i:number)=>{const key=pk(original.positions[i]),rawIndices=[...usedRaw].filter(j=>pk(current.positions[j])===key),protectedFaces=protectedCorrespondence.filter(r=>current.indices.slice(3*r.currentRawTriangle,3*r.currentRawTriangle+3).some((j:number)=>pk(current.positions[j])===key)).map(r=>r.currentRawTriangle);assert(rawIndices.length&&protectedFaces.length);return {originalVertex:i,point:original.positions[i],referencedCurrentRawPositionIds:rawIndices,referencingProtectedCurrentTriangleIds:protectedFaces};});
 const exactZeroIds=mapped.map((m:any,i:number)=>m.delta===0?i:null).filter((i:any)=>i!==null),zeroPointEvidence=exactZeroIds.map((i:number)=>{const key=pk(made.surface.positions[i]),rawIds=[...usedRaw].filter(j=>pk(current.positions[j])===key);assert(rawIds.length,'Every unmoved original/subdivision boundary point must occur on actual indexed material');return {constructionVertex:i,isOriginal:i<56,point:made.surface.positions[i],referencedCurrentRawPositionIds:rawIds};});
 assert.equal(exactZeroIds.length,204);assert.equal(exactZeroIds.filter((i:number)=>i>=56).length,156);
 rows.push({name:mesh.name,passed:true,sourceRawPositionCount:current.positionCount,referencedRawPositionCount:usedRaw.size,rawUnusedPositions:rawUnused,physicalPositionCount:allPhysical.size,referencedPhysicalPositionCount:usedPhysical.size,rawTriangleCount:current.triangleCount,originalPointCount:56,originalChangedPoints:8,exactOriginalOutsideReferencedPoints:48,exactProtectedOrientedTriangles:88,protectedOriginalCoordinateMultisetSha256:digest(JSON.stringify(protectedRows.map(r=>r.key).sort())),exactUnmovedSubdivisionBoundaryPoints:156,totalExactZeroMappedReferencedPoints:204,allowedOriginalFaces:allowed,protectedCorrespondence,outsideVertexEvidence,zeroPointEvidence});
}
assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.name).sort(),['Lower_fuselage_join','Lower_fuselage_join002']);
for(const [p,h]of Object.entries(inputHashes))assert.equal(digest(fs.readFileSync(p)),h,'Read inputs changed during audit');
const result={passed:true,audit:'Portable raw-indexed exact-coordinate host-seam audit',sourceSha256:expectedSource,accepted55SourceSha256:expectedPrevious,referenceSha256:hashes,inputHashes,supplementalInputLock,scriptSha256:digest(fs.readFileSync(fileURLToPath(import.meta.url))),createdAt:new Date().toISOString(),method:'Direct current GLTFLoader decode and actual raw index dereference; no existing QA report read. Original 104-face reference surfaces are SHA-bound compact accepted55 evidence, independently verified against the actual full accepted55 GLB by the original supplemental audit (SHA 128b5f92d15416cea49ac28b1ac75c19a176840f8de5cf0332d07d3325d5e153). Exact numeric oriented cyclic triangle multiset, preserving multiplicity. Original old-host nearest-point mapping independently reconstructed to identify unmoved boundary points.',rows,limitations:['This extra exact indexed-material audit does not change the frozen verifier and does not itself repair its unused-buffer-position loophole.','Only the two seam source meshes are in this supplemental audit; other physical and runtime gates remain separately required.']};
if(supplementalInputLock)assert.equal(digest(fs.readFileSync(supplementalInputLock.path)),supplementalInputLock.sha256,'Selected supplement lock changed during audit');
const outputOption=options.out??process.env.QA_OUT;const out=outputOption?path.resolve(outputOption):null;if(out){assert(!tracked.includes(out)&&!lockedPaths.has(out)&&out!==fileURLToPath(import.meta.url)&&out!==supplementalInputLock?.path,'Audit output must not overwrite any input, script, or selected lock');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,out,sourceSha256:expectedSource,rows:rows.map(({name,sourceRawPositionCount,rawUnusedPositions,physicalPositionCount,exactOriginalOutsideReferencedPoints,exactProtectedOrientedTriangles,exactUnmovedSubdivisionBoundaryPoints})=>({name,sourceRawPositionCount,unusedRawPositions:rawUnusedPositions.length,physicalPositionCount,exactOriginalOutsideReferencedPoints,exactProtectedOrientedTriangles,exactUnmovedSubdivisionBoundaryPoints}))}));}else console.log(JSON.stringify(result,null,2));
