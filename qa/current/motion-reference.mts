/** 有限状态的精确恒等证据；不增加容差、碰撞豁免或减少采样。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {immutableGeometryGuard} from './exact-pair-cache.mts';

export const ACCEPTED_MODELS = [
  {encoding:'source', file:'qa/v24/baseline/xp4-source-v23.glb', sha256:'80ce0d237f5266077b5c34f4fc63e062a01d47c682be252eeedcf1cbb4f9f085'},
  {encoding:'runtime', file:'qa/v24/baseline/xp4-runtime-v23.glb', sha256:'01e19eaacd6e9035568f603f49492e02de345808b287b8d951b780a86378ca89'},
] as const;
export const SURFACE_IDS = ['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R'] as const;
export const GROUP_COUNTS = {'fast':30,'wing':836,'spin':672,'details':399,'seam-motion':766,'rotor-envelope':521} as const;
export const MOTION_DEPENDENCIES = ['src/rig.ts','src/motors.ts','src/details.ts','package-lock.json','qa/v15/verification/audit-scene.mts','qa/v23/verification/audit-scene.mts','qa/v7/triangle-contact.mjs','qa/v9/solid-contact.mjs'] as const;
export type Pose = {label?:string;wing:number;fold?:number[];phase?:number[];surfaces?:Record<string,number>;hatch?:number};
export type PoseGroup = {id:string;states:Pose[];stateCount:number;stateParametersSha256:string};
export type PoseGrid = {groups:PoseGroup[];stateCount:number;stateParametersSha256:string};
export const sha256 = (bytes:string|NodeJS.ArrayBufferView) => crypto.createHash('sha256').update(bytes).digest('hex');
export const fileSha256 = (file:string) => sha256(fs.readFileSync(file));
const jsonSha = (value:unknown) => sha256(JSON.stringify(value));
const compareNames = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 显式小端编码保留每一位IEEE-754数据，包括带符号零。 */
export function float64Bytes(values:readonly number[]) {
  const bytes=Buffer.allocUnsafe(values.length*8);
  values.forEach((value,i)=>{assert(Number.isFinite(value),'Nonfinite exact identity value');bytes.writeDoubleLE(value,i*8);});
  return bytes;
}
export function poseValues(p:Pose):number[] {
  assert(Number.isFinite(p.wing),'Missing/nonfinite wing pose');
  for(const k of Object.keys(p)) assert(['label','wing','fold','phase','surfaces','hatch'].includes(k),'Unknown pose field: '+k);
  for(const k of Object.keys(p.surfaces??{})) assert((SURFACE_IDS as readonly string[]).includes(k),'Unknown surface: '+k);
  if(p.fold) assert.equal(p.fold.length,4,'Incomplete fold vector');
  if(p.phase) assert.equal(p.phase.length,4,'Incomplete phase vector');
  const fold=Array.from({length:4},(_,i)=>p.fold?.[i]??1);
  // 严格沿用原验证器的有效姿态：折叠桨叶忽略输入的自转相位。
  return [p.wing,...fold,...Array.from({length:4},(_,i)=>fold[i]===0?(p.phase?.[i]??0):0),...SURFACE_IDS.map(id=>p.surfaces?.[id]??0),p.hatch??0];
}
export function poseGridHash(states:Pose[]) {
  const hash=crypto.createHash('sha256');
  for(const state of states)hash.update(float64Bytes(poseValues(state)));
  return hash.digest('hex');
}
export function makePoseGrid(input:{id:string;states:Pose[]}[]):PoseGrid {
  assert.equal(new Set(input.map(g=>g.id)).size,input.length,'Duplicate pose group');
  const total=crypto.createHash('sha256');
  const groups=input.map(({id,states})=>{
    assert(id&&states.length,'Empty pose group');
    const stateParametersSha256=poseGridHash(states);
    total.update(JSON.stringify([id,states.length,stateParametersSha256])+'\n');
    return {id,states,stateCount:states.length,stateParametersSha256};
  });
  return {groups,stateCount:groups.reduce((n,g)=>n+g.stateCount,0),stateParametersSha256:total.digest('hex')};
}

/** 独立重建完整原始报告姿态格，数值和顺序均须完全相同。 */
export function expectedPoseGrid():PoseGrid {
  const groups:{id:string;states:Pose[]}[]=[];
  for(const id of ['fast','wing','spin','details']) {
    const states:Pose[]=[];
    const add=(wing:number,fold=[1,1,1,1],phase=[0,0,0,0],surfaces:Record<string,number>={},hatch=0)=>states.push({wing,fold,phase,surfaces,hatch});
    if(id==='fast') {
      for(const wing of [0,.125,.25,.5,.75,.875,1])for(const fold of [0,.5,1])add(wing,[fold,fold,fold,fold]);
      for(const wing of [0,.5,1]) {add(wing,[0,.25,.75,1],[.17,0,0,0]);for(const sign of [-1,1])add(wing,[0,1,0,1],[1.3,0,2.7,0],Object.fromEntries(SURFACE_IDS.map((s,i)=>[s,sign*(i%2?-12:12)])),55);}
    } else if(id==='wing') {
      for(let i=0;i<=180;i++)for(const fold of [0,.25,.75,1])add(i/180,[fold,fold,fold,fold]);
      for(const wing of [0,.125,.25,.5,.75,.875,1])for(let mask=0;mask<16;mask++)add(wing,Array.from({length:4},(_,i)=>mask&(1<<i)?0:1));
    } else if(id==='spin') {
      for(const wing of [0,.125,.25,.5,.75,.875,1])for(let i=0;i<96;i++)add(wing,[0,0,0,0],[i%24,(i*5+7+3*Math.floor(i/24))%24,(i*7+13+5*Math.floor(i/24))%24,(i*11+3+7*Math.floor(i/24))%24].map(x=>x*Math.PI/12));
    } else {
      for(const wing of [0,.5,1])for(let mask=0;mask<64;mask++)add(wing,[0,1,0,1],[.3,0,1.7,0],Object.fromEntries(SURFACE_IDS.map((s,i)=>[s,mask&(1<<i)?12:-12])),mask%2?55:0);
      for(const wing of [0,.125,.5,.875,1])for(let j=0;j<=8;j++)add(wing,[1,0,1,0],[0,j*Math.PI/4,0,j*Math.PI/3],{},55*j/8);
      for(const wing of [0,.5,1])for(const s of SURFACE_IDS)for(let j=0;j<=8;j++)add(wing,[0,0,0,0],[.3,.7,1.1,1.5],{[s]:-12+3*j});
    }
    groups.push({id,states});
  }
  const seam:Pose[]=Array.from({length:361},(_,i)=>({wing:i/360,fold:[0,.25,.75,1],phase:[i*.07,0,0,0]}));
  for(let i=0;i<=110;i++)seam.push({wing:(i%3)/2,fold:[1,1,1,1],hatch:i/2});
  for(const s of SURFACE_IDS)for(let i=0;i<=48;i++)seam.push({wing:(i%3)/2,fold:[1,1,1,1],surfaces:{[s]:-12+i/2}});
  groups.push({id:'seam-motion',states:seam});
  const rotor:Pose[]=Array.from({length:201},(_,k)=>({wing:k/200,fold:[0,0,0,0],surfaces:{},hatch:0}));
  for(const wing of [0,.25,.5,.75,1])for(let mask=0;mask<64;mask++)rotor.push({wing,fold:[0,0,0,0],surfaces:Object.fromEntries(SURFACE_IDS.map((s,i)=>[s,mask&(1<<i)?12:-12])),hatch:mask%2?55:0});
  groups.push({id:'rotor-envelope',states:rotor});
  const grid=makePoseGrid(groups);assert.equal(grid.stateCount,3224);return grid;
}
export function assertSamePoseGrid(actual:PoseGrid,expected=expectedPoseGrid()) {
  const rebuilt=makePoseGrid(actual.groups);
  assert.equal(actual.stateCount,rebuilt.stateCount,'Declared state count mismatch');
  assert.equal(actual.stateParametersSha256,rebuilt.stateParametersSha256,'Declared state digest mismatch');
  actual.groups.forEach((g,i)=>{assert.equal(g.stateCount,rebuilt.groups[i].stateCount);assert.equal(g.stateParametersSha256,rebuilt.groups[i].stateParametersSha256);});
  assert.deepEqual(rebuilt.groups.map(g=>[g.id,g.stateCount,g.stateParametersSha256]),expected.groups.map(g=>[g.id,g.stateCount,g.stateParametersSha256]),'Original complete ordered pose grid differs');
  return rebuilt;
}

/** 仅提取两个数组初始化及紧随的姿态构造循环，不执行验证器或读取GLB。 */
export function rotorStatesFromValidator(file='qa/v24/verification/verify-rotor-envelope.mts'):Pose[] {
  const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const snippets:string[]=[];
  for(const name of ['poses','states']) {
    const index=ast.statements.findIndex(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)===name));
    assert(index>=0,'Rotor grid initializer missing: '+name);
    const statement=ast.statements[index] as ts.VariableStatement;
    assert.equal(statement.declarationList.declarations.length,1,'Unexpected rotor grid declaration');
    assert.equal(statement.declarationList.declarations[0].initializer?.getText(ast),'[]','Rotor grid no longer starts empty');
    snippets.push(statement.getText(ast));
    let n=0;for(let i=index+1;i<ast.statements.length;i++) {
      const s=ast.statements[i];if(!ts.isForStatement(s)&&!ts.isForOfStatement(s))break;
      snippets.push(s.getText(ast));n++;
    }
    assert.equal(n,name==='poses'?1:2,'Rotor loop structure differs');
    if(name==='poses')snippets.push('const a={poses};');
  }
  // 只执行隔离的短姿态构造片段，不包含模型读取或三角形计算。
  const result=vm.runInNewContext(snippets.join('\n')+'\nJSON.stringify(states)',{surfaceIds:[...SURFACE_IDS]},{timeout:1000});
  const states=JSON.parse(result).map((p:any)=>({label:p.label,wing:p.unfold,fold:[0,0,0,0],surfaces:p.surfaces??{},hatch:p.hatch??0}));
  const expected=expectedPoseGrid().groups.find(g=>g.id==='rotor-envelope')!;
  assertSamePoseGrid(makePoseGrid([{id:'rotor-envelope',states}]),makePoseGrid([expected]));
  // 显式核对四桨全展开以及默认控制值的detailPose映射。
  const compact=source.replace(/\s/g,'');
  assert(compact.includes('audit.pose({label:state.label,wing:state.unfold,fold:[0,0,0,0],surfaces:state.surfaces??{},hatch:state.hatch??0})'),'Rotor detailPose mapping changed');
  return states;
}

/** 要求历史通过报告及输入已冻结；标签可变，数值参数与顺序不得变化。 */
export function acceptedPoseGrid(root='.') {
  const groups:{id:string;states:Pose[]}[]=[],evidence:any[]=[];
  for(const id of ['fast','wing','spin','details','seam-motion','rotor-envelope']) {
    const relative=`qa/v23/verification/final/${id}-report.json`,file=path.join(root,relative),r=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(r.passed,true,'Historical report failed: '+id);
    let states:Pose[];
    if(id==='seam-motion') {
      assert.equal(r.reports.length,2);r.reports.forEach((x:any,i:number)=>{assert.equal(x.passed,true);assert.equal(x.sha256,ACCEPTED_MODELS[i].sha256);});
      states=r.reports[0].states;
      assertSamePoseGrid(makePoseGrid([{id,states:r.reports[1].states}]),makePoseGrid([{id,states}]));
    } else {
      assert.equal(r.sha256,ACCEPTED_MODELS[1].sha256,'Historical runtime binding differs: '+id);
      if(id==='rotor-envelope') {
        assert.equal(r.sampleCount,521);assert.equal(r.neutralMainMotionSamples,201);assert.equal(r.detailStressSamples,320);
        states=rotorStatesFromValidator(path.join(root,'qa/v24/verification/verify-rotor-envelope.mts'));
      } else states=r.states;
    }
    assert.equal(states.length,GROUP_COUNTS[id as keyof typeof GROUP_COUNTS]);
    groups.push({id,states});evidence.push({group:id,path:relative,sha256:fileSha256(file)});
  }
  const grid=makePoseGrid(groups);assertSamePoseGrid(grid);
  return {grid,evidence,rotorGridSource:{path:'qa/v24/verification/verify-rotor-envelope.mts',sha256:fileSha256(path.join(root,'qa/v24/verification/verify-rotor-envelope.mts'))}};
}

/** 使用实际解码属性、精确数值和有向三角多重集，不再量化或舍入。 */
export function geometryFingerprint(mesh:any) {
  const g=mesh.geometry,p=g?.getAttribute('position'),n=g?.getAttribute('normal'),index=g?.getIndex();
  assert(p&&n&&p.itemSize===3&&n.itemSize===3&&p.count===n.count,'Missing actual position/normal data: '+mesh.name);
  const positions:string[]=[],corners:string[]=[];
  for(let i=0;i<p.count;i++) {
    const position=[p.getX(i),p.getY(i),p.getZ(i)],normal=[n.getX(i),n.getY(i),n.getZ(i)];
    positions.push(float64Bytes(position).toString('hex'));corners.push(float64Bytes([...position,...normal]).toString('hex'));
  }
  const count=index?.count??p.count;assert.equal(count%3,0,'Incomplete oriented triangle: '+mesh.name);
  const triangles=(vertices:string[])=>{
    const rows:string[]=[];
    for(let i=0;i<count;i+=3){const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);assert(ids.every(x=>Number.isInteger(x)&&x>=0&&x<p.count),'Invalid topology index');const [a,b,c]=ids.map(x=>vertices[x]);rows.push([a+b+c,b+c+a,c+a+b].sort()[0]);}
    return sha256(rows.sort().join('\n'));
  };
  return {numericEncoding:'exact decoded IEEE-754 Float64 little-endian',vertexCount:p.count,triangleCount:count/3,uniquePositionsSha256:sha256([...new Set(positions)].sort().join('\n')),orientedPositionTrianglesSha256:triangles(positions),uniquePositionNormalsSha256:sha256([...new Set(corners)].sort().join('\n')),orientedPositionNormalTrianglesSha256:triangles(corners)};
}
function hierarchyIdentity(mesh:any,active:Set<string>) {
  const ancestors:any[]=[];
  for(let o=mesh;o;o=o.parent)ancestors.push({name:o.name,isActive:active.has(o.name),type:o.type??null});
  const nearestActiveAncestor=ancestors.find(o=>o.isActive)?.name??null;
  assert.equal(mesh.qaGroup,nearestActiveAncestor??'固定机体','Actual audit group disagrees with active ancestor: '+mesh.name);
  return {qaGroup:mesh.qaGroup,nearestActiveAncestor,ancestors};
}
function meshesAndNames(audit:any) {
  const meshes=[...audit.meshes].sort((a,b)=>compareNames(a.name,b.name));
  assert(meshes.length,'No actual meshes');assert(meshes.every(m=>m.name&&m.isMesh),'Mesh identity missing');
  assert.equal(new Set(meshes.map(m=>m.name)).size,meshes.length,'Duplicate mesh names');
  const traversed:string[]=[];audit.scene.traverse((o:any)=>{if(o.isMesh)traversed.push(o.name);});
  assert.deepEqual(traversed.sort(compareNames),meshes.map(m=>m.name),'Audit omitted actual scene meshes');
  const all:string[]=[];audit.scene.traverse((o:any)=>all.push(o.name));
  assert.equal(new Set(all).size,all.length,'Ambiguous ancestor/node identity');
  return meshes;
}

/** 在位置和索引不可变断言之外，同时核对法线缓冲区及版本。 */
export function immutableMotionGeometryGuard() {
  const original=immutableGeometryGuard(),saved=new WeakMap<object,any>();
  return (mesh:any)=> {
    original(mesh);
    const normal=mesh.geometry.getAttribute('normal');
    const now={normal,data:normal?.data??null,array:normal?.array??normal?.data?.array,version:normal?.version??normal?.data?.version??0};
    const before=saved.get(mesh);if(!before){saved.set(mesh,now);return;}
    for(const key of Object.keys(now) as (keyof typeof now)[])assert.strictEqual(now[key],before[key],'Rigid audit normals mutated: '+mesh.name+'.'+key);
  };
}

/** 通过注入审计对象，原开发树与精简当前工程可共用同一算法。 */
export function captureAuditMotion(audit:any,grid:PoseGrid,onProgress?:(group:string,count:number)=>void) {
  // 解析自测可提供合成姿态格；正式验收调用方必须使用assertSamePoseGrid。
  assertSamePoseGrid(grid,makePoseGrid(grid.groups));
  const meshes=meshesAndNames(audit),active=new Set<string>(audit.active),hashes=meshes.map(()=>crypto.createHash('sha256'));
  const guard=immutableMotionGeometryGuard();meshes.forEach(guard);
  const rows=meshes.map(m=>({name:m.name,geometry:geometryFingerprint(m),hierarchy:hierarchyIdentity(m,active),groups:[] as any[],matrixSequenceSha256:''}));
  for(const group of grid.groups) {
    const perGroup=meshes.map(()=>crypto.createHash('sha256'));
    for(const state of group.states) {
      meshes.forEach(guard);audit.pose(state);meshes.forEach(guard);
      meshes.forEach((mesh,i)=>{assert.equal(mesh.matrixWorld.elements.length,16);const bytes=float64Bytes(mesh.matrixWorld.elements);hashes[i].update(bytes);perGroup[i].update(bytes);});
    }
    rows.forEach((row,i)=>row.groups.push({id:group.id,stateCount:group.stateCount,stateParametersSha256:group.stateParametersSha256,matrixSequenceSha256:perGroup[i].digest('hex')}));
    onProgress?.(group.id,group.stateCount);
  }
  assert.deepEqual(meshesAndNames(audit).map(m=>m.name),rows.map(r=>r.name),'Mesh set changed while posing');
  rows.forEach((row,i)=>{assert.deepEqual(geometryFingerprint(meshes[i]),row.geometry,'Actual geometry/normal/topology mutated while posing: '+row.name);assert.deepEqual(hierarchyIdentity(meshes[i],new Set(audit.active)),row.hierarchy,'Active ancestry mutated while posing: '+row.name);row.matrixSequenceSha256=hashes[i].digest('hex');});
  const groups=Object.fromEntries([...new Set(rows.map(r=>r.hierarchy.qaGroup))].sort(compareNames).map(g=>[g,rows.filter(r=>r.hierarchy.qaGroup===g).map(r=>r.name)]));
  return {modelSha256:audit.sha256,meshCount:rows.length,meshNamesSha256:jsonSha(rows.map(r=>r.name)),activeNodeNames:[...active].sort(compareNames),groups,stateCount:grid.stateCount,stateParametersSha256:grid.stateParametersSha256,meshes:rows};
}
export type MotionCapture = ReturnType<typeof captureAuditMotion>;
export type MotionReference = {formatVersion:number;kind:string;matrixEncoding:string;grid:PoseGrid;models:(MotionCapture & {encoding:string;acceptedModelSha256:string})[];dependencies:{path:string;sha256:string}[];[key:string]:any};

export function verifyDependencies(dependencies:{path:string;sha256:string}[],root='.',relocations:Record<string,string>={}) {
  assert.deepEqual(dependencies.map(d=>d.path),[...MOTION_DEPENDENCIES],'Motion dependency set differs');
  for(const d of dependencies)assert.equal(fileSha256(path.join(root,relocations[d.path]??d.path)),d.sha256,'Exact motion dependency changed: '+d.path);
}
export function acceptedDependencies(root='.') {
  const lock=JSON.parse(fs.readFileSync(path.join(root,'qa/v24/baseline/input-lock.json'),'utf8'));
  assert.equal(fileSha256(path.join(root,'src/rig.ts')),fileSha256(path.join(root,'qa/v24/baseline/rig.ts')),'src/rig.ts must equal frozen rig before reference generation');
  const dependencies=MOTION_DEPENDENCIES.map(p=>{const row=lock.files.find((r:any)=>r.path===p);assert(row,'Frozen dependency missing: '+p);return {path:p,sha256:row.sha256};});
  verifyDependencies(dependencies,root);return dependencies;
}
function validateCapture(capture:MotionCapture,grid:PoseGrid) {
  assert.equal(capture.stateCount,grid.stateCount);assert.equal(capture.stateParametersSha256,grid.stateParametersSha256);
  assert.equal(capture.meshCount,capture.meshes.length);assert.equal(new Set(capture.meshes.map(m=>m.name)).size,capture.meshCount);
  assert.equal(capture.meshNamesSha256,jsonSha(capture.meshes.map(m=>m.name)));
  assert.deepEqual(capture.meshes.map(m=>m.name),capture.meshes.map(m=>m.name).sort(compareNames));
  for(const m of capture.meshes) {
    assert(m.name&&m.geometry&&m.hierarchy);assert(/^[0-9a-f]{64}$/.test(m.matrixSequenceSha256),'Missing matrix sequence digest: '+m.name);
    assert.deepEqual(m.groups.map(g=>[g.id,g.stateCount,g.stateParametersSha256]),grid.groups.map(g=>[g.id,g.stateCount,g.stateParametersSha256]),'Mesh incomplete pose coverage: '+m.name);
    m.groups.forEach(g=>assert(/^[0-9a-f]{64}$/.test(g.matrixSequenceSha256)));
  }
  const groups=Object.fromEntries([...new Set(capture.meshes.map(m=>m.hierarchy.qaGroup))].sort(compareNames).map(g=>[g,capture.meshes.filter(m=>m.hierarchy.qaGroup===g).map(m=>m.name)]));
  assert.deepEqual(capture.groups,groups,'Declared rigid groups differ from mesh identities');
}
export function validateMotionReference(reference:MotionReference) {
  assert.equal(reference.formatVersion,1);assert.equal(reference.kind,'accepted-finite-state-mesh-motion');
  assert.equal(reference.matrixEncoding,'ordered 16 IEEE-754 Float64 little-endian values per world matrix; SHA-256; no tolerance');
  assertSamePoseGrid(reference.grid);assert.equal(reference.models.length,2);
  reference.models.forEach((m,i)=>{assert.equal(m.encoding,ACCEPTED_MODELS[i].encoding);assert.equal(m.acceptedModelSha256,ACCEPTED_MODELS[i].sha256);assert.equal(m.modelSha256,m.acceptedModelSha256);assert.equal(m.meshCount,283);validateCapture(m,reference.grid);});
  return reference;
}

/** 原有网格缺失或姿态格不匹配即拒绝继承；新增网格始终重跑。 */
export function compareMotionCapture(baseline:MotionCapture,current:MotionCapture,grid:PoseGrid,options:{allowedAddedMeshes?:string[]}={}) {
  validateCapture(baseline,grid);validateCapture(current,grid);
  const before=new Map(baseline.meshes.map(m=>[m.name,m])),after=new Map(current.meshes.map(m=>[m.name,m]));
  const missing=baseline.meshes.filter(m=>!after.has(m.name)).map(m=>m.name);
  assert.deepEqual(missing,[],'Missing accepted meshes; inheritance refused');
  const unauthorizedAdditions=current.meshes.filter(m=>!before.has(m.name)&&!options.allowedAddedMeshes?.includes(m.name)).map(m=>m.name);
  assert.deepEqual(unauthorizedAdditions,[],'Added meshes lack explicit caller authorization; inheritance refused');
  const exactMotionMeshes:string[]=[],changedMotionMeshes:string[]=[],exactGeometryMeshes:string[]=[],changedGeometryMeshes:string[]=[],changedGroupMeshes:string[]=[],addedMeshes:string[]=[],inheritanceEligibleMeshes:string[]=[],meshComparisons:any[]=[];
  for(const m of current.meshes) {
    const old=before.get(m.name);
    if(!old){addedMeshes.push(m.name);changedMotionMeshes.push(m.name);changedGeometryMeshes.push(m.name);meshComparisons.push({name:m.name,added:true,currentGroup:m.hierarchy.qaGroup,inheritanceEligible:false});continue;}
    const matrixSequenceExact=old.matrixSequenceSha256===m.matrixSequenceSha256&&same(old.groups,m.groups);
    const geometryExact=same(old.geometry,m.geometry),activeAncestorAndGroupExact=same(old.hierarchy,m.hierarchy);
    (matrixSequenceExact?exactMotionMeshes:changedMotionMeshes).push(m.name);
    (geometryExact?exactGeometryMeshes:changedGeometryMeshes).push(m.name);
    if(!activeAncestorAndGroupExact)changedGroupMeshes.push(m.name);
    const inheritanceEligible=matrixSequenceExact&&geometryExact&&activeAncestorAndGroupExact;
    if(inheritanceEligible)inheritanceEligibleMeshes.push(m.name);
    meshComparisons.push({name:m.name,added:false,matrixSequenceExact,geometryExact,activeAncestorAndGroupExact,baselineGroup:old.hierarchy.qaGroup,currentGroup:m.hierarchy.qaGroup,inheritanceEligible,changedPoseGroups:m.groups.filter((g,i)=>g.matrixSequenceSha256!==old.groups[i].matrixSequenceSha256).map(g=>g.id)});
  }
  return {passed:true,baselineModelSha256:baseline.modelSha256,currentModelSha256:current.modelSha256,stateCount:grid.stateCount,stateParametersSha256:grid.stateParametersSha256,stateGroups:grid.groups.map(({states,...g})=>g),exactMotionMeshes,changedMotionMeshes,exactGeometryMeshes,changedGeometryMeshes,changedGroupMeshes,addedMeshes,inheritanceEligibleMeshes,rerunMeshes:current.meshes.filter(m=>!inheritanceEligibleMeshes.includes(m.name)).map(m=>m.name),meshComparisons,claim:'Only both-endpoint exact geometry/normal/oriented topology AND all ordered Float64 world matrices AND active-ancestor/group identity can inherit an existing finite-state result. Changed/additional endpoints require rerun; this is not a collision pass or continuous-motion proof.'};
}
export type MotionComparison = ReturnType<typeof compareMotionCapture>;
export function pairInheritance(comparison:MotionComparison,a:string,b:string) {
  assert.notEqual(a,b,'Not a mesh pair');
  const ma=comparison.meshComparisons.find(m=>m.name===a),mb=comparison.meshComparisons.find(m=>m.name===b);
  assert(ma&&mb,'Unknown actual mesh in pair');
  const canInherit=ma.inheritanceEligible&&mb.inheritanceEligible;
  const baselineRelation=ma.added||mb.added?'not-previously-present':ma.baselineGroup===mb.baselineGroup?'same-rigid':'relative';
  const currentRelation=ma.currentGroup===mb.currentGroup?'same-rigid':'relative';
  assert(!canInherit||baselineRelation===currentRelation,'Pair relation changed despite identity proof');
  return {canInherit,baselineRelation,currentRelation,requiresRerun:!canInherit};
}
