"""保边精确三角化构造回归；不能替代真实资产全索引自交验收。"""
import sys
import json
from pathlib import Path
import bmesh
sys.path.insert(0,str(Path(__file__).resolve().parent))
from wing_surface_repair import triangulate_patch_face, closest_distance, simplify_slivers
from mathutils import Matrix
from types import SimpleNamespace
from mesh_precision import face_area


def polygon_case(label, points, area, reject=False):
    bm=bmesh.new()
    vv=[bm.verts.new(p)for p in points]
    original={tuple(v.co)for v in bm.verts}
    f=bm.faces.new(vv)
    boundary={frozenset((tuple(e.verts[0].co),tuple(e.verts[1].co)))for e in bm.edges}
    failed=False
    try:triangulate_patch_face(bm,f)
    except ValueError:failed=True
    assert failed==reject,label
    assert {tuple(v.co)for v in bm.verts}==original,label
    if not reject:
        assert len(bm.faces)==len(points)-2,label
        assert all(face_area(f)>1e-18 for f in bm.faces),label
        actual={frozenset((tuple(e.verts[0].co),tuple(e.verts[1].co)))for e in bm.edges if len(e.link_faces)==1}
        assert boundary==actual,label
        assert abs(sum(face_area(f)for f in bm.faces)-area)<1e-10,label
    bm.free()
    return {'case':label,'passed':True,'rejectionExpected':reject}

rows=[]
rows.append(polygon_case('共线边界中点必须保留',[(0,0,0),(.5,0,0),(1,0,0),(1,1,0),(0,1,0)],1))
rows.append(polygon_case('反向边界保持',list(reversed([(0,0,0),(.5,0,0),(1,0,0),(1,1,0),(0,1,0)])),1))
rows.append(polygon_case('凹轮廓与边点不能跨越耳',[(0,0,0),(2,0,0),(2,2,0),(1,1,0),(0,2,0)],3))
rows.append(polygon_case('极薄正面积不按零过滤',[(0,0,0),(1,0,0),(1,1e-8,0)],5e-9))
rows.append(polygon_case('真实折返多边形拒绝',[(0,0,0),(1,1,0),(0,1,0),(1,0,0)],0,reject=True))
assert abs(closest_distance((2,0,0),(0,0,0),(1,0,0),(0,1,0))-1)<1e-12
rows.append({'case':'有限三角距离不误用无限平面','passed':True})
# 来自真实生成步骤的近共线末片及其完整一环，保留全部11点/11面。
for perturb in (False,True):
    fixture=json.loads((Path(__file__).resolve().parent/'data/wing-post-triangulation-regression.json').read_text())
    if perturb:
        i=fixture['vertices'].index(fixture['candidateEdge'][1]);fixture['vertices'][i][2]+=.001
    bm=bmesh.new();vv=[bm.verts.new(p)for p in fixture['vertices']]
    for tri in fixture['triangles']:bm.faces.new([vv[i]for i in tri])
    def boundary():return {frozenset(tuple(v.co)for v in e.verts)for e in bm.edges if len(e.link_faces)==1}
    boundary_before=boundary();count=len(bm.faces)
    assert all(face_area(f)>1e-18 for f in bm.faces),'实际微缝壁不是零面积面'
    records=simplify_slivers(bm,SimpleNamespace(matrix_basis=Matrix.Identity(4),parent=None))
    assert boundary_before==boundary(),'局部重接不得删除真实外围边'
    assert all(face_area(f)>1e-18 for f in bm.faces)
    if perturb:
        assert not records and len(bm.faces)==count,'宏观偏离不能按微片合并'
    else:
        target={tuple(p)for p in fixture['problemTriangle']}
        assert len(records)==1 and len(bm.faces)==count-2
        assert not any({tuple(v.co)for v in f.verts}==target for f in bm.faces)
    bm.free();rows.append({'case':'真实末三角一环有界重接'if not perturb else'超界实际形变不得合并','passed':True})
result={'passed':True,'cases':rows,'count':len(rows),'claimBoundary':'只验证构造函数的已知正负样例；实际网格仍需独立精确门'}
print(json.dumps(result,ensure_ascii=False))
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []
if args:Path(args[0]).write_text(json.dumps(result,ensure_ascii=False,indent=2))
