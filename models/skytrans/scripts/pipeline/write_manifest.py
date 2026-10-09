"""Bind generated model metadata to the current native baseline and actual output hashes."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[2];STAGE=ROOT/'build/model'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
c=json.loads((ROOT/'scripts/data/current-model-contract.json').read_text());m=json.loads((ROOT/'../../threejs/public/skytrans/models/manifest.json').read_text());v=json.loads((STAGE/'model-validation.json').read_text());receipt=json.loads((STAGE/'BAKE_RECEIPT.json').read_text());a=m['annotationRevision']
a.update(sourceCandidate=c['source'],sourceCandidateSha256=c['sourceSha256'],rebuildMode=c['rebuildMode'],historicalProceduralReconstruction=False,nativeBaselineContract='scripts/data/current-model-contract.json')
for key in ['old82And136ConstructionInputsUnchanged','baselineManifest','currentConstructionReceiptSha256','old171ConstructionInputsUnchanged','baselineManifestSha256','frozenMGeometryReference','frozenMGeometryReferenceSha256','sourceConstructionReceipt','sourceConstructionReceiptSha256']:a.pop(key,None)
a['currentEvidenceRoot']='build/model';a['historicalEvidenceLocation']=c['historicalArchive'];m['internalDrive']['historicalContactAndCavityRecords']=c['historicalArchive'];m.pop('stagedEvidence',None)
g=c['currentGeometry'];link=g['linkage'];drive=g['driveExtension'];slot=g.get('slotRelief') or g['historicalSlotRelief'];motor=g['motor']
a.update(id='2026-10-07-v27-inset-integrated-b-annotation-refined',currentRightPivotBlender=c['mechanism']['actualRightPivot'],currentRightWingBallBlenderCruise=c['mechanism']['wingAnchorRightCruise'],scope='Further linked inset to |X|=.88, actual bounded rounded slot, preserved corner normals and bounded PBR finish')
m['mechanism'].update(persistentContract=c['mechanism'],currentRigidRodLength=link['rigidRodLength'],actualSlotTravel=link['actualTravel'],currentLinkedInsetTargetAbsX=g['anchorAbsX'])
m['internalDrive'].update(maleThreadGeometryPhaseCorrection=link['phase'],fixedLayoutAndStopGeometryPreserved=False,fixedDriveLayoutPreservedExceptExplicitFrontStops=False,fixedDriveLayoutPreservedExceptExplicitFrontSupportGuideAndThreadExtension=False,motorGearboxTranslatedY=motor['translationY'],coreRearEndPreserved=motor['coreRearEndUnchanged'],frontSupportAndFeetRevision=drive)
m['internalDrive']['currentLayout']={'frontSupportCenterY':drive['newSupportCenterY'],'guideSpan':[drive['rails'][0]['newFrontY'],drive['rails'][0]['rearYUnchanged']],'screwThreadSpan':[drive['maleThread']['nominalStartY'],drive['maleThread']['nominalEndY']],'physicalThreadMaterialSpan':drive['maleThread']['physicalSpanY'],'lead':drive['maleThread']['preservedLead'],'motorGearboxCoreRearSupportChanged':True,'rearSupportPreserved':True,'motorGearboxTranslationY':motor['translationY'],'source':'Explicit current authored geometry receipt'}
ys=[p[1]for p in slot['outlineRightXY']];xs=[p[0]for p in slot['outlineRightXY']]
current_slot={'method':slot['method'],'joinBackToOriginalAtY':slot['segmentedEnvelope']['cutClippedAtY'],'newTipY':min(ys),'localCutterXYBoundsRight':[[min(xs),max(xs)],[min(ys),max(ys)]],'removedVolumeBothSides':slot['removedVolumeBothSides'],'bodyClosedManifold':slot['topology']['closedPolygonManifold'],'slotRoofMeshesByteCoordinateIdentical':slot['roofVerticesUnchanged'],'unchangedSlotRoofMinimumY':slot['roofMinimumY'],'mainOuterMoldLineNotInflated':not slot['outerMoldLineInflation'],'minimumFacetedMargin':slot['minimumFacetedMargin'],'segmentedEnvelope':slot['segmentedEnvelope'],'normalTransfer':slot['normalTransfer'],'claimBoundary':'Bounded finite-pose union with actual margin; not a global minimum or continuous-motion proof'}
m['internalDrive']['currentFrontSlotRelief']=current_slot;m['mechanism']['currentSlotFrontRelief']=current_slot
m['internalDrive']['frontStopRevisionBlender']=link['frontStops']
travel=[link['actualTravel']['minimumY'],link['actualTravel']['maximumY']]
m['mechanism']['sliderTravel']=travel;m['internalDrive']['stroke']=travel;m['internalDrive']['motionContractRevision']=a['id']
anchor=c['mechanism']['wingAnchorRightCruise'];pivot=c['mechanism']['actualRightPivot']
for side,sign in [('L',-1),('R',1)]:
 m['mechanism']['sides'][side]['braceLength']=link['rigidRodLength']
 m['mechanism']['sides'][side]['wingAnchorLocal']=[sign*(anchor[0]-pivot[0]),anchor[2]-pivot[2],-(anchor[1]-pivot[1])]
m['internalDrive']['actualFrontStopMeshesBlender']=[{'side':row['node'][-1],'stopCenterBlenderY':row['newInnerFaceY']-.004,'innerFaceBlenderY':row['newInnerFaceY'],'stopBlenderYBounds':[row['newInnerFaceY']-.008,row['newInnerFaceY']],'hoverGap':travel[0]+row['guideBushingOffsetMin']-row['newInnerFaceY'],'method':'Independent current native linkage receipt, checked against actual runtime mesh bounds'}for row in link['frontStops']]
m['internalDrive']['actualMinimumFrontStopBushingGap']=min(row['hoverGap']for row in m['internalDrive']['actualFrontStopMeshesBlender'])
m['internalDrive']['currentFrontSlotRelief']['exportTopologyRepair']=slot['topology']
if 'transverseOutputRefinement' in g:
 refinement=g['transverseOutputRefinement'];slot_now=refinement['slot'];old_summary=m['internalDrive']['currentFrontSlotRelief']
 old_summary['supersededBy']='2026-10-08 restored lower shell and actual slanted-output sweep'
 m['internalDrive']['historicalFrontSlotRelief']=old_summary
 current_slot={'revision':'2026-10-08','method':slot_now['sweptSlot']['method'],'bodyClosedManifold':slot_now['closedManifold'],'minimumRequiredClearance':slot_now['sweptSlot']['minimumRequiredClearance'],'reconstruction':slot_now['reconstruction'],'sweptSlot':slot_now['sweptSlot'],'exactEndpointRepair':slot_now['exactEndpointRepair'],'surfaceFinish':slot_now['surfaceFinish'],'netVolumeDelta':slot_now['netVolumeDelta'],'claimBoundary':'Same-native bounded shell reconstruction and actual output swept clearance; final same-SHA finite checks required; not continuous or manufacturing certification'}
 m['internalDrive']['currentFrontSlotRelief']=current_slot;m['mechanism']['currentSlotFrontRelief']=current_slot
 if 'straightFuselageSlot' in m:m['historicalStraightFuselageSlot']=m.pop('straightFuselageSlot')
 m['internalDrive']['currentTransverseOutput']=refinement['linkage'];m['internalDrive']['currentTransverseOutput']['connections']=refinement['connections']
 if 'slotEnvelopeBlender' in m['mechanism']:m['mechanism']['historicalSlotEnvelopeBlender']=m['mechanism'].pop('slotEnvelopeBlender')
 m['mechanism']['currentOutputSweepBlender']=slot_now['sweptSlot']
 cavity=m['internalDrive'].get('cavity',{})
 if 'actualOutputSlotEnvelope' in cavity:cavity['historicalOutputSlotEnvelope']=cavity.pop('actualOutputSlotEnvelope')
 cavity['currentOutputSweepBlender']=slot_now['sweptSlot']
 m['internalDrive']['loweredLayout']['output']='Extended slanted straight outputs; original transverse crossbeam endpoints retained; body balls relocated to absX=.28'
 a.update(id='2026-10-08-annotated-surface-and-transverse-output',scope='Rounded central wing relief, longer slanted output links, restored bounded lower-side skin and narrower actual swept slot')
 m['internalDrive']['motionContractRevision']=a['id']
 body=c['mechanism']['bodyAnchorRightCruise']
 for side,sign in [('L',-1),('R',1)]:
  m['mechanism']['sides'][side]['bodyAnchorCruise']=[sign*body[0],body[2],-body[1]]
  m['mechanism']['sides'][side]['bodyAnchorLocal']=[sign*body[0],0,0]
 m['currentAnnotationSurfaceRefinement']=g['centerWingRefinement']

if g.get('centerWingRefinement',{}).get('schema')=='transwing.continuous-main-tilt-root-surfaces.v1':
 a.update(id='2026-10-08-continuous-main-tilt-and-root-curves',scope='Continuous moving-root and main receiver contours; actual fixed-pin seating; separated receiver-wall normal fields')
 m.pop('currentAnnotationSurfaceRefinement',None)
 m['currentMainTiltConnectionRefinement']=g['centerWingRefinement']
 m['internalDrive']['motionContractRevision']=a['id']

m['assets'].update({name:{'bytes':p.stat().st_size,'sha256':sha(p)}for name,p in [('xp4.blend',ROOT/c['source']),('xp4-source.glb',STAGE/'xp4-source.glb'),('xp4.glb',STAGE/'xp4.glb')]})
m['assetEncoding'].update({k:v[k]for k in ['quantization','runtimeBytes','runtimeBudgetReview','compression','paintEncodingPreservation','driveRestTransformPreservation','criticalTransformPreservation','semanticAliasTransformPreservation','runtimeDiagnosticMetadataPruning']if k in v})
# Keep current identity/contract summaries, not embedded historical construction reports.
keep={'id','baselineCommit','sourceCandidate','sourceCandidateSha256','lowerSkin','units','claimBoundary','scope','rebuildMode','historicalProceduralReconstruction','nativeBaselineContract','currentEvidenceRoot','historicalEvidenceLocation','currentRightPivotBlender','currentRightWingBallBlenderCruise'}
m['annotationRevision']={k:value for k,value in a.items()if k in keep}
m['variants']['xp4'].update(triangles=v['renderedTriangles'],uniqueMeshTriangles=v['triangles'],meshes=v['meshInstances'],meshOwningNodes=v['meshInstances'],renderedMeshPrimitives=0,rawNodes=v['nodes'])
# Preserve the explicitly checked material primitive count from the source/runtime gate when available.
identity_path=STAGE/'SOURCE_RUNTIME_IDENTITY.json'
if identity_path.exists():
 identity=json.loads(identity_path.read_text())
 if identity.get('passed') and identity.get('runtimeSha256')==sha(STAGE/'xp4.glb'):m['variants']['xp4']['renderedMeshPrimitives']=identity['renderedMeshPrimitives']
if not m['variants']['xp4']['renderedMeshPrimitives']:
 import struct
 raw=(STAGE/'xp4.glb').read_bytes();g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')]);m['variants']['xp4']['renderedMeshPrimitives']=sum(len(g['meshes'][n['mesh']]['primitives'])for n in g['nodes']if'mesh'in n)
m['rebuild']={'mode':c['rebuildMode'],'nativeBaseline':c['source'],'historicalProceduralReconstruction':False,'historicalArchive':c['historicalArchive']}
(STAGE/'model-manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
