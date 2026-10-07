"""V26 stage-only review manifest/cache helper; never write V25 public/assets/src."""
from pathlib import Path
import json,hashlib,os,struct,copy
ROOT=Path(__file__).resolve().parents[2]
STAGE=(ROOT/os.environ.get('TRANSWING_DETAIL_STAGE','qa/revision-20261007-detail/baked-candidate')).resolve()
assert STAGE.is_relative_to(ROOT/'qa/revision-20261007-detail')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
base=json.loads((STAGE/'v25-parent-manifest.json').read_text())
assert base['version']==25
bake=json.loads((STAGE/'BAKE_RECEIPT.json').read_text())
identity=json.loads((STAGE/'SOURCE_RUNTIME_IDENTITY.json').read_text())
geometry=json.loads((STAGE/'BAKE_GEOMETRY_IDENTITY.json').read_text())
animation=json.loads((STAGE/'BAKED_ANIMATION_CHECK.json').read_text())
compatibility=json.loads((STAGE/'RUNTIME_COMPATIBILITY_CHECK.json').read_text())
validation=json.loads((STAGE/'model-validation.json').read_text())
owners=json.loads((STAGE/'SEMANTIC_OWNER_TOPOLOGY_CHECK.json').read_text())
for r in [identity,geometry,animation,compatibility,owners]:assert r['passed']is True
assert identity['sourceSha256']==sha(STAGE/'xp4-source.glb')
assert identity['runtimeSha256']==sha(STAGE/'xp4.glb')
assert geometry['bakedBlendSha256']==sha(STAGE/'xp4.blend')
assert geometry['sourceCandidateSha256']==bake['sourceCandidateSha256']
raw=(STAGE/'xp4-source.glb').read_bytes();doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
contract=doc['extras']['annotatedMechanism'];label=Path(bake['sourceCandidate']).stem
manifest=copy.deepcopy(base);manifest['version']=26
revision=copy.deepcopy(base['annotationRevision'])
revision.update({'id':'2026-10-07-v26-'+label.removeprefix('candidate-'),'baselineModelVersion':25,'baselineManifest':'assets/baseline-v25-20261007/manifest.json','baselineManifestSha256':sha(STAGE/'v25-parent-manifest.json'),'baselineRuntimeSha256':base['assets']['xp4.glb']['sha256'],'sourceCandidate':bake['sourceCandidate'],'sourceCandidateSha256':bake['sourceCandidateSha256'],'priorGeometryEvidenceSuperseded':True,'currentEvidenceRoot':str(STAGE.relative_to(ROOT)),'reviewStatus':'PIPELINE_TRIAL_ONLY_NOT_INTEGRATION_APPROVED'if label=='candidate-detail-j'else'PIPELINE_CHECKS_PASSED_COMBINED_JOINT_REVIEW_PENDING','publicationPerformed':False,'integrationApproved':False,'jointMaterialAcceptanceImplied':False,'pipelineIdentityAnimationRuntimeChecksPassed':True,'runtimeBudgetBytes':3800000,'budgetReason':'V26 material-preserving merged geometry is approximately 3.74 MB; project owner approved explicit 3.8 MB for this revision only. V25 remains 3.7 MB; no Float32 exceptions or materials were removed.','seamReview':'Front/rear seam ports intentionally remain slightly wider; middle C-shaped course is retained. Final endpoint seam remains subject to user review.','lowerSkin':{'materialOwner':{'L':'Composite_wing_L','R':'Composite_wing_R'},'aliases':[{'node':'WingLowerClosure_'+s,'type':'EMPTY','parent':'WingPivot_'+s,'materialOwner':'Composite_wing_'+s}for s in ['L','R']],'originalPlateNominalVerticalThickness':.012,'uniformFinalThicknessClaimed':False,'actualMainWallAndLayerGap':'Use the independent report for this exact source candidate SHA; no inherited j or V25 material certificate','wholeMachineMinimumWallClaimed':False}})
if label=='candidate-detail-j':
 revision['materialReviewStatus']='FAILED_J_LAYER_GAP_AND_WALL_REVIEW; retain only as pipeline method trial'
 revision['knownBlockers']=['Independent rear-interface gap about .00150u is below .003u; j material evidence must not be transferred to a repaired candidate']
elif label=='candidate-detail-k':
 revision['materialReviewStatus']='Awaiting exact-SHA combined independent acceptance; pipeline reports alone do not grant it'
 revision['lowerSkin']['localizedRearJoinAdjustment']={'windowBlender':{'absoluteX':[.60,.80],'Y':[-1.055,-.955]},'wholeLayerDownwardTranslation':.0022,'additionalDownwardThickness':.003,'rearZTransitionSupportMaximumAbsX':.90,'frontMaterialSplitLocalOnly':True,'protectedFarWingTopologyMustRemainUnchanged':True,'dimensionsAreRecipeParametersNotMeasuredThicknessCertificate':True}
elif label in ['candidate-detail-m','candidate-detail-m-regenerated']:
 revision['materialReviewStatus']='Waiting for the same-SHA final independent receipt and combined acceptance; pipeline checks alone do not grant it'
 revision['lowerSkin']['localizedRearJoinAdjustment']={'additionalDownwardThickness':.005,'adaptiveLayerGapDesignTarget':.0040,'extraRearExtension':{'onlyWhereAbsoluteXLessThan':.80,'normalizedChordTargetU':.955},'explicitValidTriangulationAfterUnionAndMaterialSplit':True,'trueTriangleAreaThreshold':1e-18,'originalFarWingActualTrianglesPreserved':True,'dimensionsAreRecipeParametersNotMeasuredThicknessCertificate':True,'actualAcceptance':'最终同SHA独审收据为准；原自然尾尖不作全机.010认证'}
else:
 revision['materialReviewStatus']='Exact-SHA independent material review must be linked before integration'
manifest['annotationRevision']=revision
manifest['variants']['xp4'].update({'meshes':validation['meshInstances'],'meshOwningNodes':validation['meshInstances'],'renderedMeshPrimitives':identity['renderedMeshPrimitives'],'rawNodes':validation['nodes'],'triangles':validation['renderedTriangles'],'meshCountMeaning':'mesh-owning glTF nodes; multi-material owners expand into multiple renderer Mesh primitives'})
manifest['mechanism']['persistentContract']=contract
manifest['assetEncoding']={'driveRestTransformPreservation':validation['driveRestTransformPreservation'],'criticalTransformPreservation':validation['criticalTransformPreservation'],'semanticAliasTransformPreservation':validation['semanticAliasTransformPreservation'],'paintEncodingPreservation':validation['paintEncodingPreservation'],'runtimeBytes':validation['runtimeBytes'],'runtimeBudgetBytes':3800000,'runtimeBudgetPassed':validation['runtimeBytes']<=3800000,'compression':validation['compression'],'quantization':validation['quantization'],'reason':revision['budgetReason']}
manifest['animations']=[{'name':r['name'],'channels':r['channels'],'durationSeconds':r['durationSeconds']}for r in validation['animations']]
manifest['assets']={n:{'bytes':(STAGE/n).stat().st_size,'sha256':sha(STAGE/n)}for n in ['xp4.blend','xp4-source.glb','xp4.glb']}
manifest['stagedEvidence']={n:{'sha256':sha(STAGE/n),'scope':'pipeline identity, animation or runtime compatibility only; not joint material acceptance'}for n in ['BAKE_RECEIPT.json','BAKE_GEOMETRY_IDENTITY.json','SOURCE_RUNTIME_IDENTITY.json','BAKED_ANIMATION_CHECK.json','RUNTIME_COMPATIBILITY_CHECK.json','SEMANTIC_OWNER_TOPOLOGY_CHECK.json','ALL_OWNER_TOPOLOGY_INVENTORY.json','FROZEN_PARENT_METADATA_CHECK.json','LEGACY_QUANTIZATION_INVENTORY_IDENTITY.json']if(STAGE/n).exists()}
(STAGE/'model-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(STAGE/'annotated-mechanism.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n')
cache_key='20261007-v26-'+label.removeprefix('candidate-')+'-'+sha(STAGE/'xp4.glb')[:8]
(STAGE/'modelAssetRevision.ts').write_text('/** V26 staged helper; do not install before approved integration. */\nexport const MODEL_ASSET_REVISION = '+json.dumps(cache_key)+';\nexport function modelAssetUrl(variant: "xp4") {\n  return `/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`;\n}\n')
print(json.dumps({'version':26,'sourceCandidate':bake['sourceCandidate'],'stage':str(STAGE.relative_to(ROOT)),'bytes':validation['runtimeBytes'],'meshOwningNodes':validation['meshInstances'],'renderedMeshPrimitives':identity['renderedMeshPrimitives'],'reviewStatus':revision['reviewStatus'],'mainProjectWritesPerformed':False},indent=2))
