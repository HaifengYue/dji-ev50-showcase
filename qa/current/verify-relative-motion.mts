import {affectedScope} from "./affected-scope.mts";
import {conservativeBoxesOverlap} from "./broadphase.mts";
/** 所有实际相对运动组的有限状态实体检查；沿用旧SAT/包含算法及1e-9容差，无运动接触白名单。 */
import {writeFileSync,readFileSync} from 'node:fs';
import {loadAudit} from './audit-scene.mts';
import {exactPairCache} from './exact-pair-cache.mts';
import {surfaceIds,type AuditPose} from './audit-scene.mts';
const triModule='../lib/triangle-contact.mjs',solidModule='../lib/solid-contact.mjs';
const {intersectMeshTriangles}=await import(triModule),{containedComponents}=await import(solidModule);
const audit=await loadAudit(), scope=JSON.parse(readFileSync('qa/contracts/model-refinement.json','utf8')), impact=affectedScope(audit.scene,scope), changed=new Set(impact.rerunMeshes); const allRelativePairCount=audit.pairs.length; audit.pairs=audit.pairs.filter(p=>changed.has(p.a.name)||changed.has(p.b.name)); const pass=process.env.QA_PASS??'fast',states:AuditPose[]=[];
const add=(label:string,wing:number,fold:number[]= [1,1,1,1],phase:number[]=[0,0,0,0],surfaces:Record<string,number>={},hatch=0)=>states.push({label,wing,fold,phase,surfaces,hatch});
if(pass==='fast'){
 for(const wing of [0,.125,.25,.5,.75,.875,1])for(const fold of [0,.5,1])add('四桨同步粗门槛',wing,[fold,fold,fold,fold]);
 for(const wing of [0,.5,1]){add('四桨不同步',wing,[0,.25,.75,1],[.17,0,0,0]);for(const sign of [-1,1])add('六舵面和货舱极限',wing,[0,1,0,1],[1.3,0,2.7,0],Object.fromEntries(surfaceIds.map((id,i)=>[id,sign*(i%2?-12:12)])),55)}
}else if(pass==='wing'){
 for(let i=0;i<=180;i++)for(const fold of [0,.25,.75,1])add('半度参数整翼与四种折叶截面',i/180,[fold,fold,fold,fold]);
 for(const wing of [0,.125,.25,.5,.75,.875,1])for(let mask=0;mask<16;mask++)add('四电机独立启停组合',wing,Array.from({length:4},(_,i)=>mask&(1<<i)?0:1));
}else if(pass==='spin'){
 for(const wing of [0,.125,.25,.5,.75,.875,1])for(let i=0;i<96;i++)add('四桨不同步相位格',wing,[0,0,0,0],[i%24,(i*5+7+3*Math.floor(i/24))%24,(i*7+13+5*Math.floor(i/24))%24,(i*11+3+7*Math.floor(i/24))%24].map(x=>x*Math.PI/12));
}else if(pass==='details'){
 for(const wing of [0,.5,1])for(let mask=0;mask<64;mask++)add('六舵面独立极限组合',wing,[0,1,0,1],[.3,0,1.7,0],Object.fromEntries(surfaceIds.map((id,i)=>[id,mask&(1<<i)?12:-12])),mask%2?55:0);
 for(const wing of [0,.125,.5,.875,1])for(let j=0;j<=8;j++)add('开舱行程与异步桨',wing,[1,0,1,0],[0,j*Math.PI/4,0,j*Math.PI/3],{},55*j/8);
 for(const wing of [0,.5,1])for(const id of surfaceIds)for(let j=0;j<=8;j++)add('各舵面中间行程',wing,[0,0,0,0],[.3,.7,1.1,1.5],{[id]:-12+3*j});
}else throw new Error(`未知QA_PASS ${pass}`);
if(pass==='spin'&&new Set(states.map(s=>JSON.stringify([s.wing,s.fold,s.phase,s.surfaces,s.hatch]))).size!==states.length)throw new Error('异步相位格不得以重复状态凑采样数');
const contacts=new Map<string,any>(),unknown=new Map<string,any>(),cache=exactPairCache();let sat=0,broadHits=0,containTests=0;
for(const [index,state] of states.entries()){
 audit.pose(state);for(const p of audit.pairs){if(!conservativeBoxesOverlap(p.a.qaBox,p.b.qaBox))continue;broadHits++;const entry=cache.evaluate(p,()=>{const a=audit.snap(p.a),b=audit.snap(p.b),r=intersectMeshTriangles(a,b,{maxWitnesses:1,epsilon:1e-9});sat+=r.stats.triangleSATTests;const c=r.intersects?[]:containedComponents(a,b,audit.topology.get(p.a.name),audit.topology.get(p.b.name));if(!r.intersects)containTests++;return {r,c};}),{r,c}=entry.value;
  for(const u of c.unresolved??[]){const key=[u.container,u.contained,u.reason].join('/');if(!unknown.has(key))unknown.set(key,{...u,firstState:state,samples:0});unknown.get(key).samples++}
  if(r.intersects||c.length){if(!contacts.has(p.key)){console.log('FIRST_CONTACT',JSON.stringify({pose:state,names:[p.a.name,p.b.name],witness:r.witnesses[0]??c[0]}));contacts.set(p.key,{meshes:[p.a.name,p.b.name],groups:[p.a.qaGroup,p.b.qaGroup],firstState:state,witness:r.witnesses[0]??c[0],samples:0});}contacts.get(p.key).samples++}
 }if(index%10===0)console.log(index+1,'/',states.length,'接触对',contacts.size,'SAT',sat);
}
const criticalOpen=audit.meshes.filter(m=>!audit.topology.get(m.name).closed&&/^(Fuselage$|Fixed_root_[LR]$|Composite_wing|Landing_wear_tip_|Nacelle|Motor_cowl|Motor_spindle|Spinner|Blade_[LR]|Blade_hinge_|Brace|Root|ControlSurface_|Cargo)/.test(m.name)).map(m=>m.name);
const report={passed:contacts.size===0&&criticalOpen.length===0&&![...unknown.values()].some(u=>u.reason==='unresolved-ray-disagreement'),source:audit.source,sha256:audit.sha256,pass,sampleCount:states.length,states,currentSnapshotTopologyRefreshes:audit.topologyRefreshes,exactPairCache:cache.stats(),changedMeshes:[...changed],affectedScope:impact,unchangedRelativePairsInherited:allRelativePairCount-audit.pairs.length,relativePairCount:audit.pairs.length,groups:audit.groups,sameRigidPairsSkipped:audit.fixedPairs.length,criticalOpen,broadHits,triangleSATTests:sat,containTests,contacts:[...contacts.values()],unresolved:[...unknown.values()],limitations:['V24 重跑所有涉及明确改动件的相对配对；其它配对只在源/运行精确几何、姿态逻辑和动画恒等证明后显式继承 V23 通过证据。原全部姿态不减少；有限采样不是连续扫掠证明','只排除实际同刚体祖先装配，所有四桨叶根、短叉、销孔参与相对实体检查','开放装饰仅作表面SAT，其不可解析包含方向明确保留；不作制造、气动、结构或飞行认证','原Float64 SAT/闭合实体算法，epsilon=1e-9；没有新增运动接触白名单']};
writeFileSync(process.env.QA_OUT??`qa/current/results/${pass}-motion-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,source:report.source,sha256:report.sha256,samples:report.sampleCount,contacts:report.contacts,criticalOpen},null,2));if(!report.passed)process.exitCode=1;
