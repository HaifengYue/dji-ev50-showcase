"""V24截面函数单元检查；真实材料截面、闭合和全行程由独立QA另验。"""
import ast
import math
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent

def functions():
    path=ROOT/'scripts/generate_transwing.py';tree=ast.parse(path.read_text());base={'math':math}
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in('catmull','section_at','fuselage_point')]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),base)
    stations=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='body_sections'for t in n.targets)and isinstance(n.value,ast.List))
    base['body_dense']=base['catmull'](stations,5)
    path=ROOT/'scripts/output_slot_profile.py';tree=ast.parse(path.read_text());scope={'math':math}
    nodes=[n for n in tree.body if(isinstance(n,ast.FunctionDef)and n.name in('smooth','configure'))or(isinstance(n,ast.Assign)and all(isinstance(t,ast.Name)and t.id!='SLOT_OUTLINE'for t in n.targets))]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),scope)
    point,config=scope['configure'](base['fuselage_point'],base['section_at'],base['body_dense'])
    return base,scope,point,config

class StraightSlot(unittest.TestCase):
    def setUp(self):self.base,self.scope,self.point,self.config=functions()
    def test_design_lines(self):
        for i in range(1001):
            y=.9+1.03*i/1000;t=i/1000
            for inner,alpha in[(True,self.scope['INNER_ALPHA']),(False,self.scope['OUTER_ALPHA'])]:
                a,b=self.config['innerLipRightEndpoints'if inner else'outerLipRightEndpoints']
                expected=[a[j]+(b[j]-a[j])*t for j in range(3)]
                for sign in(-1,1):
                    p=self.point(y,3*math.pi/2+sign*alpha)
                    self.assertLess(max(abs(p[j]-expected[j]*(sign if j==0 else 1))for j in range(3)),1e-12)
    def test_upper_and_outside_exact(self):
        for y in[-2.1,-1.,0.,.76416,2.1,2.3]:
            for i in range(65):
                for offset in(0.,-.006):
                    a=i*2*math.pi/64;self.assertEqual(self.point(y,a,offset),self.base['fuselage_point'](y,a,offset))
        for y in[.8,.9,1.4,1.9,2.05]:
            for i in range(33):
                a=i*math.pi/32
                self.assertEqual(self.point(y,a),self.base['fuselage_point'](y,a))
    def test_original_central_samples_exact(self):
        for y in[.8,.83,.99,1.4,1.93,1.982]:
            for i in range(257):
                a=i*2*math.pi/256;old=self.base['fuselage_point'](y,a)
                if abs(old[0])<=.092:
                    for offset in(0.,-.006):self.assertEqual(self.point(y,a,offset),self.base['fuselage_point'](y,a,offset))
    def test_declared_space_is_not_offset_parameter(self):
        self.assertEqual(self.config['protectedCentralFloorMaximumAbsX'],.074)
        self.assertEqual(self.config['outerProfileBlendCoreAbsX'],.092)
        self.assertEqual(self.config['nominalVerticalLipSeparation'],.055)

if __name__=='__main__':unittest.main()
