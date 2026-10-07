"""Refit the current native scene's linked wing anchors. Never opens or saves files.

Call only on a disposable authoring candidate, then regenerate/bake/export and
run independent material and runtime QA. Geometry uses concept units u.
"""
import json, math
import bpy, bmesh
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree

def apply_linkage_inset(anchor_abs_x=1.10, *, stop_gap=.004,
                         minimum_static_axial_margin=.004,
                         clear_stale_animation=True):
    import kinematics
    from revision_20261007_inset.repair_drive_phase import synchronize_lead_screw_phase
    from linkage_geometry import (WING_SEAT_RADIUS, WING_SEAT_AUTHORED_DEPTH,
                                  WING_SEAT_MIN_OUTER_RISE)
    scene=bpy.context.scene
    record=json.loads(scene['annotatedMechanismJSON'])
    assert record['schema']=='transwing.annotated-mechanism.final.v1'
    assert .99 <= anchor_abs_x <= 1.12, 'This bounded helper is not a generic mechanism designer'
    old_anchor=list(record['wingAnchorRightCruise']);old_length=record['rigidRodLength']
    rig_names=['WingPivot_L','WingPivot_R','BraceRod_L','BraceRod_R','BraceSpreader',
               'Drive_ScrewRotor','Drive_MotorRotor',*['Drive_PlanetRotor_'+str(i)for i in range(3)]]
    stale=[n for n in rig_names if bpy.data.objects[n].animation_data is not None]
    if stale and not clear_stale_animation:
        raise ValueError('Clear/rebake stale rig animation before authoring: '+str(stale))
    for n in stale:bpy.data.objects[n].animation_data_clear()
    previous_rotations={s:bpy.data.objects['WingPivot_'+s].rotation_quaternion.copy()for s in ['L','R']}
    for s in ['L','R']:
        p=bpy.data.objects['WingPivot_'+s];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion((1,0,0,0))
    bpy.context.view_layer.update();kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();kinematics.update_linkage()
    def world_vertices(o):return [o.matrix_world@v.co for v in o.data.vertices]
    def bounds(o):
        v=world_vertices(o);return [[min(p[k]for p in v)for k in range(3)],[max(p[k]for p in v)for k in range(3)]]
    trees={};hits=[]
    for side,sg in [('L',-1),('R',1)]:
        wing=bpy.data.objects['Composite_wing_'+side];wing.data.calc_loop_triangles()
        tree=BVHTree.FromPolygons(world_vertices(wing),[tuple(t.vertices)for t in wing.data.loop_triangles],all_triangles=True);trees[side]=tree
        hit=tree.ray_cast(Vector((sg*anchor_abs_x,old_anchor[1],2)),Vector((0,0,-1)),4)
        if hit[0] is None or hit[1].z<=.5:raise ValueError('New wing ball has no outward upper-skin host: '+side)
        hits.append({'side':side,'pointWorld':list(hit[0]),'normalWorld':list(hit[1]),'triangle':hit[2]})
    assert abs(hits[0]['pointWorld'][2]-hits[1]['pointWorld'][2])<1e-6
    anchor=Vector((anchor_abs_x,old_anchor[1],sum(h['pointWorld'][2]for h in hits)/2+.029935374855995178))
    length=(anchor-Vector(record['bodyAnchorRightCruise'])).length
    # Preflight the requested linkage before altering its physical parts.
    saved_kinematic_anchor=kinematics.WING_ANCHOR_CRUISE;kinematics.WING_ANCHOR_CRUISE=tuple(anchor)
    travel=[kinematics.slider_at(i/4000)for i in range(4001)]
    kinematics.WING_ANCHOR_CRUISE=saved_kinematic_anchor
    minY,maxY=min(travel),max(travel);sliderY=bpy.data.objects['BraceSpreader'].matrix_world.translation.y
    stop_plans=[]
    for side in ['L','R']:
        bush=bounds(bpy.data.objects['Drive_GuideBushing_'+side]);stop=bounds(bpy.data.objects['Drive_FrontTravelStop_'+side]);seat=bounds(bpy.data.objects['Drive_FrontGuideSeat_'+side])
        delta=minY+(bush[0][1]-sliderY)-stop_gap-stop[1][1]
        static_gap=stop[0][1]+delta-seat[1][1]
        if static_gap<minimum_static_axial_margin:
            raise ValueError('New front stop fails reserved axial margin; redesign support/thread layout: '+str((side,static_gap,minimum_static_axial_margin)))
        stop_plans.append({'node':'Drive_FrontTravelStop_'+side,'additionalTranslationY':delta,'newInnerFaceY':stop[1][1]+delta,'guideBushingOffsetMin':bush[0][1]-sliderY,'guideStopDesignGap':stop_gap,'frontSupportAxialGap':static_gap})
    female=bounds(bpy.data.objects['Drive_NutInternalThread']);male=bounds(bpy.data.objects['Drive_LeadScrewThread'])
    thread_margin=minY+female[0][1]-sliderY-male[0][1]
    if thread_margin<minimum_static_axial_margin:raise ValueError('Female thread leaves reserved male-thread front margin: '+str(thread_margin))
    seat_receipts=[]
    for side,sg in [('L',-1),('R',1)]:
        proposed=Vector((sg*anchor.x,anchor.y,anchor.z));delta=proposed-bpy.data.objects['BraceWing_'+side].matrix_world.translation
        for name in ['BraceWing_'+side,'BraceBall_'+side+'_Wing','BraceBallPin_'+side+'_Wing']:
            bpy.data.objects[name].matrix_world.translation+=delta
        for obj in bpy.data.objects['BraceRod_'+side].children:
            if obj.name=='BraceRod_mesh_'+side:
                inv=obj.matrix_basis.inverted();obj.data=obj.data.copy()
                for vertex in obj.data.vertices:
                    p=obj.matrix_basis@vertex.co;p.z=.034+(p.z-.034)*(length-.068)/(old_length-.068);vertex.co=inv@p
                obj.data.update()
            elif obj.name.endswith('_Root'):obj.location.z+=length-old_length
        # Rebuild all 48 foot samples against the actual modified wing skin,
        # rather than moving an old seat into a subtly different surface.
        obj=bpy.data.objects['BraceWingSeat_'+side];inv=obj.matrix_world.inverted();n=48;base=[]
        for i in range(n):
            a=i*2*math.pi/n;x=proposed.x+WING_SEAT_RADIUS*math.cos(a);y=proposed.y+WING_SEAT_RADIUS*math.sin(a)
            hit=trees[side].ray_cast(Vector((x,y,2)),Vector((0,0,-1)),4)
            if hit[0] is None or hit[1].z<=.5:raise ValueError('Seat footprint leaves outward wing skin: '+side)
            base.append(Vector((x,y,hit[0].z-WING_SEAT_AUTHORED_DEPTH)))
        nominal=proposed.z-.0285;shoulder=max(nominal,max(p.z for p in base)+WING_SEAT_MIN_OUTER_RISE)
        if shoulder>=proposed.z-.026:raise ValueError('Seat cannot retain finite lower wall beneath upper ring: '+side)
        vertices=list(base)
        for radius,z in [(WING_SEAT_RADIUS,shoulder),(.017,proposed.z-.026),(.008,proposed.z-.024)]:
            for i in range(n):
                a=i*2*math.pi/n;vertices.append(Vector((proposed.x+radius*math.cos(a),proposed.y+radius*math.sin(a),z)))
        faces=[(r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i)for r in range(3)for i in range(n)]
        faces.extend([tuple(range(n-1,-1,-1)),tuple(3*n+i for i in range(n))])
        mesh=bpy.data.meshes.new(obj.name+'_inset_refit');mesh.from_pydata([inv@p for p in vertices],[],faces);mesh.update()
        for material in obj.data.materials:mesh.materials.append(material)
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        assert all(e.is_manifold for e in bm.edges),obj.name
        volume=bm.calc_volume(signed=True);assert volume>0,obj.name
        bm.to_mesh(mesh);bm.free();obj.data=mesh
        for poly in mesh.polygons:poly.use_smooth=True
        mesh.set_sharp_from_angle(angle=math.radians(40))
        obj['outerShoulderLift']=shoulder-nominal;obj['attachmentDepth']=.0015;obj['attachmentRadius']=WING_SEAT_RADIUS;obj['wingHost']='Composite_wing_'+side
        obj['minimumOuterWallRise']=WING_SEAT_MIN_OUTER_RISE;obj['insetSeatRefit']='2026-10-07 actual 48-point host footprint'
        seat_receipts.append({'node':obj.name,'samples':48,'footprintRadius':WING_SEAT_RADIUS,'actualEmbedDepth':WING_SEAT_AUTHORED_DEPTH,'outerShoulderLift':shoulder-nominal,'minimumOuterWallRise':WING_SEAT_MIN_OUTER_RISE,'positiveVolume':volume,'closedManifold':True,'worldAnchor':list(proposed)})
    for item in stop_plans:bpy.data.objects[item['node']].matrix_world.translation.y+=item['additionalTranslationY']
    historical_stops=record.get('frontStopRevision',[])
    for item in stop_plans:
        prior=next((v.get('translationY',0)for v in historical_stops if v.get('node')==item['node']),0)
        item['translationY']=prior+item['additionalTranslationY']
    actualTravel={'samples':4001,'minimumY':minY,'maximumY':maxY,'hoverY':travel[0],'cruiseY':travel[-1],'minimumAtUnfold':travel.index(minY)/4000,'maximumAtUnfold':travel.index(maxY)/4000,'continuousExtremaProof':False}
    record.update(wingAnchorRightCruise=list(anchor),rigidRodLength=length,actualTravel=actualTravel,frontStopRevision=stop_plans,constructionRevision='2026-10-07 further linked inset',geometryAcceptance=False,previousAdmissionNotCurrentAcceptance=True)
    record['furtherInsetRevision']={'previousWingAnchor':old_anchor,'previousRodLength':old_length,'minimumReservedStaticAxialMargin':minimum_static_axial_margin,'skinRayWitnesses':hits,'seatRefits':seat_receipts,'fullCurrentGeometryAcceptance':False,'existingSlotGeometryChanged':False,'historicalSlotAdmissionNotCurrentAcceptance':True}
    scene['annotatedMechanismJSON']=json.dumps(record);kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();bpy.context.view_layer.update();kinematics.update_linkage()
    for n in ['Drive_ScrewRotor','Drive_MotorRotor',*['Drive_PlanetRotor_'+str(i)for i in range(3)]]:bpy.data.objects[n]['sliderRestY']=travel[0]
    phase=synchronize_lead_screw_phase();record['furtherInsetRevision']['leadScrewPhase']=phase;scene['annotatedMechanismJSON']=json.dumps(record)
    kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
    for side in ['L','R']:bpy.data.objects['WingPivot_'+side].rotation_quaternion=previous_rotations[side]
    bpy.context.view_layer.update();kinematics.update_linkage()
    scene['revisionAccepted']=False;scene['furtherLinkageInset']='2026-10-07 X='+str(anchor_abs_x)
    receipt={'anchor':list(anchor),'rigidRodLength':length,'actualTravel':actualTravel,'frontStops':stop_plans,'femaleThreadFrontAxialMargin':thread_margin,'seatRefits':seat_receipts,'phase':phase,'clearedStaleRigAnimation':stale,'savedScene':False,'needsFreshBakeAndManifest':True,'geometryAccepted':False}
    return receipt

def extend_drive_front(translation_y):
    """Extend front travel without moving motor, core, rear support or fuselage.

    Call at cruise before apply_linkage_inset. Negative translation moves the
    complete front support forward and extends only the front ends of the rails
    and male helix. Feet are reconstructed against the real cavity floor.
    No file writes; this operation alone does not grant geometric acceptance.
    """
    from revision_20261007_inset.repair_drive_phase import _helix_phase
    from internal_drive import LEAD
    assert -.15 < translation_y <= 0
    bpy.context.view_layer.update()
    def vertices(o):return [o.matrix_world@v.co for v in o.data.vertices]
    def replace_mesh(o,world_vertices,faces,smooth=False):
        inv=o.matrix_world.inverted();mesh=bpy.data.meshes.new(o.name+'_extended_front');mesh.from_pydata([inv@Vector(p)for p in world_vertices],[],faces);mesh.update()
        for m in o.data.materials:mesh.materials.append(m)
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges),o.name;volume=bm.calc_volume(signed=True);assert volume>0,o.name;bm.to_mesh(mesh);bm.free();o.data=mesh
        for p in mesh.polygons:p.use_smooth=smooth
        return volume
    front_names=['Drive_FrontSupport','Drive_FrontScrewPedestal','Drive_FrontScrewBearing',*[f'Drive_FrontGuide{part}_{s}'for part in ['Pedestal','Seat']for s in ['L','R']]]
    old_y=bpy.data.objects['Drive_FrontSupport'].matrix_world.translation.y
    # Derive center from actual ring extrema; primitive object origins vary.
    old_support_pts=vertices(bpy.data.objects['Drive_FrontSupport']);old_center=(min(p.y for p in old_support_pts)+max(p.y for p in old_support_pts))/2;new_center=old_center+translation_y
    coupling=bpy.data.objects['Drive_OutputCoupling'];coupling_rear=max(p.y for p in vertices(coupling));bearing_front=min(p.y for p in vertices(bpy.data.objects['Drive_FrontScrewBearing']))+translation_y
    if bearing_front-coupling_rear<.004:raise ValueError('Forward support would approach the existing output coupling; broader drive redesign needed')
    for name in front_names:bpy.data.objects[name].matrix_world.translation.y+=translation_y
    rail_receipts=[]
    for side in ['L','R']:
        o=bpy.data.objects['Drive_GuideRail_'+side];pts=vertices(o);y0=min(p.y for p in pts);y1=max(p.y for p in pts);inv=o.matrix_world.inverted();o.data=o.data.copy()
        changed=0
        for v,p in zip(o.data.vertices,pts):
            if p.y<(y0+y1)/2:p.y+=translation_y;v.co=inv@p;changed+=1
        o.data.update();rail_receipts.append({'node':o.name,'previousFrontY':y0,'newFrontY':y0+translation_y,'rearYUnchanged':y1,'changedEndVertices':changed})
    body=bpy.data.objects['Fuselage'];body.data.calc_loop_triangles();tree=BVHTree.FromPolygons(vertices(body),[tuple(t.vertices)for t in body.data.loop_triangles],all_triangles=True);feet=[]
    for side,sg in [('L',-1),('R',1)]:
        name='Drive_FrontFoot_'+side;o=bpy.data.objects[name];base=[];surfaces=[]
        for i in range(24):
            a=2*math.pi*i/24;x=sg*.064+.007*math.cos(a);y=new_center+.007*math.sin(a);hit=tree.ray_cast(Vector((x,y,.080)),Vector((0,0,-1)),1)
            if hit[0] is None or hit[1].z<.1:raise ValueError('Forward support foot has no actual interior floor: '+side)
            surfaces.append(hit[0].z);base.append((x,y,hit[0].z-.0006))
        assert .051-max(surfaces)>.003
        pts=base+[(p[0],p[1],.051)for p in base];faces=[(i,(i+1)%24,(i+1)%24+24,i+24)for i in range(24)]+[tuple(range(23,-1,-1)),tuple(range(24,48))]
        volume=replace_mesh(o,pts,faces);feet.append({'node':name,'centerY':new_center,'embedDepth':.0006,'floorSurfaceZRange':[min(surfaces),max(surfaces)],'topZ':.051,'positiveVolume':volume,'fullFootprintSamples':24})
    bpy.context.view_layer.update()
    rotor=bpy.data.objects['Drive_ScrewRotor'];male=bpy.data.objects['Drive_LeadScrewThread'];inverse=rotor.matrix_world.inverted();phase,spread=_helix_phase(male,inverse,lead=LEAD);relative=inverse@male.matrix_world
    old_pts=[relative@v.co for v in male.data.vertices];old_min=min(p.y for p in old_pts);old_max=max(p.y for p in old_pts);start=old_min+.0038+translation_y;end=old_max-.0038
    steps=math.ceil((end-start)/LEAD*24);v=[];faces=[];profile=[(.0075,-.0038),(.0105,-.0015),(.0105,.0015),(.0075,.0038)]
    for i in range(steps+1):
        y=start+(end-start)*i/steps;a=2*math.pi*y/LEAD+phase
        for r,dy in profile:v.append(rotor.matrix_world@Vector((r*math.sin(a),y+dy,r*math.cos(a))))
    for i in range(steps):
        for k in range(4):n=(k+1)%4;faces.append((i*4+k,i*4+n,(i+1)*4+n,(i+1)*4+k))
    faces.extend([(3,2,1,0),tuple(steps*4+k for k in range(4))]);volume=replace_mesh(male,v,faces)
    receipt={'frontSupportNames':front_names,'translationY':translation_y,'oldSupportCenterY':old_center,'newSupportCenterY':new_center,'newFrontBearingToCouplingAxialGap':bearing_front-coupling_rear,'rails':rail_receipts,'feet':feet,'maleThread':{'nominalStartY':start,'nominalEndY':end,'physicalSpanY':[start-.0038,end+.0038],'preservedLead':LEAD,'originalPhaseRadians':phase,'originalPhaseScatter':spread,'positiveVolume':volume},'fuselageMeshChanged':False,'motorGearboxCoreRearSupportChanged':False,'geometryAccepted':False}
    bpy.context.scene['furtherDriveFrontExtensionJSON']=json.dumps(receipt)
    return receipt

def relieve_slot_front(extension=.055, *, join_y=.84):
    """Bounded extension of only the original rounded forward aperture tip.

    The cutter ends at Y .84, ahead of both unchanged slot roof parts (Y>=.85046).
    This preserves the existing rear straight slot and fuselage outer mold-line
    positions everywhere not removed by the local aperture extension.
    """
    from output_slot_profile import SLOT_OUTLINE, SLOT_BOTTOM_Z, SLOT_TOP_Z
    assert 0<extension<=.08 and .81<join_y<.845
    polygon=[Vector(p)for p in SLOT_OUTLINE]
    # Translate a limited copy of the original rounded forward opening. Clip
    # to the outboard tongue only; the rear cap lands inside the existing void,
    # avoiding tangential/coplanar intersection at the old aperture boundary.
    shifted=[Vector((p.x,p.y-extension))for p in polygon]
    def clip(poly,axis,bound,keep_below):
        out=[]
        for a,b in zip(poly[-1:]+poly[:-1],poly):
            ina=(a[axis]<=bound)if keep_below else(a[axis]>=bound)
            inb=(b[axis]<=bound)if keep_below else(b[axis]>=bound)
            if ina!=inb:
                t=(bound-a[axis])/(b[axis]-a[axis]);out.append(a+(b-a)*t)
            if inb:out.append(b)
        return out
    outline=clip(clip(shifted,1,join_y,True),0,.15,False)
    min_y=min(p.y for p in polygon)
    body=bpy.data.objects['Fuselage'];original_positions=[body.matrix_world@v.co for v in body.data.vertices]
    bm=bmesh.new();bm.from_mesh(body.data);before_volume=bm.calc_volume(signed=True);assert all(e.is_manifold for e in bm.edges);bm.free()
    original_roofs={s:[tuple(v.co)for v in bpy.data.objects['ActuatorSideSlot_'+s].data.vertices]for s in ['L','R']}
    cutters=[]
    body.data=body.data.copy()
    for side,sg in [('L',-1),('R',1)]:
        p=[(sg*q.x,q.y)for q in outline];n=len(p);v=[(x,y,z)for z in [SLOT_BOTTOM_Z-.000001,SLOT_TOP_Z+.000001]for x,y in p]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
        mesh=bpy.data.meshes.new('Local_slot_tip_cutter_'+side);mesh.from_pydata(v,[],faces);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges);bm.to_mesh(mesh);bm.free()
        cutter=bpy.data.objects.new('Local_slot_tip_cutter_'+side,mesh);bpy.context.scene.collection.objects.link(cutter);bpy.context.view_layer.update()
        mod=body.modifiers.new('Further inset bounded slot-front relief '+side,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
        cutters.append({'side':side,'xyOutline':p,'zSpan':[SLOT_BOTTOM_Z-.000001,SLOT_TOP_Z+.000001]})
    export_topology=repair_slot_export_topology()
    bm=bmesh.new();bm.from_mesh(body.data);nonmanifold=sum(not e.is_manifold for e in bm.edges);volume=bm.calc_volume(signed=True);bm.free()
    assert nonmanifold==0,('Local slot Boolean generated nonmanifold edges',nonmanifold)
    removed=before_volume-volume;assert 0<removed<.001,('Unexpected slot relief volume',removed)
    for s,pts in original_roofs.items():assert pts==[tuple(v.co)for v in bpy.data.objects['ActuatorSideSlot_'+s].data.vertices]
    receipt={'exportTopologyRepair':export_topology,'extensionAtOriginalTipY':extension,'joinBackToOriginalAtY':join_y,'originalTipY':min_y,'newTipY':min_y-extension,'localCutterXYBoundsRight':[[min(q.x for q in outline),min(q.y for q in outline)],[max(q.x for q in outline),max(q.y for q in outline)]],'cutters':cutters,'removedVolumeBothSides':removed,'bodyClosedManifold':True,'bodyVolumeAfter':volume,'slotRoofMeshesByteCoordinateIdentical':True,'unchangedSlotRoofMinimumY':.850460946559906,'mainOuterMoldLineNotInflated':True,'claimBoundary':'Local finite through aperture Boolean only; new boundary and remaining wall require independent geometry, sweep and visual review.'}
    bpy.context.scene['furtherSlotFrontReliefJSON']=json.dumps(receipt)
    record=json.loads(bpy.context.scene['annotatedMechanismJSON']);record.setdefault('furtherInsetRevision',{})['existingSlotGeometryChanged']=True;record['furtherInsetRevision']['slotFrontRelief']=receipt;bpy.context.scene['annotatedMechanismJSON']=json.dumps(record)
    return receipt

def apply_revised_linkage(anchor_abs_x=1.06):
    """Single tested X1.06 recipe; apply to the current unbaked native scene.

    Order: exact symmetric skin fit and stroke preview, front drive extension,
    linked balls/constant rods/48-sample seats/stops/phase, bounded front-slot
    relief, current metadata. Restores entry wing rotations, never saves files.
    This function supplies geometry, not the independent acceptance certificate.
    """
    import kinematics
    if 'furtherLinkageRevisionJSON' in bpy.context.scene:
        raise ValueError('This further-linkage recipe is already applied; reload a fresh authoring candidate before replaying')
    if abs(anchor_abs_x-1.06)>1e-9:
        raise ValueError('The bounded slot-relief geometry is validated only for X1.06; rerun geometric analysis for another value')
    original_rotations={s:bpy.data.objects['WingPivot_'+s].rotation_quaternion.copy()for s in ['L','R']}
    for s in ['L','R']:
        o=bpy.data.objects['WingPivot_'+s];o.rotation_mode='QUATERNION';o.rotation_quaternion=Quaternion((1,0,0,0))
    bpy.context.view_layer.update();kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism();kinematics.update_linkage()
    record=json.loads(bpy.context.scene['annotatedMechanismJSON']);oldAnchor=kinematics.WING_ANCHOR_CRUISE
    oldMinimum=min(kinematics.slider_at(i/4000)for i in range(4001));z=[]
    for side,sg in [('L',-1),('R',1)]:
        o=bpy.data.objects['Composite_wing_'+side];o.data.calc_loop_triangles();tree=BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],[tuple(t.vertices)for t in o.data.loop_triangles],all_triangles=True)
        hit=tree.ray_cast(Vector((sg*anchor_abs_x,oldAnchor[1],2)),Vector((0,0,-1)),4)
        if hit[0] is None or hit[1].z<=.5:raise ValueError('Cannot fit preview wing anchor to current skin: '+side)
        z.append(hit[0].z)
    preview_anchor=Vector((anchor_abs_x,oldAnchor[1],sum(z)/2+.029935374855995178))
    kinematics.WING_ANCHOR_CRUISE=tuple(preview_anchor);newMinimum=min(kinematics.slider_at(i/4000)for i in range(4001));kinematics.WING_ANCHOR_CRUISE=oldAnchor
    extension=extend_drive_front(newMinimum-oldMinimum)
    linkage=apply_linkage_inset(anchor_abs_x,stop_gap=.004,minimum_static_axial_margin=.004)
    assert abs(linkage['actualTravel']['minimumY']-newMinimum)<1e-7
    slot=relieve_slot_front(.055,join_y=.84)
    current=json.loads(bpy.context.scene['annotatedMechanismJSON']);current['furtherInsetRevision']['driveExtension']=extension;current['furtherInsetRevision']['slotFrontRelief']=slot;current['furtherInsetRevision']['existingSlotGeometryChanged']=True
    current['furtherInsetRevision']['provisionalSourceOnly']=True;bpy.context.scene['annotatedMechanismJSON']=json.dumps(current)
    kinematics._BOUND_SCENE_MECHANISM=None;kinematics.hydrate_final_mechanism()
    for s in ['L','R']:bpy.data.objects['WingPivot_'+s].rotation_quaternion=original_rotations[s]
    bpy.context.view_layer.update();kinematics.update_linkage()
    result={'schema':'transwing.further-linked-inset.native-recipe.v1','candidateX':anchor_abs_x,'previewAnchor':list(preview_anchor),'driveExtension':extension,'linkage':linkage,'slotRelief':slot,'phase':linkage['phase'],'savedScene':False,'freshBakeAndCurrentManifestRequired':True,'geometryAccepted':False}
    bpy.context.scene['furtherLinkageRevisionJSON']=json.dumps(result)
    return result

def repair_slot_export_topology():
    """Remove only exact-coordinate zero-length Boolean edges in the local cut.

    This is an explicit endpoint identification, not a distance-based weld.
    Polygon count, distinct coordinates, material flags and represented planar
    surface domains are retained; every native Float32 triangle is then checked.
    A polygon-manifold pass alone cannot detect these export degeneracies.
    """
    obj=bpy.data.objects['Fuselage'];mesh=obj.data
    def triangle_area(a,b,c):
        u=[float(b[k])-float(a[k])for k in range(3)];v=[float(c[k])-float(a[k])for k in range(3)]
        w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        return math.sqrt(sum(t*t for t in w))*.5
    def triangles():
        mesh.calc_loop_triangles();out=[]
        for t in mesh.loop_triangles:
            p=[tuple(mesh.vertices[i].co)for i in t.vertices]
            out.append({'triangle':t.index,'polygon':t.polygon_index,'vertices':list(t.vertices),'area':triangle_area(*p)})
        return out
    before_tri=triangles();before_bad=[t for t in before_tri if t['area']<=1e-18]
    before_positions={tuple(v.co)for v in mesh.vertices};before_polygon_count=len(mesh.polygons)
    before_materials=sorted((p.material_index,p.use_smooth)for p in mesh.polygons)
    def oriented_face_domains():
        from collections import Counter
        domains=[]
        for polygon in mesh.polygons:
            points=[]
            for i in polygon.vertices:
                p=tuple(mesh.vertices[i].co)
                if not points or p!=points[-1]:points.append(p)
            if len(points)>1 and points[-1]==points[0]:points.pop()
            cyclic=min(tuple(points[i:]+points[:i])for i in range(len(points)))
            domains.append((polygon.material_index,polygon.use_smooth,cyclic))
        return Counter(domains)
    before_face_domains=oriented_face_domains()
    bm=bmesh.new();bm.from_mesh(mesh);bm.verts.ensure_lookup_table();bm.verts.index_update();bm.edges.ensure_lookup_table()
    before_volume=bm.calc_volume(signed=True);before_vertices=len(bm.verts);before_edges=len(bm.edges)
    assert all(e.is_manifold for e in bm.edges), 'Refuse to conceal a pre-existing nonmanifold slot'
    exact_edges=[e for e in bm.edges if tuple(e.verts[0].co)==tuple(e.verts[1].co)]
    targetmap={};repairs=[]
    for edge in exact_edges:
        a,b=sorted(edge.verts,key=lambda v:v.index);p=tuple(a.co)
        if not(.149999<=abs(p[0])<=.216 and .722<=p[1]<=.840001 and -.074001<=p[2]<=.106001):
            bm.free();raise ValueError('Exact duplicate edge lies outside the authorized local slot relief: '+str(p))
        if len(edge.link_faces)!=2:
            bm.free();raise ValueError('Expected two finite incident faces on an exact duplicate slot edge')
        # Prevent removing a face: each incident face must retain at least three
        # distinct stored Float32 positions after the duplicate is identified.
        if any(len({tuple(v.co)for v in f.verts})<3 for f in edge.link_faces):
            bm.free();raise ValueError('Would remove a finite material face; explicit repair review required')
        targetmap[b]=a
        repairs.append({'removedVertex':b.index,'retainedVertex':a.index,'exactStoredCoordinate':list(p),'incidentFaceSizes':[len(f.verts)for f in edge.link_faces]})
    if targetmap:bmesh.ops.weld_verts(bm,targetmap=targetmap)
    assert len(bm.faces)==before_polygon_count,'Exact endpoint repair must not delete material faces'
    assert all(e.is_manifold for e in bm.edges),'Exact endpoint repair did not preserve closed topology'
    after_volume=bm.calc_volume(signed=True);after_vertices=len(bm.verts);after_edges=len(bm.edges)
    bm.to_mesh(mesh);bm.free();mesh.update()
    assert {tuple(v.co)for v in mesh.vertices}==before_positions,'No unique coordinate may move, appear or disappear'
    assert sorted((p.material_index,p.use_smooth)for p in mesh.polygons)==before_materials,'Material or smoothing identities changed'
    assert oriented_face_domains()==before_face_domains,'Any finite oriented face domain change is forbidden'
    assert abs(after_volume-before_volume)<1e-12,'Exact endpoint identification changed finite material volume'
    after_tri=triangles();after_bad=[t for t in after_tri if t['area']<=1e-18]
    if after_bad:raise ValueError('Native exported triangulation still has nonpositive/subthreshold triangles: '+str(after_bad))
    report={'method':'Explicit identification of only exact-coordinate endpoints of zero-length edges in the bounded new slot','exactEndpointRepairs':repairs,'nativeDegenerateTrianglesBefore':before_bad,'nativeDegenerateTriangleCountAfter':len(after_bad),'minimumNativeFloat32TriangleAreaAfter':min(t['area']for t in after_tri),'areaGate':1e-18,'vertexCounts':[before_vertices,after_vertices],'edgeCounts':[before_edges,after_edges],'polygonCounts':[before_polygon_count,len(mesh.polygons)],'triangleCounts':[len(before_tri),len(after_tri)],'distinctVertexCoordinatesExactlyPreserved':True,'allOrientedFaceDomainsExactlyPreservedAfterZeroEdgeCollapse':True,'maximumCoordinateDisplacement':0.,'materialAndSmoothFlagsPreserved':True,'signedVolumes':[before_volume,after_volume],'absoluteVolumeDelta':abs(after_volume-before_volume),'closedPolygonManifold':True,'distanceBasedWeldingUsed':False,'finiteMaterialFacesDeleted':False}
    obj['slotExportTopologyRepairJSON']=json.dumps(report)
    return report
