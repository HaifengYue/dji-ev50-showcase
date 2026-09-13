import {API_VERSION,ApiRequest,ApiResponse,ApiSettings,FlightControlCommand,endpointManifest,reservedNamespaces} from './contracts';

export type RouteInfo = {id:string;name:string};

/** Adapter boundary: UI code owns rendering, while this gateway owns the public API contract. */
export interface ApiRuntime<State> {
 readonly ready:boolean;
 getState():State;
 getRoutes():RouteInfo[];
 command(command:FlightControlCommand):State;
 play():void;
 pause():void;
 resume():void;
 reset():void;
 seek(seconds:number):void;
 setSpeed(speed:number):void;
 setRoute(route:string):void;
 getSettings():ApiSettings;
 updateSettings(settings:Partial<ApiSettings>):ApiSettings;
}

const failure=(request:ApiRequest,code:string,message:string):ApiResponse=>({id:request.id,operation:request.operation,ok:false,error:{code,message}});
const finiteNumber=(value:unknown,label:string)=>{
 if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`${label} must be a finite number`);
 return value;
};

export class Ev50ApiGateway<State> {
 constructor(private readonly runtime:ApiRuntime<State>) {}

 request(request:ApiRequest):ApiResponse {
  if(!request||typeof request.operation!=='string'||!request.operation)return {operation:'unknown',ok:false,error:{code:'INVALID_REQUEST',message:'operation is required'}};
  try {
   switch(request.operation){
    case 'system.health': return this.success(request,{ready:this.runtime.ready,version:API_VERSION});
    case 'system.capabilities': return this.success(request,{version:API_VERSION,endpoints:endpointManifest,reservedNamespaces});
   }
   if(!this.runtime.ready)return failure(request,'NOT_READY','EV50 is still loading');
   switch(request.operation){
    case 'flight.state': return this.success(request,this.runtime.getState());
    case 'flight.command': return this.success(request,this.runtime.command(request.payload as FlightControlCommand));
    case 'flight.play': this.runtime.play();return this.success(request,this.runtime.getState());
    case 'flight.pause': this.runtime.pause();return this.success(request,this.runtime.getState());
    case 'flight.resume': this.runtime.resume();return this.success(request,this.runtime.getState());
    case 'flight.reset': this.runtime.reset();return this.success(request,this.runtime.getState());
    case 'flight.seek': this.runtime.seek(finiteNumber((request.payload as {seconds?:unknown})?.seconds,'seconds'));return this.success(request,this.runtime.getState());
    case 'flight.speed': this.runtime.setSpeed(finiteNumber((request.payload as {speed?:unknown})?.speed,'speed'));return this.success(request,this.runtime.getState());
    case 'mission.list': return this.success(request,this.runtime.getRoutes());
    case 'mission.select': {
     const route=(request.payload as {route?:unknown})?.route;
     if(typeof route!=='string'||!route)throw new Error('route is required');
     this.runtime.setRoute(route);return this.success(request,this.runtime.getState());
    }
    case 'settings.get': return this.success(request,this.runtime.getSettings());
    case 'settings.update': {
     if(!request.payload||typeof request.payload!=='object'||Array.isArray(request.payload))throw new Error('settings payload must be an object');
     return this.success(request,this.runtime.updateSettings(request.payload as Partial<ApiSettings>));
    }
    default:return failure(request,'OPERATION_UNSUPPORTED',`Unsupported operation: ${request.operation}`);
   }
  }catch(error){return failure(request,'VALIDATION_FAILED',error instanceof Error?error.message:String(error));}
 }

 private success<T>(request:ApiRequest,data:T):ApiResponse<T>{return {id:request.id,operation:request.operation,ok:true,data};}
}
