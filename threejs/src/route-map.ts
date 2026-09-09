import {Vector3} from 'three';
export function routeMap(canvas:HTMLCanvasElement){
 const ctx=canvas.getContext('2d')!;let points:Vector3[]=[];let scale=1,cx=0,cz=0;
 const project=(p:Vector3)=>[90+(p.x-cx)*scale,46-(p.z-cz)*scale];
 return {
  setPath(path:Vector3[]){points=path;const xs=path.map(p=>p.x),zs=path.map(p=>p.z);const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);cx=(minX+maxX)/2;cz=(minZ+maxZ)/2;scale=Math.min(152/Math.max(1,maxX-minX),66/Math.max(1,maxZ-minZ));},
  draw(progress:number,position:Vector3){ctx.clearRect(0,0,180,92);ctx.strokeStyle='#203f4b';ctx.lineWidth=.5;for(let i=18;i<180;i+=18){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,92);ctx.stroke();}const stroke=(end:number,color:string)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();points.slice(0,end).forEach((p,i)=>{const [x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();};stroke(points.length,'#718793');stroke(Math.floor(progress*(points.length-1))+1,'#d4fa79');const [x,y]=project(position);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();if(points.length){const [hx,hy]=project(points[0]);ctx.strokeStyle='#d4fa79';ctx.strokeRect(hx-4,hy-4,8,8);}ctx.fillStyle='#aec3ce';ctx.font='9px sans-serif';ctx.fillText('N ↑   起降点 □',7,11);}
 };
}
