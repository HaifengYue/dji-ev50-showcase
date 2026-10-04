"""V24新增与保留主要实体拓扑核验；薄柔性边仍必须封闭。"""
import bpy,bmesh,os,json,hashlib,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
from mesh_precision import face_area
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'assets/blender/xp4.blend'))
prefixes=('RootFairing','Pod_wing_saddle_','Dorsal_hatch_main','Lower_fuselage_join','Tail_boom_join','CargoHinge','ControlHinge','RootBearingHousing','ControlHorn','CargoLatch','Dorsal_antenna','ActuatorSideSlot_','Drive_','Brace','Fuselage','Fixed_root_L','Fixed_root_R','Composite_wing_','Nacelle_','Motor_cowl_','Blade_L','Blade_R','RootHingeShaft_','RootCarrierMoving_','RootCarrierThrust_','RootCarrierBridge_','RootFixedBearingPedestal_','RootBearingFixed_','RootBearingSeal_','RootHingeEndcap_','Blade_hinge_','BraceRodEye_','Spinner_','V_tail_L','V_tail_R','ControlSurface_','ControlFlexure','ControlHorn_','CargoHoodShell','CargoOpeningLip','CargoLatch','Pitot_probe_','MotorFrontBearing_','Landing_wear_tip_')
rows=[]
for o in bpy.data.objects:
 if o.type!='MESH' or not o.name.startswith(prefixes):continue
 decorative_open=o.name in ('Lower_fuselage_join','Lower_fuselage_join.002')
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
 boundary=sum(e.is_boundary for e in bm.edges);bad=sum(not e.is_manifold and not e.is_boundary for e in bm.edges);zero=sum(face_area(f)<=1e-18 for f in bm.faces);vol=abs(bm.calc_volume(signed=True))
 rows.append({'name':o.name,'boundaryEdges':boundary,'nonManifoldEdges':bad,'zeroAreaTriangles':zero,'volume':vol,'topologyType':'原开放贴面装饰'if decorative_open else'闭合实体','passed':boundary==(8 if decorative_open else 0) and bad==0 and zero==0 and (decorative_open or vol>1e-10)});bm.free()
r={'modelVersion':24,'passed':all(x['passed'] for x in rows),'sourceBlendSha256':hashlib.sha256(open(bpy.data.filepath,'rb').read()).hexdigest(),'runtimeSha256':hashlib.sha256(open(ROOT+'/public/models/xp4.glb','rb').read()).hexdigest(),'parts':rows,'limitations':'拓扑不等于无干涉/强度/制造性；实际主要实体及本轮三条相邻装饰；两前接缝保留原8开边形式，不能算作结构实体。'}
json.dump(r,open(ROOT+'/qa/current/author/source-solids.json','w'),ensure_ascii=False,indent=2);print(json.dumps(r,ensure_ascii=False));assert r['passed'],[x for x in rows if not x['passed']]
