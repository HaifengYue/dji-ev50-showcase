/** 从完整机壳真实三角截面恢复长槽可见边线、局部皮厚和贯通空腔。 */
import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';
import {loadReferenceAudit} from './reference-data.mts';
import {loadAudit} from './audit-scene.mts';import {measureSlotBoundaryVertices} from './slot-boundary-vertices.mts';import {section,lineFit,vertical,horizontal} from './slot-section.mts';
const {pointInSolid}=await import('../lib/solid-contact.mjs');
const files=process.env.QA_MODEL?[{source:process.env.QA_MODEL,baseline:process.env.QA_BASELINE_ONLY==='1'}]:[
 {source:'qa/reference/source-protected-surfaces.json',baseline:true},
 {source:'assets/blender/xp4-source.glb',baseline:false},
 {source:'public/models/xp4.glb',baseline:false},
];
const out=process.env.QA_OUT??'qa/current/slot-report.json',reports:any[]=[];
function crossings(s:any){const bad=[],boxes=s.segments.map(e=>({min:[0,1].map(k=>Math.min(...e.points.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...e.points.map(p=>p[k])))}));for(let i=0;i<s.segments.length;i++)for(let j=i+1;j<s.segments.length;j++){
 const x=boxes[i],y=boxes[j];if(x.max[0]<y.min[0]||y.max[0]<x.min[0]||x.max[1]<y.min[1]||y.max[1]<x.min[1])continue;
 const [a,b]=s.segments[i].points,[c,d]=s.segments[j].points;
 if([a,b].some(p=>[c,d].some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8)))continue;
 const r=[b[0]-a[0],b[1]-a[1]],u=[d[0]-c[0],d[1]-c[1]],det=r[0]*u[1]-r[1]*u[0];if(Math.abs(det)<1e-15)continue;
 const q=[c[0]-a[0],c[1]-a[1]],t=(q[0]*u[1]-q[1]*u[0])/det,v=(q[0]*r[1]-q[1]*r[0])/det;
 if(t>0&&t<1&&v>0&&v<1){const p=[a[0]+t*r[0],a[1]+t*r[1]];const distanceFromEndpoints=Math.min(...[a,b,c,d].map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])));if(distanceFromEndpoints>1e-8)bad.push({segments:[i,j],point:p,distanceFromEndpoints});}
}return bad;}
for(const f of files){
 const a=f.baseline&&f.source.endsWith('.json')?loadReferenceAudit():await loadAudit(f.source),hull=a.scene.getObjectByName('Fuselage')!,snap=a.snap(hull),rows:any[]=[],failures:any[]=[],lips:any={upperL:[],upperR:[],lowerL:[],lowerR:[]};
 // 避开名义站位恰落顶点；覆盖整个 .90—1.93 长段，圆端另外抽查。
 if(!a.topology.get('Fuselage').closed&&process.env.QA_ALLOW_OPEN_DIAGNOSTIC!=='1'){const r={...f,sha256:a.sha256,acceptedReferenceModelSha256:f.baseline?(a as any).acceptedModelSha256:undefined,topology:a.topology.get('Fuselage'),passed:false,failures:[{reason:'实际解码 Fuselage 非闭合实体，先停止长边/材料检查'}]};reports.push(r);console.log(JSON.stringify(r));continue;}
 const stations=Array.from({length:225},(_,i)=>.900001713+(1.929998287-.900001713)*i/224);
 const encoding=f.source.includes('runtime')||f.source==='public/models/xp4.glb'?6e-5:1e-6;
 for(const [stationIndex,station] of stations.entries()){
  if(stationIndex%25===0)console.log('SECTION',stationIndex+1,'/',stations.length,f.source);
  const s=section(snap,station),components=s.components.slice().sort((a,b)=>a.bounds[1][1]-b.bounds[1][1]);
  if(components.length!==2||components.some(c=>!c.closed)){failures.push({station,reason:'真实长槽截面不是两个独立闭合材料带',components:components.map(c=>({bounds:c.bounds,degrees:c.degrees}))});continue;}
  const [bottom,top]=components,lip:any={},thickness:any={};
  for(const [side,sign] of [['L',-1],['R',1]] as const){
   const upperPoints=top.points.filter(p=>sign*p[0]>.07),minimumZ=Math.min(...upperPoints.map(p=>p[1]));
   const up=upperPoints.filter(p=>p[1]<=minimumZ+1e-7).sort((p,q)=>sign*(q[0]-p[0]))[0];
   const lowerPoints=bottom.points.filter(p=>sign*p[0]>.07),maximumX=Math.max(...lowerPoints.map(p=>sign*p[0]));
   const lo=lowerPoints.filter(p=>sign*p[0]>=maximumX-1e-7).sort((p,q)=>p[1]-q[1])[0];
   if(!up||!lo){failures.push({station,side,reason:'完整材料截面缺少实际唇边'});continue;}
   lip['upper'+side]=[up[0],station,up[1]];lip['lower'+side]=[lo[0],station,lo[1]];
   lips['upper'+side].push(lip['upper'+side]);lips['lower'+side].push(lip['lower'+side]);
   // 上唇以上 .003 处取横向穿皮射线；下唇向内 .002 处取竖向穿皮射线。两者均截真实材料，不以父子关系或切刀参数代替厚度。
   const upperHits=horizontal(s,up[1]+.003),lowerHits=vertical(s,lo[0]-sign*.002);
   const uh=upperHits.map(x=>sign*x).filter(x=>x>.07).sort((a,b)=>a-b),lh=lowerHits.filter(z=>z<=lo[1]+.025);
   const ut=uh.length>=2?uh.at(-1)!-uh.at(-2)!:null,lt=lh.length>=2?lh[1]-lh[0]:null;
   thickness[side]={upper:ut,lower:lt,upperRayZ:up[1]+.003,lowerRayX:lo[0]-sign*.002,upperHits,lowerHits};
   if(ut===null||lt===null||ut<=.001||lt<=.001)failures.push({station,side,reason:'实际唇后材料皮厚不足 .001 或缺失',thickness:thickness[side]});
   if(!f.baseline&&(up[1]-lo[1]<.01||Math.hypot(up[0]-lo[0],up[1]-lo[1])<.02))failures.push({station,side,reason:'长槽截面缺少真实开放间隙'});
  }
  const selfCrossings=crossings(s);if(selfCrossings.length)failures.push({station,reason:'机壳截面自交',selfCrossings});
  const axisHits=vertical(s,0);let cavity:any=null;
  if(axisHits.length===4){const p=[0,(axisHits[1]+axisHits[2])/2,-station],classification=pointInSolid(p,snap,a.topology.get('Fuselage'));cavity={point:p,state:classification.state,verticalGap:axisHits[2]-axisHits[1]};if(classification.state!=='outside'||cavity.verticalGap<=.02)failures.push({station,reason:'中央空腔样点未得到确定的材料外分类',cavity});}
  else failures.push({station,reason:'中央剖面未得到上/下四条真实皮层交线',axisHits});
  rows.push({station,lip,thickness,cavity,selfCrossings:selfCrossings.length});
 }
 const lines=Object.fromEntries(Object.entries(lips).map(([name,points]:any)=>[name,{...lineFit(points),actualPoints:points}]));
 if(!f.baseline)for(const [name,l]:any of Object.entries(lines))if(l.maximumDeviation>encoding||l.points!==stations.length)failures.push({name,reason:'实际三维长边不共线',maximumDeviation:l.maximumDeviation,maximumAllowed:encoding,points:l.points,expected:stations.length});
 const ends=[.778713,.800713,.840713,.880713,.895713,1.933713,1.940713,1.947713,1.952713].map(station=>{const s=section(snap,station);return {station,components:s.components.map(c=>({closed:c.closed,bounds:c.bounds})),selfCrossings:crossings(s)};});
 if(ends.some(e=>e.components.some(c=>!c.closed)||e.selfCrossings.length))failures.push({reason:'排除长边拟合的短圆端仍须闭合且无截面自交',ends});
 const actualVertexEdges=f.baseline?null:measureSlotBoundaryVertices(snap,JSON.parse(fs.readFileSync('public/models/manifest.json','utf8')).straightFuselageSlot,encoding);
 if(actualVertexEdges&&!actualVertexEdges.passed)failures.push({reason:'实际纵向唇边顶点链识别/共线检查未通过',failures:actualVertexEdges.failures});
 const r={...f,sha256:a.sha256,acceptedReferenceModelSha256:f.baseline?(a as any).acceptedModelSha256:undefined,topology:a.topology.get('Fuselage'),actualVertexEdges,passed:f.baseline?undefined:!failures.length,longitudinalRangeBlender:[.90,1.93],samples:stations.length,actualSectionMethod:'每站截全部 Fuselage 三角面，先按截线连通分量分离上机壳和底板，再取真实外轮廓唇边；没有按预期直线筛选顶点',straightnessTolerance:encoding,lines,shortEnds:ends,rows,failures};reports.push(r);
 console.log(JSON.stringify({source:r.source,passed:r.passed,lineDeviations:Object.fromEntries(Object.entries(lines).map(([k,v]:any)=>[k,v.maximumDeviation])),failures:failures.slice(0,8)}));
}
const candidates=reports.filter(r=>!r.baseline);
const result={passed:candidates.length>0&&candidates.every(r=>r.passed),diagnosticOnly:!!process.env.QA_MODEL,candidateModelsChecked:candidates.length,reports,limitations:['排除声明短圆端后量测整个长段；这是真实模型单位，不是制造公差','225 个真实截面、有限皮厚射线与自交检查不构成全域连续实体或制造认证','源1e-6和量化运行6e-5是几何编码精度界限；三角碰撞SAT仍为1e-9，未改动']};fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');if(!result.passed)process.exitCode=1;
