import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader}from'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder}from'three/examples/jsm/libs/meshopt_decoder.module.js';
import{createModelRig,applyModelPose}from'../../src/rig.ts';
for(const file of ['assets/blender/xp4-source.glb','public/models/xp4.glb']){
 const bytes=fs.readFileSync(file),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const scene=g.scene,parent=new THREE.Group();parent.add(scene);const rig=createModelRig(scene);let worst:any={distance:0};
 for(const scale of [1,1.7])for(const p of [0,.13,.5,1,.89,.5,.13,0]){parent.scale.setScalar(scale);parent.position.set(3+p,2,-5-2*p);parent.rotation.set(0,-1.5+3*p,-.2+p*.4);parent.updateMatrixWorld(true);applyModelPose(rig,p,true);applyModelPose(rig,p);for(const side of ['L','R'])for(const[end,eye]of[['Body','Body'],['Wing','Root']]){const a=scene.getObjectByName(`BraceBall_${side}_${end}`)!,b=scene.getObjectByName(`BraceRodEye_${side}_${eye}`)!;const aw=new THREE.Box3().setFromObject(a).getCenter(new THREE.Vector3()),bw=new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3()),distance=aw.distanceTo(bw);if(distance>worst.distance)worst={distance,scale,p,side,end,ballLocal:a.position.toArray(),eyeLocal:b.position.toArray(),ballWorld:aw.toArray(),eyeWorld:bw.toArray(),rodLocalScale:b.parent?.scale.toArray()};}}
 console.log(file,JSON.stringify(worst));
}
