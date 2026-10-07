"""Synchronize the existing screw helix to the saved linkage's new zero pose.

Only the male thread's azimuth in its own rotor frame changes. The screw axis,
axial span, lead, radii, female thread, guide, slider, and runtime kinematics stay
unchanged. This is a conceptual mesh phase correction, not manufacturing proof.
The operation is idempotent and never saves the scene or modifies source files.
"""
import math
import bpy
from mathutils import Vector, Matrix


def _helix_phase(obj, frame_inverse, axis_z=0.0, lead=.032):
    """Read the 4-corner profile rings made by internal_drive.thread()."""
    verts = obj.data.vertices
    if len(verts) < 8 or len(verts) % 4:
        raise ValueError('Expected the original four-vertex trapezoid helix: '+obj.name)
    transform = frame_inverse @ obj.matrix_world
    values = []
    for i in range(0, len(verts), 4):
        ring = [transform @ verts[i+j].co for j in range(4)]
        # The root/crest axial offsets are symmetric around the section center.
        y_center = sum(p.y for p in ring) / 4
        angles = [math.atan2(p.x, p.z-axis_z) for p in ring]
        angle = math.atan2(sum(math.sin(a) for a in angles),
                           sum(math.cos(a) for a in angles))
        values.append(math.remainder(angle-2*math.pi*y_center/lead, 2*math.pi))
    phase = math.atan2(sum(math.sin(a) for a in values),
                       sum(math.cos(a) for a in values))
    spread = max(abs(math.remainder(a-phase, 2*math.pi)) for a in values)
    if spread > 1e-4:
        raise ValueError('Mesh is not the expected constant-lead helix: '+obj.name+' '+str(spread))
    return phase, spread


def synchronize_lead_screw_phase():
    """Return a small audit receipt after rotating only male-thread vertices.

    Call after the saved annotatedMechanismJSON is final. Existing runtime
    update_internal_drive remains the sole actuator transform implementation.
    """
    import kinematics
    from internal_drive import LEAD
    kinematics.hydrate_final_mechanism()
    kinematics.update_linkage()
    bpy.context.view_layer.update()
    rotor = bpy.data.objects['Drive_ScrewRotor']
    male = bpy.data.objects['Drive_LeadScrewThread']
    female = bpy.data.objects['Drive_NutInternalThread']
    inverse = rotor.matrix_world.inverted()
    male_phase, male_spread = _helix_phase(male, inverse, lead=LEAD)
    female_phase, female_spread = _helix_phase(female, inverse, lead=LEAD)
    correction = math.remainder(female_phase-male_phase-math.pi, 2*math.pi)
    relative = inverse @ male.matrix_world
    before_y = [(relative @ v.co).y for v in male.data.vertices]
    before_radius = [math.hypot((relative @ v.co).x, (relative @ v.co).z)
                     for v in male.data.vertices]
    if abs(correction) > 1e-7:
        transform = relative.inverted() @ Matrix.Rotation(correction, 4, 'Y') @ relative
        male.data = male.data.copy()
        for vertex in male.data.vertices:
            vertex.co = transform @ vertex.co
        male.data.update()
    after_y = [(relative @ v.co).y for v in male.data.vertices]
    after_radius = [math.hypot((relative @ v.co).x, (relative @ v.co).z)
                    for v in male.data.vertices]
    new_phase, new_spread = _helix_phase(male, inverse, lead=LEAD)
    residual = math.remainder(female_phase-new_phase-math.pi, 2*math.pi)
    receipt = {
        'schema': 'transwing.lead-screw-phase-sync.v1',
        'operation': 'Rotate only male helix vertices about existing screw-rotor local Y axis',
        'node': male.name, 'rotationRadians': correction,
        'rotationDegrees': math.degrees(correction),
        'lead': LEAD, 'runtimeHoverY': kinematics.slider_at(0),
        'currentSliderY': bpy.data.objects['BraceSpreader'].location.y,
        'phaseResidualRadians': residual,
        'maximumHelixPhaseScatterRadians': max(male_spread, female_spread, new_spread),
        'maximumAxialCoordinateDelta': max(abs(a-b) for a,b in zip(after_y,before_y)),
        'maximumRadiusDelta': max(abs(a-b) for a,b in zip(after_radius,before_radius)),
        'maleAxialSpanRotorLocalY': [min(after_y), max(after_y)],
        'sourceGeometryOnlyCopy': True,
        'savedScene': False,
    }
    assert abs(residual) < 1e-5, receipt
    assert receipt['maximumAxialCoordinateDelta'] < 1e-7, receipt
    assert receipt['maximumRadiusDelta'] < 1e-7, receipt
    male['insetPhaseSync'] = '2026-10-07: helix-only zero synchronization'
    return receipt
