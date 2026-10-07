"""移轴后的真实翼上球心、定长控制杆与共用滑架；尺寸为概念外观拟合。"""
import math
from mathutils import Vector, Quaternion, Matrix
from annotated_mechanism import INTENT, planned_anchor
REFERENCE_PIVOT = tuple(INTENT['referencePivot'])
PIVOT_X, PIVOT_Y, PIVOT_Z = INTENT['actualRightPivot']
WING_ANCHOR_CRUISE = planned_anchor()
_BOUND_SCENE_MECHANISM = None

def hydrate_final_mechanism():
    """Saved native scene is the authoritative derived mechanism on reopen."""
    global PIVOT_X,PIVOT_Y,PIVOT_Z,WING_ANCHOR_CRUISE,_BOUND_SCENE_MECHANISM
    if _AUTHORING_REFERENCE:return
    import bpy,json
    raw=bpy.context.scene.get('annotatedMechanismJSON')
    if raw is None or raw==_BOUND_SCENE_MECHANISM:return
    record=json.loads(raw)
    if record.get('schema')!='transwing.annotated-mechanism.final.v1':raise ValueError('Invalid saved mechanism contract')
    PIVOT_X,PIVOT_Y,PIVOT_Z=record['actualRightPivot']
    WING_ANCHOR_CRUISE=tuple(record['wingAnchorRightCruise'])
    _BOUND_SCENE_MECHANISM=raw
_AUTHORING_REFERENCE = False

def use_authoring_reference(enabled):
    """原有外廓先按原坐标构造；移轴重基后只使用实际机构坐标。"""
    global _AUTHORING_REFERENCE
    _AUTHORING_REFERENCE = bool(enabled)
FOLD_ANGLE = math.radians(INTENT['foldAngleDegrees'])
BEARING_OFFSET = .16
SLIDER_X, SLIDER_CRUISE_Y, SLIDER_Z = INTENT['bodyAnchorRightCruise']

def wing_axis(sign):return Vector((-sign,-1,1)).normalized()
def wing_rotation(sign,unfold):return Quaternion(wing_axis(sign),sign*FOLD_ANGLE*(1-unfold))
def pivot_position(sign):
    hydrate_final_mechanism()
    x,y,z = REFERENCE_PIVOT if _AUTHORING_REFERENCE else (PIVOT_X,PIVOT_Y,PIVOT_Z)
    return Vector((sign*x,y,z))
def brace_body(sign):return Vector((sign*SLIDER_X,SLIDER_CRUISE_Y,SLIDER_Z))
def brace_wing_local(sign):
    hydrate_final_mechanism()
    if _AUTHORING_REFERENCE:
        return Vector((-sign*.45969725856807764,.33799887117646427,.03580632777801959))
    x,y,z = WING_ANCHOR_CRUISE
    return Vector((sign*x,y,z))-pivot_position(sign)
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
