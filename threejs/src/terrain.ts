/** Shared by the rendered terrain, route clearance checks and camera protection. Metres. */
export function groundHeight(x:number,z:number){
 return Math.min(1,Math.max(0,(Math.hypot(x,z)-10)/35))*(1.6+1.2*Math.sin(x*.035)*Math.cos(z*.027)+.35*Math.sin(x*.13+z*.09));
}
export function terrainNoise(x:number,z:number){
 const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 const hash=(a:number,b:number)=>{const h=Math.sin(a*127.1+b*311.7)*43758.5453;return h-Math.floor(h);};
 return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
}
export function mountainHeight(a:number,r:number,k:number){
 const u=(r-235-k*170)/(72*3.8);
 if(u<0||u>1)return -2;
 const ridge=.62+.38*(1-Math.abs(2*terrainNoise(r*Math.cos(a)*.024,r*Math.sin(a)*.024)-1));
 return (42+46*Math.sin(a*3+k*1.3)**2+26*Math.sin(a*7+k)**2+10*Math.sin(a*17+r*.038)+5*Math.sin(a*41+r*.18))*Math.sin(Math.PI*u)**1.5*ridge-2;
}
// Every rendered triangle is bounded by its vertices, whose maximum is 127 m.
// 10 m also encloses all ground vegetation. The 18 m radial buffer encloses mesh chords.
export function obstacleCeiling(x:number,z:number){
 const r=Math.hypot(x,z);
 return r<18?0:r>=217&&r<=868?127:10;
}
export const CRUISE_ALTITUDE=180;
export const AIRCRAFT_RADIUS=4;
export const CLEARANCE=30;
