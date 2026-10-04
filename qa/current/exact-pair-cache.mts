/** 仅复用同一不可变网格对和完全相同 Float64 世界矩阵的窄相结果。 */
import assert from 'node:assert/strict';
export function immutableGeometryGuard(){
 const saved=new WeakMap<object,any>();
 const state=(m:any)=>{const position=m.geometry.getAttribute('position'),index=m.geometry.getIndex();return {geometry:m.geometry,position,index,positionData:position.data??null,positionArray:position.array??position.data?.array,indexArray:index?.array??null,positionVersion:position.version??position.data?.version??0,indexVersion:index?.version??0};};
 return (m:any)=>{const now=state(m),before=saved.get(m);if(!before){saved.set(m,now);return;}for(const k of Object.keys(before))assert.strictEqual(now[k],before[k],`Rigid audit geometry mutated: ${m.name||m.uuid}.${k}`);};
}
export function exactPairCache(){
 const cache=new Map<string,Map<string,any>>(),guard=immutableGeometryGuard();let fresh=0,reused=0;
 const meshKey=(m:any)=>[m.geometry.uuid,...m.matrixWorld.elements].join(',');
 const key=(p:any)=>meshKey(p.a)+'|'+meshKey(p.b);
 return {
  evaluate(p:any,fn:()=>any){guard(p.a);guard(p.b);let poses=cache.get(p.key);if(!poses){poses=new Map();cache.set(p.key,poses);}const k=key(p);if(poses.has(k)){reused++;return {value:poses.get(k),cached:true};}const value=fn();guard(p.a);guard(p.b);poses.set(k,value);fresh++;return {value,cached:false};},
  stats(){return {freshNarrowPhasePairPoses:fresh,exactTransformPairReuses:reused,immutableGeometryIdentityAndVersionsAsserted:true,policy:'仅本轮不可变网格身份/属性/数组/版本与Float64世界矩阵完全相同才复用；任何几何变化直接失败，不能让原矩阵快照缓存失效'};}
 };
}
