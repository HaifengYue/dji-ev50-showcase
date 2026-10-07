"""Exact native geometry identity, independent of Blend container serialization."""
import hashlib,json,struct
import bpy

def snapshot(path):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.context.view_layer.update()
    rows={}
    for obj in bpy.data.objects:
        if obj.type not in ['MESH','EMPTY']:continue
        row={'parent':obj.parent.name if obj.parent else None,'type':obj.type,'matrixBasis':[list(r)for r in obj.matrix_basis],'matrixParentInverse':[list(r)for r in obj.matrix_parent_inverse]}
        if obj.type=='MESH':
            vertices=[tuple(v.co)for v in obj.data.vertices]
            polygons=[]
            for face in obj.data.polygons:
                points=[struct.pack('<3f',*vertices[i]).hex()for i in face.vertices]
                polygons.append(str(face.material_index)+':'+','.join(min(points[i:]+points[:i]for i in range(len(points)))))
            payload={'allVerticesIncludingUnused':sorted(struct.pack('<3f',*v).hex()for v in vertices),'orientedPolygons':sorted(polygons),'materials':[m.name if m else None for m in obj.data.materials]}
            row.update(geometrySha256=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest(),vertices=len(vertices),polygons=len(polygons))
        rows[obj.name]=row
    return rows
