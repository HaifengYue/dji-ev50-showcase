"""按实际存储顶点以Python双精度量三角面积，不改变任何验收门槛。

BMesh calc_area()的内部单精度投影可能把合法细三角算成零。
这里先相减再叉积，和独立GLB Float64几何门使用同一实际量。
"""
import math


def triangle_area(points):
    a,b,c=[tuple(float(v)for v in p)for p in points]
    u=[b[i]-a[i]for i in range(3)];v=[c[i]-a[i]for i in range(3)]
    cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
    return math.sqrt(sum(x*x for x in cross))*.5


def face_area(face):
    # 正式三角验收之前已明确三角化；早期非三角多边面保留原算子。
    if len(face.verts)!=3:return face.calc_area()
    return triangle_area([v.co for v in face.verts])
