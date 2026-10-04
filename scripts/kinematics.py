"""V22 红色标记球心 + 定长控制杆 + 紧凑滑架；主斜轴保持。尺寸为外观约束重建。"""
import math
from mathutils import Vector, Quaternion, Matrix
PIVOT_X, PIVOT_Y, PIVOT_Z = 1.35, -1.30, -.22
FOLD_ANGLE = 2 * math.pi / 3
BEARING_OFFSET = .16
SLIDER_X, SLIDER_Z, SLIDER_CRUISE_Y = .16, -.02, 1.90

def wing_axis(sign):return Vector((-sign,-1,1)).normalized()
def wing_rotation(sign,unfold):return Quaternion(wing_axis(sign),sign*FOLD_ANGLE*(1-unfold))
def pivot_position(sign):return Vector((sign*PIVOT_X,PIVOT_Y,PIVOT_Z))
def brace_body(sign):return Vector((sign*SLIDER_X,SLIDER_CRUISE_Y,SLIDER_Z))
def brace_wing_local(sign):return Vector((-sign*.45969725856807764,.33799887117646427,.03580632777801959))
def brace_length(sign):return (pivot_position(sign)+brace_wing_local(sign)-brace_body(sign)).length

def slider_y(wing_world,sign=1):
    r2=brace_length(sign)**2-(wing_world.x-sign*SLIDER_X)**2-(wing_world.z-SLIDER_Z)**2
    if r2<=0:raise ValueError('Rigid linkage has no real rear-slider closure')
    return wing_world.y+math.sqrt(r2)

def slider_at(unfold):return slider_y(pivot_position(1)+wing_rotation(1,unfold)@brace_wing_local(1))
def rod_rotation(delta,reference_normal):
    z=delta.normalized();y=reference_normal-z*reference_normal.dot(z)
    if y.length<1e-6:raise ValueError('Rod bearing reference is singular')
    y.normalize();x=y.cross(z).normalized()
    return Matrix((x,y,z)).transposed().to_quaternion()

def update_linkage():
    import bpy
    bpy.context.view_layer.update()
    yr=slider_y(bpy.data.objects['BraceWing_R'].matrix_world.translation,1)
    yl=slider_y(bpy.data.objects['BraceWing_L'].matrix_world.translation,-1)
    if abs(yr-yl)>1e-5:raise ValueError('Left/right spreader closure disagrees')
    bpy.data.objects['BraceSpreader'].location=(0,(yr+yl)/2,SLIDER_Z)
    bpy.context.view_layer.update()
    for side in ('L','R'):
        a=bpy.data.objects['BraceBody_'+side].matrix_world.translation;b=bpy.data.objects['BraceWing_'+side].matrix_world.translation
        rod=bpy.data.objects['BraceRod_'+side];rod.location=a;rod.rotation_mode='QUATERNION'
        rod.rotation_quaternion=rod_rotation(b-a,bpy.data.objects['WingPivot_'+side].matrix_world.to_3x3()@Vector((0,0,1)));rod.scale=(1,1,1)
    from internal_drive import update_internal_drive
    update_internal_drive()
    bpy.context.view_layer.update()

def gltf_vector(v):return [v[0],v[2],-v[1]]
