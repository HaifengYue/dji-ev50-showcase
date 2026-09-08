"""Deterministic 60 s art-directed flight, same samples for Blender and Three.js."""
import math,json
from pathlib import Path
P=Path(__file__).resolve().parents[1]
def smooth(x):
 x=max(0,min(1,x));return x*x*(3-2*x)
def ramp_integral(x):return x**3-.5*x**4
def sample(t):
 t=max(0,min(60,t));x=z=height=yaw=pitch=roll=0.;lift=cruise=0.;state='IDLE'
 if t<3:pass
 elif t<6:state='STARTING';lift=smooth((t-3)/3)
 elif t<11:state='TAKEOFF';lift=1;height=10*smooth((t-6)/5)
 elif t<14:state='HOVER';lift=.88;height=10
 elif t<50:
  a=t-14
  if a<6:
   q=a/6;dist=6*ramp_integral(q);rate=smooth(q);state='TRANSITION_TO_CRUISE';mix=smooth(q)
  elif a<30:dist=3+(a-6);rate=1;state='CRUISE';mix=1
  else:
   q=(a-30)/6;dist=27+6*(q-ramp_integral(q));rate=1-smooth(q);state='TRANSITION_TO_HOVER';mix=1-smooth(q)
  theta=2*math.pi*dist/30;x=48*(1-math.cos(theta));z=75*math.sin(theta)
  yaw=math.atan2(48*math.sin(theta),75*math.cos(theta))
  if theta>math.pi:yaw+=2*math.pi
  height=10+16*mix;pitch=.028*math.sin((a/36)*2*math.pi)*rate;roll=-.10*rate*rate
  lift=.88*(1-mix);cruise=mix
 elif t<52:state='HOVER';height=10;lift=.88
 elif t<57:state='LANDING';height=10*(1-smooth((t-52)/5));lift=.9
 elif t<60:state='SHUTDOWN';lift=.9*(1-smooth((t-57)/3))
 # Smooth rotor transition at takeoff-to-hover boundary.
 if 10<=t<11:lift=1-.12*smooth(t-10)
 if 51<=t<52:lift=.88+.02*smooth(t-51)
 if t>=50:yaw=2*math.pi
 return {'t':round(t,6),'state':state,'position':[x,height,z],'yaw':yaw,'pitch':pitch,'roll':roll,'lift':lift,'cruise':cruise}
if __name__=='__main__':
 frames=[sample(i/30) for i in range(1801)]
 d={'duration':60,'fps':30,'coordinate_system':'Three.js Y-up, nose +Z','frames':frames}
 (P/'threejs/public').mkdir(parents=True,exist_ok=True)
 (P/'threejs/public/flight.json').write_text(json.dumps(d,separators=(',',':')))
 (P/'docs/flight_spec.json').write_text(json.dumps({'duration':60,'fps':30,'phase_boundaries':[0,3,6,11,14,20,44,50,52,57,60],'physical_simulation':False},indent=2))
 assert frames[0]['position']==frames[-1]['position']
 print('Generated 1801 deterministic samples; ground-to-ground loop.')
