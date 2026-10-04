/** A changed rotor invalidates every rotor/body pair, including unchanged bodies. */
import assert from 'node:assert/strict';
export function rotorImpact(meshes:any[],props:any[],changed:Set<string>,isChild:(o:any,p:any)=>boolean){
 const owner=(m:any)=>props.find(p=>isChild(m,p));
 const changedRotors=props.filter(p=>meshes.some(m=>changed.has(m.name)&&owner(m)===p)).map(p=>p.name).sort();
 const changedRotorSet=new Set(changedRotors),body=meshes.filter(m=>!owner(m));
 const pairs=props.flatMap(p=>body.filter(m=>changedRotorSet.has(p.name)||changed.has(m.name)).map(m=>({rotor:p.name,mesh:m.name})));
 assert.equal(new Set(pairs.map(p=>p.rotor+'/'+p.mesh)).size,pairs.length);
 const candidatePairs=props.length*body.length;
 return {changedRotors,body,pairs,rerunPairCount:pairs.length,inheritedPairCount:candidatePairs-pairs.length,
  includes:(rotor:string,mesh:string)=>changedRotorSet.has(rotor)||changed.has(mesh)};
}
