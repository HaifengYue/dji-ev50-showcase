import {Euler,Quaternion,Vector3} from 'three';
import {CRUISE_ALTITUDE,obstacleCeiling,AIRCRAFT_RADIUS} from './terrain';
export type State='IDLE'|'STARTING'|'TAKEOFF'|'HOVER'|'TRANSITION_TO_CRUISE'|'CRUISE'|'TRANSITION_TO_HOVER'|'LANDING'|'SHUTDOWN';
export type Frame={t:number;state:State;position:[number,number,number];yaw:number;pitch:number;roll:number;lift:number;cruise:number};
export type FlightCommand={type:'motor'|'position'|'velocity'|'attitude';[key:string]:unknown};
export const routes={valley:{name:'山谷穿越 · 3 km',scale:12,offset:[0,0] as [number,number]},plateau:{name:'高原巡检 · 3 km',scale:16,offset:[0,0] as [number,number]},ridge:{name:'山脊环线 · 3 km',scale:10,offset:[0,0] as [number,number]}} as const;
export const labels:Record<State,string>={IDLE:'地面待命',STARTING:'旋翼启动',TAKEOFF:'垂直起飞',HOVER:'空中悬停',TRANSITION_TO_CRUISE:'加速 · 转入巡航',CRUISE:'固定翼巡航',TRANSITION_TO_HOVER:'减速 · 转入悬停',LANDING:'垂直降落',SHUTDOWN:'旋翼停止'};
/** Sole owner of time and aircraft pose; GLB spin clips are not played concurrently. */
export class FlightController{
 time=0;playing=false;loop=true;mode:'product'|'flight'='product';state:State='IDLE';lift=0;cruise=0;liftAngle=0;cruiseAngle=0;route:keyof typeof routes='valley';routeProgress=0;private command:FlightCommand|null=null;private velocity=new Vector3();private velocityPosition:Vector3|null=null;private liftAngles:number[]=[0];private cruiseAngles:number[]=[0];
 position=new Vector3();quaternion=new Quaternion();private qa=new Quaternion();private qb=new Quaternion();private e=new Euler(0,0,0,'YXZ');
 constructor(readonly frames:Frame[],readonly duration=frames[frames.length-1].t*4){for(let i=1;i<frames.length;i++){this.liftAngles[i]=this.liftAngles[i-1]+(frames[i].lift+frames[i-1].lift)*.5*22/30;this.cruiseAngles[i]=this.cruiseAngles[i-1]+(frames[i].cruise+frames[i-1].cruise)*.5*22/30;}}
 seek(t:number){this.time=Math.max(0,Math.min(this.duration,Number.isFinite(t)?t:0));this.evaluate();}
 restart(){this.clearCommand();this.seek(0);}
 setRoute(route:keyof typeof routes){if(routes[route])this.route=route;this.clearCommand();this.restart();}
 getPath(){const previous=this.time,mode=this.mode,command=this.command;this.command=null;this.mode='flight';const path:Vector3[]=[];for(let t=0;t<=this.duration;t+=.5){this.seek(t);path.push(this.position.clone());}this.time=previous;this.mode=mode;this.command=command;this.evaluate();return path;}
 clearCommand(){this.command=null;this.velocityPosition=null;}
 applyCommand(command:FlightCommand){const key=command.type==='position'?'position':command.type==='velocity'?'velocity':'quaternion';if(command.type==='motor'){if(![command.lift,command.cruise].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw new Error('Motor powers must be within [0, 1]');}else{const value=command[key];if(!Array.isArray(value)||value.length!==(command.type==='attitude'?4:3)||!value.every(v=>typeof v==='number'&&Number.isFinite(v))||(command.type==='attitude'&&value.every(v=>v===0)))throw new Error('Invalid command vector');}this.command=command;this.mode='flight';this.playing=false;if(command.type==='velocity'){const v=command.velocity as number[];if(v?.length===3){this.velocity.set(v[0],v[1],v[2]);this.velocityPosition=this.position.clone();}}this.evaluate();}
 tick(dt:number){if(this.playing&&this.mode==='flight'){this.time+=Math.max(0,dt);if(this.time>=this.duration){if(this.loop)this.time%=this.duration;else{this.time=this.duration;this.playing=false;}}}if(!this.playing&&this.command?.type==='velocity'&&this.velocityPosition)this.velocityPosition.addScaledVector(this.velocity,Math.max(0,dt));this.evaluate();}
 evaluate(){const t=this.mode==='product'?0:this.time/4,i=Math.min(this.frames.length-1,Math.floor(t*30)),a=this.frames[i],b=this.frames[Math.min(i+1,this.frames.length-1)],u=Math.max(0,Math.min(1,t*30-i));
 const rr=routes[this.route],baseX=a.position[0]+(b.position[0]-a.position[0])*u,baseY=a.position[1]+(b.position[1]-a.position[1])*u,baseZ=a.position[2]+(b.position[2]-a.position[2])*u;this.routeProgress=Math.min(1,t*4/this.duration);
 const angle=this.route==='plateau'?.65:this.route==='ridge'?-.8:0;
 const x=baseX*rr.scale,z=baseZ*rr.scale;
 this.position.set(x*Math.cos(angle)-z*Math.sin(angle),this.mode==='product'?0:Math.min(1,baseY/10)*CRUISE_ALTITUDE,x*Math.sin(angle)+z*Math.cos(angle));
 this.qa.setFromEuler(this.e.set(a.pitch,a.yaw-angle,a.roll,'YXZ'));this.qb.setFromEuler(this.e.set(b.pitch,b.yaw-angle,b.roll,'YXZ'));this.quaternion.slerpQuaternions(this.qa,this.qb,u);this.state=a.state;this.lift=a.lift+(b.lift-a.lift)*u;this.cruise=a.cruise+(b.cruise-a.cruise)*u;
 const j=Math.min(i+1,this.frames.length-1);this.liftAngle=this.liftAngles[i]+(this.liftAngles[j]-this.liftAngles[i])*u;this.cruiseAngle=this.cruiseAngles[i]+(this.cruiseAngles[j]-this.cruiseAngles[i])*u;
 if(this.command){const c=this.command;if(c.type==='position'){const p=c.position as number[];if(p?.length===3)this.position.set(p[0],p[1],p[2]);}else if(c.type==='attitude'){const q=c.quaternion as number[];if(q?.length===4)this.quaternion.set(q[0],q[1],q[2],q[3]).normalize();}else if(c.type==='motor'){this.lift=Number(c.lift??this.lift);this.cruise=Number(c.cruise??this.cruise);}else if(c.type==='velocity'&&this.velocityPosition){this.position.copy(this.velocityPosition);}
 if(this.mode==='flight'){this.position.y=Math.max(this.position.y,obstacleCeiling(this.position.x,this.position.z)+AIRCRAFT_RADIUS);if(this.velocityPosition)this.velocityPosition.copy(this.position);}}

 }
}
