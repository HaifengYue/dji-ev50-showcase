/** V14独立实体审查公用层：按名称选机构动作，并显式纳入四桨和全部细节运动组。 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {createModelRig,applyModelPose,applyMotorPose,applySurfacePose} from '../../src/rig.ts';
import {MOTOR_IDS,newMotorStates} from '../../src/motors.ts';
const triModule='./triangle-contact.mjs',solidModule='./solid-contact.mjs';
const {createWorldTriangles}=await import(triModule),{solidTopology}=await import(solidModule);
export type AuditPose={label:string,wing:number,fold?:number[],phase?:number[],surfaces?:Record<string,number>,hatch?:number};
export const surfaceIds=['L_Inboard','R_Inboard','L_Outboard','R_Outboard','Tail_L','Tail_R'];
export async function loadAudit(source=process.env.QA_MODEL??'public/models/xp4.glb'){
 const b=readFileSync(source),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 const clip=g.animations.find(c=>c.name==='TRANSWING_Hover_Cruise_Hover');assert.ok(clip,'必须按名称保留原机构动作，不能用动画数量猜测');
 const varying=clip.tracks.filter(t=>{for(let i=t.getValueSize();i<t.values.length;i++)if(Math.abs(t.values[i]-t.values[i%t.getValueSize()])>1e-7)return true;return false});
 const active=new Set(varying.map(t=>t.name.split('.')[0])),meshes:any[]=[];
 g.scene.traverse(o=>{if(/^(Prop_|BladeFold_|ControlPivot_|CargoHoodPivot)/.test(o.name))active.add(o.name)});
 const rig=createModelRig(g.scene),cache=new Map<any,any>(),topology=new Map<string,any>();
 g.scene.traverse((o:any)=>{if(!o.isMesh)return;let p:T.Object3D|null=o;while(p&&!active.has(p.name))p=p.parent;o.qaGroup=p?.name??'固定机体';o.geometry.computeBoundingBox();o.qaBox=new T.Box3();meshes.push(o)});
 const snap=(m:any)=>{let s=cache.get(m);if(s&&s.matrixWorld.every((v:number,i:number)=>v===m.matrixWorld.elements[i]))return s;s=createWorldTriangles(m);cache.set(m,s);if(!topology.has(m.name))topology.set(m.name,solidTopology(s));return s};
 const update=()=>{g.scene.updateMatrixWorld(true);for(const m of meshes)m.qaBox.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)};
 const pose=(p:AuditPose)=>{applyModelPose(rig,p.wing);const states=newMotorStates();for(const [i,id] of MOTOR_IDS.entries()){const fold=p.fold?.[i]??1,phase=fold===0?(p.phase?.[i]??0):0;states[id]={rpm:fold===0?900:0,fold,phase,stage:fold===0?'running':fold===1?'folded':'folding',requested:fold===0}}applyMotorPose(rig,states);applySurfacePose(rig,Object.fromEntries(surfaceIds.map(id=>[id,p.surfaces?.[id]??0])),p.hatch??0);update()};
 pose({label:'初始',wing:0});for(const m of meshes)snap(m);
 const pairs:any[]=[],fixedPairs:any[]=[];for(let i=0;i<meshes.length;i++)for(let j=i+1;j<meshes.length;j++){const a=meshes[i],b=meshes[j],p={a,b,key:[a.name,b.name].sort().join(' / ')};(a.qaGroup===b.qaGroup?fixedPairs:pairs).push(p)}
 assert.equal(new Set(rig.props.map(p=>p.id)).size,4);assert.equal(rig.blades.length,8);for(const id of MOTOR_IDS)for(const leaf of ['A','B'])assert.ok(active.has(`BladeFold_${id}_${leaf}`));
 return {...g,source,sha256:createHash('sha256').update(b).digest('hex'),rig,clip,active,meshes,pairs,fixedPairs,topology,snap,pose,update,groups:Object.fromEntries([...new Set(meshes.map(m=>m.qaGroup))].map(group=>[group,meshes.filter(m=>m.qaGroup===group).map(m=>m.name)]))};
}
