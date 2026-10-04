/** 真实三角截线恢复及三维直线拟合的解析夹具，不依赖生成器。 */
import assert from 'node:assert/strict';import fs from 'node:fs';import {section,lineFit,vertical,horizontal} from './slot-section.mts';
function surface(poly:number[][]){const triangles:any[]=[];for(let i=0;i<poly.length;i++){
 const a=poly[i],b=poly[(i+1)%poly.length];const v=(p:number[],y:number)=>[p[0],p[1]+.1*y,-y];
 for(const vertices of [[v(a,.5),v(b,.5),v(b,2.2)],[v(a,.5),v(b,2.2),v(a,2.2)]])triangles.push({vertices,triangleIndex:triangles.length});
}return triangles;}
const upper=[[.2,.02],[.23,.1],[0,.2],[-.23,.1],[-.2,.02],[-.194,.026],[-.224,.1],[0,.194],[.224,.1],[.194,.026]],lower=[[-.0955,-.06],[.0955,-.06],[.0955,-.054],[-.0955,-.054]];
const triangles=[...surface(upper),...surface(lower)],points:number[][]=[];
for(const station of [.900001713,1.01,1.28,1.65,1.929998287]){
 const s=section({triangles},station);assert.equal(s.components.length,2);assert(s.components.every(c=>c.closed));const top=s.components.sort((a,b)=>b.bounds[1][1]-a.bounds[1][1])[0];
 const right=top.points.filter(p=>p[0]>.07).sort((a,b)=>a[1]-b[1])[0];assert(Math.abs(right[0]-.2)<1e-12);assert(Math.abs(right[1]-(.02+.1*station))<1e-12);points.push([right[0],station,right[1]]);
}
const centerHits=vertical(section({triangles},1.01),0);assert.equal(centerHits.length,4);for(const [i,v] of [.041,.047,.295,.301].entries())assert(Math.abs(centerHits[i]-v)<1e-12);
const capHits=horizontal(section({triangles},1.01),.301);assert.equal(capHits.length,1);assert(Math.abs(capHits[0])<1e-12);
const straight=lineFit(points);assert(straight.maximumDeviation<1e-12);
const waved=points.map((p,i)=>[p[0],p[1],p[2]+(i===2?.03:0)]),wave=lineFit(waved);assert(wave.maximumDeviation>.02);
const unclosed=section({triangles:triangles.slice(2)},1.17);assert(unclosed.components.some(c=>!c.closed));
const report={passed:true,analyticSections:5,actualThreeDimensionalLineFit:straight,knownWaveDeviation:wave.maximumDeviation,missingMaterialEdgeRejected:true,axisVertexIntersections:4,topVertexIntersection:1,sectionWeld:1e-12,structuralSolidClosure:'截线使用 1e-12 邻近端点接合；结构仍另由原 1e-12 solidTopology 强制检查'};
if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
