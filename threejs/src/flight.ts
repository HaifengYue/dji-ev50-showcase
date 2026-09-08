import {Euler,Quaternion,Vector3} from 'three';
export type State='IDLE'|'STARTING'|'TAKEOFF'|'HOVER'|'TRANSITION_TO_CRUISE'|'CRUISE'|'TRANSITION_TO_HOVER'|'LANDING'|'SHUTDOWN';
export type Frame={t:number;state:State;position:[number,number,number];yaw:number;pitch:number;roll:number;lift:number;cruise:number};
export const labels:Record<State,string>={IDLE:'地面待命',STARTING:'旋翼启动',TAKEOFF:'垂直起飞',HOVER:'空中悬停',TRANSITION_TO_CRUISE:'加速 · 转入巡航',CRUISE:'固定翼巡航',TRANSITION_TO_HOVER:'减速 · 转入悬停',LANDING:'垂直降落',SHUTDOWN:'旋翼停止'};
/** Sole owner of time and aircraft pose; GLB spin clips are not played concurrently. */
export class FlightController{
 time=0;playing=false;loop=true;mode:'product'|'flight'='product';state:State='IDLE';lift=0;cruise=0;liftAngle=0;cruiseAngle=0;private liftAngles:number[]=[0];private cruiseAngles:number[]=[0];
 position=new Vector3();quaternion=new Quaternion();private qa=new Quaternion();private qb=new Quaternion();private e=new Euler(0,0,0,'YXZ');
 constructor(readonly frames:Frame[],readonly duration=frames[frames.length-1].t){for(let i=1;i<frames.length;i++){this.liftAngles[i]=this.liftAngles[i-1]+(frames[i].lift+frames[i-1].lift)*.5*22/30;this.cruiseAngles[i]=this.cruiseAngles[i-1]+(frames[i].cruise+frames[i-1].cruise)*.5*22/30;}}
 seek(t:number){this.time=Math.max(0,Math.min(this.duration,Number.isFinite(t)?t:0));this.evaluate();}
 restart(){this.seek(0);}
 tick(dt:number){if(this.playing&&this.mode==='flight'){this.time+=Math.max(0,dt);if(this.time>=this.duration){if(this.loop)this.time%=this.duration;else{this.time=this.duration;this.playing=false;}}}this.evaluate();}
 evaluate(){const t=this.mode==='product'?0:this.time,i=Math.min(this.frames.length-1,Math.floor(t*30)),a=this.frames[i],b=this.frames[Math.min(i+1,this.frames.length-1)],u=Math.max(0,Math.min(1,t*30-i));
 this.position.set(a.position[0]+(b.position[0]-a.position[0])*u,a.position[1]+(b.position[1]-a.position[1])*u,a.position[2]+(b.position[2]-a.position[2])*u);
 this.qa.setFromEuler(this.e.set(a.pitch,a.yaw,a.roll,'YXZ'));this.qb.setFromEuler(this.e.set(b.pitch,b.yaw,b.roll,'YXZ'));this.quaternion.slerpQuaternions(this.qa,this.qb,u);this.state=a.state;this.lift=a.lift+(b.lift-a.lift)*u;this.cruise=a.cruise+(b.cruise-a.cruise)*u;
 const j=Math.min(i+1,this.frames.length-1);this.liftAngle=this.liftAngles[i]+(this.liftAngles[j]-this.liftAngles[i])*u;this.cruiseAngle=this.cruiseAngles[i]+(this.cruiseAngles[j]-this.cruiseAngles[i])*u;}
}
