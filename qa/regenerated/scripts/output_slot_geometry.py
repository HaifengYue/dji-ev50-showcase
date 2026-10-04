"""V22: finite rounded output apertures derived from the red-target output sweep.

The original rear narrow run is retained. Only the forward portion follows the
actual eye/neck/carriage sweep. This is a real skin cut and a clipped thin roof,
not a visual mask and not an enlarged outer mold line.
"""
import math
from mathutils import Vector

SLOT_BOTTOM_Z=-.074
SLOT_TOP_Z=.106
# Measured actual V21 hull + six actual output parts, 401 mechanism poses:
# right-side near-skin samples including proximal rod: x .142—.20514, y .79648—1.34015.
# Keep the original .049-wide aft run, with a local forward shoulder.
OUTLINE_CONTROL=[(.185,.778),(.202,.777),(.212,.789),(.216,.812),(.214,.844),(.214,.870),
 (.210,.900),(.202,.950),(.195,1.000),(.189,1.050),(.185,1.100),
 (.185,1.165),(.182,1.200),(.176,1.235),(.168,1.270),(.153,1.315),
 (.1445,1.390),(.1445,1.930),(.1373,1.9473),(.12,1.9545),
 (.1027,1.9473),(.0955,1.930),(.0955,.895),(.106,.861),(.128,.833),(.155,.811),(.175,.790)]

def rounded_outline(radius=.005,steps=4):
    result=[]
    p=[Vector(x) for x in OUTLINE_CONTROL]
    for i,b in enumerate(p):
        a,c=p[i-1],p[(i+1)%len(p)];ab=(a-b);cb=(c-b)
        d=min(radius,ab.length*.20,cb.length*.20)
        start=b+ab.normalized()*d;end=b+cb.normalized()*d
        for k in range(steps+1):
            t=k/steps;q=start*(1-t)**2+b*(2*t*(1-t))+end*t*t
            result.append((q.x,q.y))
    return result

SLOT_OUTLINE=rounded_outline()

def prism(ctx,name,sign,z0,z1,material):
    p=[(sign*x,y) for x,y in SLOT_OUTLINE];n=len(p)
    vertices=[(x,y,z) for z in (z0,z1) for x,y in p]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    if sign<0:faces=[tuple(reversed(face)) for face in faces]
    return ctx['mesh_object'](name,vertices,faces,material,smooth=False)

def _inside(x,y):
    c=False
    for (ax,ay),(bx,by) in zip(SLOT_OUTLINE,SLOT_OUTLINE[1:]+SLOT_OUTLINE[:1]):
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:c=not c
    return c

def _intersection(a,b,c,d):
    q=b-a;r=d-c;det=q.x*r.y-q.y*r.x
    if abs(det)<1e-12:return None
    v=c-a;t=(v.x*r.y-v.y*r.x)/det;s=(v.x*q.y-v.y*q.x)/det
    return t if 0<t<1 and 0<=s<=1 else None

def trim_seam(points,margin=.0035):
    """Clip only path intervals whose finite tube crosses the exact aperture."""
    runs=[];run=[]
    for pa,pb in zip(points[:-1],points[1:]):
        a,b=Vector(pa),Vector(pb);delta=b-a;cuts=[0.,1.]
        for sign in (-1,1):
            # Offset sample tubes in XY and Z, using the same rounded profile.
            for dx,dy in [(0,0),(margin,0),(-margin,0),(0,margin),(0,-margin)]:
                aa=Vector((sign*a.x+dx,a.y+dy));bb=Vector((sign*b.x+dx,b.y+dy))
                for cc,dd in zip(SLOT_OUTLINE,SLOT_OUTLINE[1:]+SLOT_OUTLINE[:1]):
                    t=_intersection(aa,bb,Vector(cc),Vector(dd))
                    if t is not None:cuts.append(t)
        for z in (SLOT_BOTTOM_Z-margin,SLOT_TOP_Z+margin):
            if abs(delta.z)>1e-12:
                t=(z-a.z)/delta.z
                if 0<t<1:cuts.append(t)
        cuts=sorted(set(cuts))
        for u,v in zip(cuts[:-1],cuts[1:]):
            m=a+delta*((u+v)/2)
            inside=SLOT_BOTTOM_Z-margin<=m.z<=SLOT_TOP_Z+margin and any(_inside(sign*m.x+dx,m.y+dy) for sign in (-1,1) for dx,dy in [(0,0),(margin,0),(-margin,0),(0,margin),(0,-margin)])
            if inside:
                if len(run)>1:runs.append(run)
                run=[];continue
            start,end=a+delta*u,a+delta*v
            if run and (Vector(run[-1])-start).length<1e-7:run.append(tuple(end))
            else:
                if len(run)>1:runs.append(run)
                run=[tuple(start),tuple(end)]
    if len(run)>1:runs.append(run)
    return runs
