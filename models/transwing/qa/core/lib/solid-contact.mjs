// 实体包含辅助：闭合拓扑检查、BVH射线奇偶与边界距离。数值使用模型单位，未用原厂尺寸标定。
import {boundsOverlap} from './triangle-contact.mjs';
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],add=(a,b,s=1)=>a.map((v,i)=>v+s*b[i]);
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l)};
export function solidTopology(s,epsilon=1e-12){
 const ids=new Map(),vertices=[],edges=new Map(),parent=[];function id(v){const k=v.map(x=>epsilon===0?x:Math.round(x/epsilon)).join(',');if(!ids.has(k)){ids.set(k,vertices.length);vertices.push(v);parent.push(parent.length)}return ids.get(k)}
 function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}function union(a,b){a=root(a);b=root(b);if(a!==b)parent[b]=a}
 const tris=[];for(const t of s.triangles){const vs=t.vertices.map(id);tris.push({index:t.triangleIndex,vs});for(let i=0;i<3;i++){const a=vs[i],b=vs[(i+1)%3];union(a,b);const key=a<b?`${a},${b}`:`${b},${a}`;edges.set(key,(edges.get(key)??0)+1)}}
 const components=new Map();for(const t of tris){const r=root(t.vs[0]);if(!components.has(r))components.set(r,{triangleIndex:t.index,vertexIndex:0})}
 const bad=[...edges.values()].filter(n=>n!==2);return{closed:bad.length===0&&s.triangles.length>0,weldEpsilon:epsilon,vertexCount:vertices.length,edgeCount:edges.size,boundaryEdgeCount:bad.filter(n=>n===1).length,nonmanifoldEdgeCount:bad.filter(n=>n>2).length,componentCount:components.size,representatives:[...components.values()]};
}
function boxDistanceSq(p,b){return p.reduce((s,v,i)=>s+Math.max(b.min[i]-v,0,v-b.max[i])**2,0)}
export function pointTriangleDistanceSq(p,t){
 const[a,b,c]=t.vertices,ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return dot(ap,ap);
 const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return dot(bp,bp);const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const q=sub(p,add(a,ab,d1/(d1-d3)));return dot(q,q)}
 const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return dot(cp,cp);const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const q=sub(p,add(a,ac,d2/(d2-d6)));return dot(q,q)}const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0){const q=sub(p,add(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));return dot(q,q)}
 const den=1/(va+vb+vc),q=sub(p,add(add(a,ab,vb*den),ac,vc*den));return dot(q,q);
}
export function surfaceDistance(p,s){let best=Infinity,tri=null;const stack=s.bvh?[s.bvh]:[];while(stack.length){const n=stack.pop();if(boxDistanceSq(p,n.bounds)>=best)continue;if(n.indices){for(const i of n.indices){const t=s.triangles[i];if(boxDistanceSq(p,t.bounds)>=best)continue;const d=pointTriangleDistanceSq(p,t);if(d<best){best=d;tri=t.triangleIndex}}}else{const d1=boxDistanceSq(p,n.left.bounds),d2=boxDistanceSq(p,n.right.bounds);if(d1<d2)stack.push(n.right,n.left);else stack.push(n.left,n.right)}}return{distance:Math.sqrt(best),triangleIndex:tri}}
function rayBox(p,d,b,e){let min=0,max=Infinity;for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-15){if(p[i]<b.min[i]-e||p[i]>b.max[i]+e)return false;continue}let a=(b.min[i]-e-p[i])/d[i],z=(b.max[i]+e-p[i])/d[i];if(a>z)[a,z]=[z,a];min=Math.max(min,a);max=Math.min(max,z);if(min>max)return false}return true}
function rayHits(p,d,s,e){const out=[],stack=s.bvh?[s.bvh]:[];while(stack.length){const n=stack.pop();if(!rayBox(p,d,n.bounds,e))continue;if(!n.indices){stack.push(n.left,n.right);continue}for(const i of n.indices){const t=s.triangles[i],[a,b,c]=t.vertices,ab=sub(b,a),ac=sub(c,a),h=cross(d,ac),det=dot(ab,h);if(Math.abs(det)<1e-16)continue;const inv=1/det,ap=sub(p,a),u=dot(ap,h)*inv;if(u< -1e-10||u>1+1e-10)continue;const q=cross(ap,ab),v=dot(d,q)*inv;if(v< -1e-10||u+v>1+1e-10)continue;const time=dot(ac,q)*inv;if(time>e)out.push(time)}}out.sort((a,b)=>a-b);return out.filter((v,i)=>!i||v-out[i-1]>e*4)}
const directions=[[1,.3713906763541037,.6947465906068658],[-.713581,.462793,1],[.284731,1,-.529337]].map(norm);
export function pointInSolid(p,s,topology,epsilon=1e-8){
 if(!topology.closed)return{state:'unresolved-open-mesh'};
 if(!boundsOverlap({min:p,max:p},s.bounds,epsilon))return{state:'outside',distance:surfaceDistance(p,s).distance};
 const nearest=surfaceDistance(p,s);if(nearest.distance<=epsilon)return{state:'boundary',...nearest};
 const parity=directions.map(d=>rayHits(p,d,s,epsilon).length%2);if(!parity.every(x=>x===parity[0]))return{state:'unresolved-ray-disagreement',parity,...nearest};return{state:parity[0]?'inside':'outside',parity,...nearest};
}
// 无表面相交时，每个连通分量取一个真实表面顶点，足以检测完整组件的包容关系。
export function containedComponents(a,b,ta,tb){const hits=[];hits.unresolved=[];for(const [inner,outer,ti,to] of[[a,b,ta,tb],[b,a,tb,ta]]){if(!to.closed){hits.unresolved.push({container:outer.name,contained:inner.name,reason:'开放或非流形容器'});continue}for(const rep of ti.representatives){const tri=inner.triangles.find(t=>t.triangleIndex===rep.triangleIndex);const point=tri.vertices[rep.vertexIndex];const q=pointInSolid(point,outer,to);if(q.state.startsWith('unresolved'))hits.unresolved.push({container:outer.name,contained:inner.name,reason:q.state,point});if(q.state==='inside')hits.push({contained:inner.name,container:outer.name,point,depth:q.distance,sourceTriangleIndex:rep.triangleIndex,...q})}}return hits}
// 穿透深度是候选点到对方表面的内距下界，不冒充整体最小平移距离。
export function penetrationWitness(a,b,ta,tb,limit=300){let best=null;for(const[inner,outer,ti,to]of[[a,b,ta,tb],[b,a,tb,ta]]){if(!to.closed)continue;const candidates=[];for(const t of inner.triangles){if(!boundsOverlap(t.bounds,outer.bounds))continue;candidates.push(...t.vertices,t.vertices[0].map((v,i)=>(v+t.vertices[1][i]+t.vertices[2][i])/3))}const step=Math.max(1,Math.ceil(candidates.length/limit));for(let i=0;i<candidates.length;i+=step){const p=candidates[i];if(!boundsOverlap({min:p,max:p},outer.bounds))continue;const q=pointInSolid(p,outer,to);if(q.state==='inside'&&(!best||q.distance>best.depth))best={insideMesh:outer.name,sampleMesh:inner.name,point:p,depth:q.distance,nearestTriangleIndex:q.triangleIndex,method:'三方向奇偶一致的闭合实体内点；到表面的欧氏内距下界'}}}return best}
