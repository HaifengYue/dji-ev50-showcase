/** 直接与导出三角面求交，按真实截面连通分量恢复槽边；不依赖生成器名义切刀。 */
import * as T from 'three';
export function section(snapshot:any,station:number) {
 const points=new Map<string,number[]>(),adjacency=new Map<string,Set<string>>(),segments=new Map<string,any>();
 const buckets=new Map<string,{id:string,p:number[]}[]>();let nextId=0;
 const key=(p:number[])=>{const q=p.map(x=>Math.floor(x/1e-12));for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const r of buckets.get([q[0]+dx,q[1]+dz].join(','))??[])if(Math.hypot(p[0]-r.p[0],p[1]-r.p[1])<=1e-12)return r.id;const id=String(nextId++),bucket=q.join(',');buckets.set(bucket,[...(buckets.get(bucket)??[]),{id,p}]);return id;};
 for(const tri of snapshot.triangles){
  const ps:number[][]=[];
  for(let i=0;i<3;i++) {const a=tri.vertices[i],b=tri.vertices[(i+1)%3],da=-a[2]-station,db=-b[2]-station;
   if(Math.abs(da)<1e-12)ps.push([a[0],a[1]]);
   if(da*db<0){const t=da/(da-db);ps.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  const unique=[...new Map(ps.map(p=>[key(p),p])).values()];if(unique.length!==2)continue;
  const ids=unique.map(key);if(ids[0]===ids[1])continue;
  const id=ids.slice().sort().join('/');if(segments.has(id))continue;
  segments.set(id,{points:unique,triangleIndex:tri.triangleIndex});
  ids.forEach((k,i)=>{points.set(k,unique[i]);if(!adjacency.has(k))adjacency.set(k,new Set());adjacency.get(k)!.add(ids[1-i]);});
 }
 const visited=new Set<string>(),components:any[]=[];
 for(const k of points.keys()){if(visited.has(k))continue;const queue=[k],ids:string[]=[];visited.add(k);
  for(let i=0;i<queue.length;i++){const q=queue[i];ids.push(q);for(const n of adjacency.get(q)??[])if(!visited.has(n)){visited.add(n);queue.push(n);}}
  const ps=ids.map(k=>points.get(k)!);components.push({points:ps,bounds:[0,1].map(i=>[Math.min(...ps.map(p=>p[i])),Math.max(...ps.map(p=>p[i]))]),closed:ids.every(k=>adjacency.get(k)!.size===2),degrees:[...new Set(ids.map(k=>adjacency.get(k)!.size))]});
 }
 return {station,segments:[...segments.values()],components};
}
export function lineFit(points:number[][]){
 const mean=[0,1,2].map(k=>points.reduce((s,p)=>s+p[k],0)/points.length);
 // 纵向坐标本身参数化直线；同时测横/竖残差，再给真实三维正交距离。
 const vary=points.reduce((s,p)=>s+(p[1]-mean[1])**2,0);
 const slope=[0,1,2].map(k=>points.reduce((s,p)=>s+(p[1]-mean[1])*(p[k]-mean[k]),0)/vary);
 const direction=new T.Vector3(...slope).normalize(),origin=new T.Vector3(...mean);
 const deviations=points.map(p=>new T.Vector3(...p).sub(origin).cross(direction).length());
 return {points:points.length,origin:origin.toArray(),direction:direction.toArray(),maximumDeviation:Math.max(...deviations),rmsDeviation:Math.sqrt(deviations.reduce((s,x)=>s+x*x,0)/deviations.length)};
}

/** 完整线段求交：包括顶点命中及共线段端点，再以原材料边界1e-8去重。 */
export function sectionRayHits(s:any,axis:0|1,value:number){
 const hits:number[]=[];for(const e of s.segments){const [a,b]=e.points,da=a[axis]-value,db=b[axis]-value;
  if(Math.abs(da)<=1e-12)hits.push(a[1-axis]);if(Math.abs(db)<=1e-12)hits.push(b[1-axis]);
  if(da*db<0){const t=da/(da-db);hits.push(a[1-axis]+t*(b[1-axis]-a[1-axis]));}
 }hits.sort((a,b)=>a-b);return hits.filter((v,i)=>!i||v-hits[i-1]>1e-8);
}
export const vertical=(s:any,x:number)=>sectionRayHits(s,0,x);
export const horizontal=(s:any,z:number)=>sectionRayHits(s,1,z);
