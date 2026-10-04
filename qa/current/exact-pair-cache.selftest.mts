import assert from 'node:assert/strict';import fs from 'node:fs';import * as T from 'three';import {exactPairCache} from './exact-pair-cache.mts';
const a=new T.Mesh(new T.BoxGeometry()),b=new T.Mesh(new T.BoxGeometry()),p={key:'a/b',a,b};a.updateMatrixWorld();b.updateMatrixWorld();const c=exactPairCache();let calls=0;
const calc=()=>({value:++calls});assert.equal(c.evaluate(p,calc).cached,false);assert.equal(c.evaluate(p,calc).cached,true);assert.equal(calls,1);
b.matrixWorld.elements[12]=Number.EPSILON;assert.equal(c.evaluate(p,calc).cached,false);assert.equal(calls,2);
b.matrixWorld.elements[12]=0;assert.equal(c.evaluate(p,calc).cached,true);
const q={...p,key:'another-pair'};assert.equal(c.evaluate(q,calc).cached,false);assert.equal(calls,3);
b.geometry.attributes.position.needsUpdate=true;assert.throws(()=>c.evaluate(p,calc),/Rigid audit geometry mutated/);
const d=new T.Mesh(new T.BoxGeometry()),e=new T.Mesh(new T.BoxGeometry()),rpair={key:'d/e',a:d,b:e},replaceCache=exactPairCache();replaceCache.evaluate(rpair,()=>null);const position=d.geometry.attributes.position;d.geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(position.count*3).fill(99),3));assert.throws(()=>replaceCache.evaluate(rpair,()=>null),/Rigid audit geometry mutated/);
const r={passed:true,cases:['相同矩阵复用','机器精度矩阵变化重新计算','返回同矩阵复用','不同零件对不共享','属性版本变化拒绝','替换同版本顶点属性拒绝'],stats:c.stats()};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r));
