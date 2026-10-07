"""Isolated authoring-stage coordination; no saved aircraft is an input.

Full generation is fail-closed until the main controller authorizes the CPU/run
window. This file changes orchestration and reports; the v5 root, bounded v6b
closing, compact stack and two support modules retain their own exact guards.
"""
from pathlib import Path
import hashlib,importlib,json,math
from annotated_mechanism import INTENT,ROOT,digest,slot_preflight,final_record


def preparation_status(root=ROOT):
    root=Path(root);marker=json.loads((root/'STAGING_ONLY.json').read_text())
    hook=INTENT['afterRootHook'];failures=[]
    if not marker.get('heavyBuildAuthorized') or not INTENT.get('generationAuthorized'):
        failures.append('Main-controller material/CPU execution authorization is still pending')
    if not hook.get('approved') or not hook.get('module') or not hook.get('function'):
        failures.append('Required v6b after-root closing hook is not installed/approved')
    else:
        for path,sha in [(root/'scripts'/(hook['module']+'.py'),hook['sourceSha256']),
                         (root/'scripts'/hook['dataPath'],hook['dataSha256'])]:
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
                failures.append('After-root closing input identity mismatch: '+str(path.relative_to(root)))
    for relative,expected in INTENT.get('requiredConstructionInputs',{}).items():
        path=root/'scripts'/relative
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
            failures.append('V8 construction input identity mismatch: '+relative)
    if not INTENT.get('requiredConstructionInputs'):
        failures.append('V8 construction input identity lock is not installed')
    from constructor_inputs import verify_locked_inputs
    try:
        verify_locked_inputs(root,marker.get('constructionLock','CONSTRUCTION_INPUTS.json'))
    except (ValueError,OSError,KeyError) as exc:
        failures.append('Portable construction input identity/authorization failure: '+str(exc))
    return {'prepared':not any('identity' in x or 'installed' in x for x in failures),
            'executionAllowed':not failures,'blockingReasons':failures,'inputIntentSha256':digest(),
            'fullMachineAccepted':False,'nativeGenerationRun':False}


def require_authoring_ready(root=ROOT):
    result=preparation_status(root)
    if not result['executionAllowed']:raise RuntimeError('; '.join(result['blockingReasons']))
    for relative in ('qa/native-staging','qa/frontend'):
        (Path(root)/relative).mkdir(parents=True,exist_ok=True)
    return result


def _fixed_names(side):
    return {'RootAxisStart_'+side,'RootAxisEnd_'+side,'RootHingeShaft_'+side,'RootFixedBearingPedestal_'+side,
            *('RootHingeEndcap_'+side+x for x in ('-0.148','0.148')),
            *(p+side+'_'+e for p in ('RootBearingCenter_','RootBearingFixed_','RootBearingSeal_')for e in ('Front','Rear'))}


def rebase_native_assemblies(ctx):
    import bpy,kinematics
    from mathutils import Vector,Matrix
    from layered_wing_joint import _rebase_child
    if not kinematics._AUTHORING_REFERENCE:raise ValueError('Original native authoring-reference stage required exactly once')
    from legacy_powertrain_fit import capture_for_native_context
    protected_stock_receipt=capture_for_native_context(ctx)
    old={s:kinematics.pivot_position(s).copy()for s in (-1,1)}
    previous_length=kinematics.brace_length(1);prepared=[];before_anchors={}
    for side,sign in [('L',-1),('R',1)]:
        pivot=bpy.data.objects['WingPivot_'+side]
        if (pivot.location-old[sign]).length>1e-7 or pivot.get('annotatedNativeRebased'):
            raise ValueError('Unexpected already-rebased pivot: '+side)
        if bpy.data.objects.get('BraceWingSeat_'+side) is not None:raise ValueError('Rebase/refit must precede wing seats')
        if any(n not in bpy.data.objects or bpy.data.objects[n].parent is not None for n in _fixed_names(side)):
            raise ValueError('Missing native original fixed-axis inventory: '+side)
        children=[o for o in pivot.children if not o.name.startswith('RootCarrier')]
        if any(o.matrix_parent_inverse!=Matrix.Identity(4)or o.animation_data for o in children):
            raise ValueError('Canonical unanimated direct subtrees required')
        for name in ('BraceWing_'+side,'BraceBall_'+side+'_Wing','BraceBallPin_'+side+'_Wing'):
            if bpy.data.objects[name] not in children:raise ValueError('Original ball/marker/pin trio must rebase together')
        before_anchors[sign]=list(bpy.data.objects['BraceWing_'+side].location)
        prepared.append((side,sign,pivot,children))
    kinematics.use_authoring_reference(False)
    rows=[];previous_anchors={}
    for side,sign,pivot,children in prepared:
        origin=kinematics.pivot_position(sign);shift=old[sign]-origin
        for obj in children:_rebase_child(obj,shift)
        for name in _fixed_names(side):bpy.data.objects[name].location-=shift
        ctx['DETAIL_WING_STATIONS'][side]=[(x+shift.x,y+shift.y,c,z+shift.z,r)for x,y,c,z,r in ctx['DETAIL_WING_STATIONS'][side]]
        pivot.location=origin;pivot.rotation_mode='QUATERNION';pivot.rotation_quaternion=kinematics.wing_rotation(sign,1)
        pivot['annotatedNativeRebased']=True
        previous_anchors[sign]=list(bpy.data.objects['BraceWing_'+side].location)
        rows.append({'side':side,'shift':list(shift),'directSubtrees':[o.name for o in children],
                     'fixedAxisNodes':sorted(_fixed_names(side)),'rodGeometryRefitted':False})
    bpy.context.view_layer.update()
    return {'previousLength':previous_length,'previousAnchors':previous_anchors,'beforeAnchors':before_anchors,
            'sides':rows,'completeXYZRebase':True,'nacelleExtraHingeCompensation':0,'protectedPowertrainStock':protected_stock_receipt,
            'original64PropulsionGeometryIdentityRequiresFinalIndependentVerification':True}


def apply_required_after_root_hook(ctx,receipt):
    hook=INTENT['afterRootHook']
    if receipt.get('phase')!='repair-then-moving-trim-complete':raise ValueError('V6b closing only after repair4 then trim2')
    for path,expected in [(ROOT/'scripts'/(hook['module']+'.py'),hook['sourceSha256']),
                          (ROOT/'scripts'/hook['dataPath'],hook['dataSha256'])]:
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('Final closing input identity changed')
    function=getattr(importlib.import_module(hook['module']),hook['function'])
    result=function()  # Exact source-patch admission lives in the unmodified module.
    receipt['afterRootClosing']=result;receipt['phase']='repair-trim-required-closing-complete'
    return result


def fit_and_bind_final_mechanism(ctx,rebase,root_receipt,early_slot):
    import bpy,kinematics
    from annotated_linkage import refit_annotated_anchor
    if root_receipt.get('phase')!='repair-trim-required-closing-complete':raise ValueError('Final closing cannot be skipped before skin fit')
    fit=refit_annotated_anchor(ctx,rebase['previousAnchors'],rebase['previousLength'])
    actual=[kinematics.slider_at(i/4000)for i in range(4001)]
    exact={'samples':4001,'minimumY':min(actual),'maximumY':max(actual),'hoverY':actual[0],'cruiseY':actual[-1],
           'continuousExtremaProof':False,'implementation':'actual native mathutils kinematics'}
    slot=slot_preflight(ctx['SLOT_OUTLINE'],fit['cruiseAnchorBlender'])
    if max(abs(exact['minimumY']-early_slot['travel']['minimumY']),abs(exact['maximumY']-early_slot['travel']['maximumY']))>2e-6:
        raise ValueError('Final skin fit changed early aperture/drive travel beyond the preflight admission; no automatic slot expansion')
    record=final_record(fit['cruiseAnchorBlender'],fit['rigidRodLength'],exact,root_receipt)
    record['earlySlotPreparation']=early_slot;record['actualSlotAdmission']=slot
    raw=json.dumps(record,sort_keys=True,separators=(',',':'));bpy.context.scene['annotatedMechanismJSON']=raw
    kinematics.hydrate_final_mechanism()
    ctx['WING_ANCHOR_CRUISE']=tuple(record['wingAnchorRightCruise'])
    ctx['slider_min'],ctx['slider_max']=exact['minimumY'],exact['maximumY']
    # Real cuts were already formed from the same explicit outline and early
    # planned travel; these values confirm its final native closure, not resize it.
    ctx['slot_min'],ctx['slot_max']=exact['minimumY'],exact['maximumY']
    for rel in ('assets/build/annotated-mechanism.json','assets/blender/annotated-mechanism.json','public/models/annotated-mechanism.json'):
        out=ROOT/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(record,indent=2)+'\n')
    return {'fit':fit,'finalContract':record,'finalContractSha256':hashlib.sha256(raw.encode()).hexdigest()}


def build_compact_supported_hinge(ctx):
    from compact_hinge_stack import compact_annotated_stack
    from compact_hinge_enclosure import replace_reviewed_enclosures
    from annotated_moving_support import build_annotated_moving_supports
    from annotated_fixed_support import build_annotated_fixed_supports
    return {'compactStack':compact_annotated_stack(ctx),'enclosures':replace_reviewed_enclosures(),
            'movingSupports':build_annotated_moving_supports(),'fixedSupports':build_annotated_fixed_supports(),
            'allOriginalGatesRequired':True,'wholeMachineAccepted':False}


def _mesh_geometry_digest(obj):
    import struct
    h=hashlib.sha256()
    for vertex in obj.data.vertices:h.update(struct.pack('<3d',*vertex.co))
    for face in obj.data.polygons:
        h.update(struct.pack('<I',len(face.vertices)))
        h.update(struct.pack('<%dI'%len(face.vertices),*face.vertices))
    for row in obj.matrix_basis:h.update(struct.pack('<4d',*row))
    h.update((obj.parent.name if obj.parent else '').encode())
    return h.hexdigest()


def _paint_scope_admission(report):
    contract=json.loads((ROOT/'scripts/data/annotated-paint-repair.json').read_text())
    checked=[]
    if not report['exactSourceRegionCoalescence']:raise ValueError('Bounded coating repair requires exact source-domain representation')
    for side in report['sides']:
        if side['exactRegionInconclusive']:raise ValueError('No incomplete exact coverage certificate may authorize coating removal')
        if side['unsupportedArea']>contract['maximumRemovedAreaPerSide']:raise ValueError('Coating removal exceeds the measured authorized area')
        if side['encodingClippedArea'] or side['float32CollapsedArea'] or side['float32NormalReversals']:
            raise ValueError('Supported encoding area may not be deleted or reversed')
        if not side['farTrianglesPreserved']:raise ValueError('Far coating must remain exact')
        for fragment in side['unsupportedFragments']:
            if not fragment['source'].startswith(tuple(contract['allowedSourcePrefixes'])):
                raise ValueError('Unexpected coating owner in bounded repair')
            if fragment.get('sourceDomainConstruction')!='exact direct-edge host prism partition':
                raise ValueError('Only exactly classified interface deficits may be removed')
            for point in fragment['worldPolygon']:
                for value,bounds in [(abs(point[0]),contract['absoluteXBounds']),(point[1],contract['worldYBounds']),(point[2],contract['worldZBounds'])]:
                    if not bounds[0]<=value<=bounds[1]:raise ValueError('Coating deficit leaves the specifically authorized interface domain')
        checked.append({'side':side['side'],'removedArea':side['unsupportedArea'],'inputArea':side['inputRootArea'],
                        'removedFraction':side['unsupportedArea']/side['inputRootArea'],'farTrianglesExact':True})
    return {'contractSha256':hashlib.sha256((ROOT/'scripts/data/annotated-paint-repair.json').read_bytes()).hexdigest(),
            'parts':checked,'onlyNewInterfaceDeficits':True,'hostGeometryChangePermitted':False,'encodingAreaDeletionPermitted':False}


def finish_root_paint(ctx):
    import bpy
    from root_paint_ownership import reassign_root_paint
    paint_names={p+s for p in ('Fixed_root_blue_','Wing_blue_leading_')for s in ('L','R')}
    others={o.name:_mesh_geometry_digest(o)for o in bpy.data.objects if o.type=='MESH' and o.name not in paint_names}
    report=reassign_root_paint(ctx,unsupported='clip',encoding_slivers='error',exact_regions=True,
                              unsupported_admission=_paint_scope_admission)
    after={o.name:_mesh_geometry_digest(o)for o in bpy.data.objects if o.type=='MESH' and o.name not in paint_names}
    if after!=others:raise ValueError('Paint repair changed a non-paint mesh or frame')
    report['allNonPaintGeometryAndFramesExactUnchanged']=True
    # Disclose encoded output area separately from the exact source-plane ledger.
    def encoded_area(obj):
        obj.data.calc_loop_triangles();area=0.;count=0
        for tri in obj.data.loop_triangles:
            pts=[obj.matrix_world@obj.data.vertices[i].co for i in tri.vertices]
            if any(abs(p.x)>=1.83 for p in pts):continue
            area+=(pts[1]-pts[0]).cross(pts[2]-pts[0]).length*.5;count+=1
        return {'area':area,'triangles':count,'scope':'actual stored Float32 geometry, root triangles not touching absX1.83'}
    report['encodedOutputRootArea']={name:encoded_area(bpy.data.objects[name])for name in sorted(paint_names)}
    path=ROOT/'qa/native-staging/native-paint-final-report.json';path.write_text(json.dumps(report,indent=2)+'\n')
    return {'report':str(path.relative_to(ROOT)),'reportSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'scopeAdmission':report['unsupportedAdmission'],'allNonPaintGeometryAndFramesExactUnchanged':True,
            'encodingClippedArea':0,'float32CollapsedArea':0,'units':'model u; area u^2',
            'areaLedger':[{'side':r['side'],'inputRootArea':r['inputRootArea'],'assignedRootArea':r['assignedRootArea'],
                         'transferredArea':r['transferredArea'],'removedUnsupportedArea':r['unsupportedArea'],
                         'clippingAreaResidual':r['clippingAreaResidual'],'minimumEncodedNormalDot':r['minimumEncodedSourceNormalDot'],
                         'maximumFloat32PositionError':r['maximumFloat32PositionError'],'farTrianglesPreserved':r['farTrianglesPreserved']}
                        for r in report['sides']], 'encodedOutputRootArea':report['encodedOutputRootArea'],
            'independentFinalPaintGeometryQARequired':True}


def decorate_manifest(manifest,ctx):
    final=ctx['ANNOTATED_MECHANISM']['finalContract']
    manifest['unitBoundary']=INTENT['unitBoundary']
    manifest['nativeMaterialBlockers']={'tailV7dCombinedMaterialUnverified':True,'shortCapV1CombinedMaterialAndDistanceUnverified':True,'status':'Bounded repairs are source-migrated; complete native material and motion acceptance remains independent','priorThinTailAndBlindWallDefects':'Recipes changed deliberately; no inherited closure claim'}
    manifest['nativeAnnotatedStaging']={'root':ctx['LAYERED_WING_JOINT'],
        'rebase':ctx['ANNOTATED_REBASE'],'hinge':ctx['ANNOTATED_SUPPORTED_HINGE'],
        'mechanism':final,'inputIntentSha256':digest(),'wholeMachineAccepted':False,
        'rootPaint':ctx['ANNOTATED_ROOT_PAINT'],'sourceReadIsCurrentGeneration':True}
    manifest['fairingRefinements']['finalGeometrySupersededBy']='nativeAnnotatedStaging.hinge.enclosures'
    manifest['hingeSupports']['rootContactRecordsRequireCurrentCompactSupportReconciliation']=True
    manifest['fairingRefinements']['oldContactRecordsAreNotFinalAcceptance']=True
    manifest['mechanism']['persistentContract']=final
    manifest['mechanism']['mainVerticalLayerGapNominal']=INTENT['mainVerticalLayerGapNominal']
    manifest['mechanism']['physicalGapMinimumRequirement']=INTENT['physicalGapMinimum']
    manifest['mechanism']['mainWallMinimumRequirement']=INTENT['mainWallMinimum']
    manifest['centralAttachment']['currentRootEvidence']='Common natural fixed/moving roots; no central or fixed-wing external lift'
    manifest['centralAttachment']['preserved']=['natural central fuselage/wing reference','unrelated original geometry subject to exact preservation checks']
    manifest['wingAttachmentReference']['source']='Actual final generated moving-wing top ray at inward/aft target (.97,-1.04), preserving original ball-to-skin rise'
    manifest['wingSeamTopology']['parts']=ctx['LAYERED_WING_JOINT']['mainWingSolids']
    manifest['wingSeamTopology']['scope']='Pre-repair construction checks only; final closing requires independent exact mesh acceptance'
    manifest['mechanism']['actualSlotTravelScope']='Early prepared unchanged actual aperture, checked again against final native closure; 3D material/drive clearance remains independently required'
    return manifest


_LAST_DIAGNOSTIC=None

def install_native_diagnostics():
    """Read-only failure witnesses around the unchanged existing outer-join gate."""
    import layered_wing_joint as lj
    original=lj._keep_outer_wing
    if getattr(original,'_native_diagnostic_wrapper',False):return
    def guarded(ctx,new,old,side):
        global _LAST_DIAGNOSTIC
        try:return original(ctx,new,old,side)
        except Exception:
            import bmesh,kinematics
            from mathutils import Vector
            origin=kinematics.pivot_position(side);cut_x=side*1.83-origin.x;normal=Vector((side,0,0));meshes=[]
            try:
                for obj,inside in [(new,True),(old,False)]:
                    bm=bmesh.new();bm.from_mesh(obj.data);meshes.append(bm)
                    if obj is old:bmesh.ops.transform(bm,matrix=new.matrix_basis.inverted()@old.matrix_basis,verts=list(bm.verts))
                    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=1e-7,
                         plane_co=(cut_x,0,0),plane_no=normal,clear_outer=inside,clear_inner=not inside)
                rings=[[v.co.copy()for v in bm.verts if abs(v.co.x-cut_x)<1e-6]for bm in meshes]
                witnesses=[]
                for v in rings[0]:
                    if not rings[1]:break
                    p=min(rings[1],key=lambda p:(p-v).length)
                    if (p-v).length>1e-6:witnesses.append({'newLocal':list(v),'oldNearestLocal':list(p),'distance':(p-v).length})
                _LAST_DIAGNOSTIC={'kind':'unchanged outer-ring admission failure','newNode':new.name,'oldNode':old.name,
                    'side':side,'cutLocalX':cut_x,'pivot':list(origin),'ringCounts':list(map(len,rings)),
                    'newRing':[list(v)for v in rings[0]],'oldRing':[list(v)for v in rings[1]],'rejectedWitnesses':witnesses,
                    'originalThresholdUnchanged':1e-6,'newMatrixBasis':[list(r)for r in new.matrix_basis],
                    'oldMatrixBasis':[list(r)for r in old.matrix_basis]}
            finally:
                for bm in meshes:bm.free()
            raise
    guarded._native_diagnostic_wrapper=True
    lj._keep_outer_wing=guarded


def run_stage(label,callback):
    import bpy,time,traceback
    start=time.monotonic();print('NATIVE_STAGE_BEGIN',label,flush=True)
    try:
        result=callback()
        print('NATIVE_STAGE_DONE',label,'seconds',round(time.monotonic()-start,3),flush=True)
        return result
    except Exception as exc:
        path=ROOT/'qa/native-staging'/('failure-'+label)
        report={'stage':label,'exception':repr(exc),'traceback':traceback.format_exc(),'geometryDiagnostic':_LAST_DIAGNOSTIC,'exceptionDetailedReport':getattr(exc,'report',None),
                'gatesRelaxed':False,'nativeSceneIsFailedCandidate':True,'inputIntentSha256':digest()}
        path.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(path.with_suffix('.blend')))
        print('NATIVE_STAGE_FAILED',label,'snapshot',str(path.with_suffix('.blend')),flush=True)
        raise


def prepare_native_outer_paint(ctx):
    """Recreate the native full paint stock the removed layered builder supplied.

    Earlier surface_refinements projected the initial band to coarse triangles.
    The old layered builder subsequently replaced that entire band from the
    complete station field; v5's saved-scene prototype therefore retained this
    later analytic far stock. Reproduce that native stage, not its old root.
    The temporary near-root clip is discarded by the v5 join at |X|=1.83.
    """
    import bpy
    from layered_wing_joint import _clip,_replace
    rows=[]
    for side,sign in [('L',-1),('R',1)]:
        name='Wing_blue_leading_'+side;old=bpy.data.objects[name];pivot=bpy.data.objects['WingPivot_'+side]
        before_digest=_mesh_geometry_digest(old);old.data.calc_loop_triangles();before_count=len(old.data.loop_triangles)
        stations=ctx['DETAIL_WING_STATIONS'][side][:-2]
        new=ctx['skin_band'](name+'__native_outer_stock',stations,0,.105,ctx['blue'],pivot)
        _clip(ctx,new,sign,False,False)
        _replace(old,new)
        rows.append({'node':name,'source':'this generation complete rebased station field',
                     'restoredStage':'original layered builder full analytic band replacement',
                     'preservedJoinAbsX':1.83,'oldJoinAdmissionThresholdUnchanged':1e-6,
                     'beforeProjectedStockGeometrySha256':before_digest,'beforeTriangles':before_count,
                     'afterNativeAnalyticStockGeometrySha256':_mesh_geometry_digest(old),
                     'triangles':len(old.data.polygons),'actualFarIdentityRequiresComparison':True})
    return rows
