"""面积数值回归；可由系统Python或Blender内嵌Python执行。"""
import unittest
from mesh_precision import triangle_area


FALSE_ZERO_POINTS=[(.7222623825073242,-.30272045731544495,-.015031942166388035),
                   (.7219668626785278,-.3024999797344208,-.015107336454093456),
                   (.7215768098831177,-.3022089898586273,-.015206846408545971)]


class ActualTriangleArea(unittest.TestCase):
    def test_stored_skin_triangle_is_not_degenerate(self):
        self.assertAlmostEqual(triangle_area(FALSE_ZERO_POINTS),2.3570938583944597e-12,delta=1e-25)
        self.assertGreater(triangle_area(FALSE_ZERO_POINTS),1e-18)

    def test_true_collinear_triangle_stays_zero(self):
        self.assertEqual(triangle_area([(1,2,3),(2,4,6),(3,6,9)]),0)

    def test_duplicate_vertex_stays_zero(self):
        self.assertEqual(triangle_area([(1,2,3),(1,2,3),(3,6,9)]),0)

    def test_unit_triangle(self):
        self.assertEqual(triangle_area([(0,0,0),(1,0,0),(0,1,0)]),.5)

    def test_blender_false_zero_when_available(self):
        try:import bmesh
        except ImportError:self.skipTest('BMesh回归由Blender作者环境另外执行')
        bm=bmesh.new();vertices=[bm.verts.new(p)for p in FALSE_ZERO_POINTS];face=bm.faces.new(vertices)
        try:
            self.assertEqual(face.calc_area(),0)
            self.assertGreater(triangle_area([v.co for v in face.verts]),1e-18)
        finally:bm.free()


if __name__=='__main__':unittest.main()
