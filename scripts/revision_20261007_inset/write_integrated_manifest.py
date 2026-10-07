"""V27 candidate-stage metadata; never publish or overwrite main app assets."""
from pathlib import Path
import copy, hashlib, json, math, os, struct
ROOT = Path(__file__).resolve().parents[2]
STAGE = (ROOT / os.environ.get('TRANSWING_INTEGRATED_STAGE', 'qa/revision-20261007-inset/baked-integrated-a')).resolve()
assert STAGE.is_relative_to(ROOT / 'qa/revision-20261007-inset')
def read(name): return json.loads((STAGE / name).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name, data):
    path = STAGE / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
def gltf_vector(vector): return [vector[0], vector[2], -vector[1]]
base = read('v25-parent-manifest.json')
assert base['version'] == 25
bake = read('BAKE_RECEIPT.json')
validation = read('model-validation.json')
identity = read('SOURCE_RUNTIME_IDENTITY.json')
geometry = read('BAKE_GEOMETRY_IDENTITY.json')
animation = read('BAKED_ANIMATION_CHECK.json')
compatibility = read('RUNTIME_COMPATIBILITY_CHECK.json')
owners = read('SEMANTIC_OWNER_TOPOLOGY_CHECK.json')
for name, report in [('identity', identity), ('geometry', geometry), ('animation', animation), ('runtime compatibility', compatibility), ('semantic owners', owners)]:
    assert report['passed'] is True, name
assert identity['sourceSha256'] == sha(STAGE / 'xp4-source.glb')
assert identity['runtimeSha256'] == sha(STAGE / 'xp4.glb')
assert geometry['bakedBlendSha256'] == sha(STAGE / 'xp4.blend')
assert geometry['sourceCandidateSha256'] == bake['sourceCandidateSha256']
raw = (STAGE / 'xp4-source.glb').read_bytes()
doc = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
contract = doc['extras']['annotatedMechanism']
label = Path(bake['sourceCandidate']).stem
construction_path = ROOT / 'qa/revision-20261007-inset' / (label + '-construction.json')
construction = json.loads(construction_path.read_text())
assert construction['sourceSha256'] == bake['sourceCandidateSha256']
travel = contract['actualTravel']
pivot = contract['actualRightPivot']
anchor = contract['wingAnchorRightCruise']
rod_length = contract['rigidRodLength']
size_review = read('RUNTIME_SIZE_REVIEW.json')
assert size_review['actualRuntimeBytes'] == (STAGE / 'xp4.glb').stat().st_size
approval = STAGE / 'BUDGET_APPROVAL.json'
if approval.exists():
    decision = json.loads(approval.read_text())
    assert decision['version'] == 27 and decision['approvedByProjectRoot'] is True
    budget = int(decision['runtimeBudgetBytes'])
    size_review.update(approvedBudgetBytes=budget,
                       status='WITHIN_EXPLICIT_V27_BUDGET' if size_review['actualRuntimeBytes'] <= budget else 'EXCEEDS_EXPLICIT_V27_BUDGET',
                       approvalReceiptSha256=sha(approval))
    assert size_review['actualRuntimeBytes'] <= budget
    write('RUNTIME_SIZE_REVIEW.json', size_review)

manifest = copy.deepcopy(base)
manifest['version'] = 27
manifest['annotationRevision'] = {
    'id': '2026-10-07-v27-' + label.removeprefix('candidate-'),
    'baselineCommit': '7dcd5cde3a650c48a164c72bd9473671ec74b641',
    'baselineManifest': 'assets/baseline-v25-20261007/manifest.json',
    'baselineManifestSha256': sha(STAGE / 'v25-parent-manifest.json'),
    'frozenMGeometryReference': 'REVISION_DETAIL_GEOMETRY_REFERENCE.json',
    'frozenMGeometryReferenceSha256': bake['priorGeometryReferenceSha256'],
    'supersedesBaselineGeometryEvidence': True,
    'old82And136ConstructionInputsUnchanged': True,
    'sourceCandidate': bake['sourceCandidate'],
    'sourceCandidateSha256': bake['sourceCandidateSha256'],
    'sourceConstructionReceipt': str(construction_path.relative_to(ROOT)),
    'sourceConstructionReceiptSha256': sha(construction_path),
    'currentEvidenceRoot': str(STAGE.relative_to(ROOT)),
    'reviewStatus': ('PIPELINE_TRIAL_PASSED_APPEARANCE_REPAIR_PENDING' if label == 'candidate-inset-integrated-a' else 'PIPELINE_CHECKS_PASSED_JOINT_GEOMETRY_AND_USER_REVIEW_PENDING'),
    'appearanceStatus': '集成a尾腹连续隆起仍不符合下皮平整要求，宽轴口也待审；此输出仅验证新管线' if label == 'candidate-inset-integrated-a' else '新候选外观尚待独立审查；此输出不授予最终验收',
    'pipelineTrialOnly': True, 'geometryAcceptanceImplied': False,
    'appearanceAccepted': False, 'integrationApproved': False,
    'publicationPerformed': False, 'finalDeliveryAccepted': False,
    'units': '原创概念模型u，非实机测绘尺寸；不换算为制造公差或强度认证',
    'claimBoundary': '精确身份、烘焙与有限/解析运行行为检查各按其报告范围；不继承旧壁厚、净空或完整运动验收结论',
    'currentRightPivotBlender': pivot,
    'currentRightWingBallBlenderCruise': anchor,
    'hinge': {'negativeShaftT': -.0145, 'positiveShaftT': .020,
              'negativeEndcapMinimumT': -.0148, 'shaftDiameter': .056,
              'bearingCenterT': [-.0093, .0093], 'bearingWidth': .003,
              'sameGeometricAxisReparameterization': True,
              'uniformOldHingeScaleCertificateInherited': False},
    'movingBores': {'nominalInnerRadius': .0313,
                    'reason': '以96边实际内孔最小边半径而非标称半径差检查净空',
                    'currentConstructionRecords': construction['receipts']['movingBores']},
    'movingConnectionRibs': {'materialOwners': ['RootCarrierBridge_L', 'RootCarrierBridge_R'],
                             'currentConstructionRecords': construction['receipts']['ribs'],
                             'oldHWholeHardwareCertificateInherited': False},
    'frontNacelleAndSaddle': {'additionalLayoutChangeInV27': False,
                             'additionalCavityCutInV27': False,
                             'identityMustBeConfirmedForAnyLaterCandidate': True},
    'lowerSkin': {'materialOwner': {'L': 'Composite_wing_L', 'R': 'Composite_wing_R'},
                  'aliases': [{'node': 'WingLowerClosure_' + s, 'type': 'EMPTY',
                               'parent': 'WingPivot_' + s, 'materialOwner': 'Composite_wing_' + s} for s in ['L', 'R']],
                  'uniformFinalThicknessClaimed': False,
                  'wholeMachineMinimumWallClaimed': False,
                  'appearanceFlatnessAccepted': False,
                  'currentRearConstructionRecords': construction['receipts']['rear']},
    'historicalEvidenceLocation': 'assets/baseline-v25-20261007/manifest.json and assets/baseline-20261007/manifest.json',
    'runtimeBudgetReview': size_review,
}
manifest['annotationRevision']['naturalFeatherException'] = construction.get('naturalFeatherException')
manifest['annotationRevision']['jointGeometryAndUserImageReviewPending'] = True
manifest['variants']['xp4'].update(
    meshes=validation['meshInstances'], meshOwningNodes=validation['meshInstances'],
    renderedMeshPrimitives=identity['renderedMeshPrimitives'], rawNodes=validation['nodes'],
    triangles=validation['renderedTriangles'],
    meshCountMeaning='mesh-owning glTF nodes; multi-material owners expand into renderer primitives')
mechanism = copy.deepcopy(base['mechanism'])
for key in ['rootClearance', 'mainVerticalLayerGapNominal', 'physicalGapMinimumRequirement', 'mainWallMinimumRequirement']:
    mechanism.pop(key, None)
mechanism.update(version=27, sliderTravel=[travel['minimumY'], travel['maximumY']],
                 persistentContract=contract,
                 currentRigidRodLength=rod_length,
                 rootClearanceScope='旧数值不作V27当前净空证书；按本候选同SHA报告逐域验收',
                 historicalPersistentFields=['actualSlotAdmission', 'earlySlotPreparation', 'constructionInputHashes',
                                             'combinedSupportLineageSha256', 'rootPhase'],
                 historicalPersistentFieldsAreNotCurrentAcceptance=True)
for side, sign in [('L', -1), ('R', 1)]:
    row = mechanism['sides'][side]
    row['braceLength'] = rod_length
    row['wingAnchorLocal'] = gltf_vector([sign * (anchor[0] - pivot[0]), anchor[1] - pivot[1], anchor[2] - pivot[2]])
    row['bodyAnchorCruise'] = gltf_vector([sign * contract['bodyAnchorRightCruise'][0],
                                         contract['bodyAnchorRightCruise'][1], contract['bodyAnchorRightCruise'][2]])
    row['pivotWorldCruise'] = gltf_vector([sign * pivot[0], pivot[1], pivot[2]])
mechanism['actualSlotTravelScope'] = '冻结旧槽孔制作包络，非当前闭环行程；当前行程见sliderTravel。旧slot admission记录不当新证书。'
manifest['mechanism'] = mechanism
manifest['wingAttachmentReference'] = {'source': '当前Native scene实际球点/定长杆/同轴重参数后的闭环',
                                        'worldBlenderCruise': anchor, 'fitIsIllustrative': True,
                                        'exactImagePixelRegistrationClaimed': False}
# Keep unchanged drive design semantics; move old numerical contact/cavity
# certificates behind explicit historical references instead of relabeling them.
drive = copy.deepcopy(base['internalDrive'])
for key in ['fixedAttachmentInterfaces', 'movingClearances', 'cavity', 'travelStopCentersBlenderY']:
    drive.pop(key, None)
drive.update(version=27, stroke=[travel['minimumY'], travel['maximumY']],
             motionContractRevision='2026-10-07-v27-' + label.removeprefix('candidate-'),
             fixedLayoutAndStopGeometryPreserved=False,
             frontStopRevisionBlender=contract['frontStopRevision'],
             fixedDriveLayoutPreservedExceptExplicitFrontStops=True,
             maleThreadGeometryPhaseCorrection=construction['receipts']['drivePhase'],
             phaseEncodingFreshlyBaked=True,
             historicalContactAndCavityRecords='assets/baseline-v25-20261007/manifest.json#/internalDrive',
             historicalContactRecordsAreNotCurrentGeometryCertificates=True)
drive['actualFrontStopMeshesBlender'] = compatibility['files'][0]['actualFrontStops']
drive['actualMinimumFrontStopBushingGap'] = compatibility['files'][0]['minimumFrontStopBushingGap']
drive['legacyDriveMetadata'] = compatibility['files'][0]['legacyDriveMetadata']
drive['legacySliderRestYNotConsumedByProductionOrExport'] = True
manifest['internalDrive'] = drive
manifest['drivePhaseEncodingV22'] = doc['extras']['drivePhaseEncodingV22']
manifest['animation'] = {**base['animation'], 'description': 'V27当前机构重新烘焙，非旧动画字节复用；实际AnimationMixer及相位另有本SHA报告'}
manifest['animations'] = [{'name': r['name'], 'channels': r['channels'], 'durationSeconds': r['durationSeconds']} for r in validation['animations']]
manifest['assetEncoding'] = {k: validation[k] for k in ['driveRestTransformPreservation', 'criticalTransformPreservation',
                            'semanticAliasTransformPreservation', 'paintEncodingPreservation', 'runtimeBytes', 'compression', 'quantization']}
manifest['assetEncoding']['runtimeBudgetReview'] = size_review
manifest['assetEncoding']['precisionPolicy'] = '保留所有原Float32例外、当前关键owner及新增owner；critical所有材质primitive与序列化TRS严格同一，不删材质/网格降体积'
manifest['assets'] = {name: {'bytes': (STAGE / name).stat().st_size, 'sha256': sha(STAGE / name)} for name in ['xp4.blend', 'xp4-source.glb', 'xp4.glb']}
reports = ['BAKE_RECEIPT.json', 'BAKE_GEOMETRY_IDENTITY.json', 'SOURCE_RUNTIME_IDENTITY.json',
           'BAKED_ANIMATION_CHECK.json', 'RUNTIME_COMPATIBILITY_CHECK.json', 'SEMANTIC_OWNER_TOPOLOGY_CHECK.json',
           'ALL_OWNER_TOPOLOGY_INVENTORY.json', 'FROZEN_PARENT_METADATA_CHECK.json', 'LEGACY_QUANTIZATION_INVENTORY_IDENTITY.json']
manifest['stagedEvidence'] = {name: {'sha256': sha(STAGE / name), 'scope': '本候选pipeline身份/动画/实际rig/指定owner核验；不授予最终材料/外观通过'} for name in reports if (STAGE / name).exists()}
write('model-manifest.json', manifest)
write('annotated-mechanism.json', contract)
for folder in ['assets/blender', 'assets/build', 'public/models']:
    write(folder + '/annotated-mechanism.json', contract)
cache = '20261007-v27-' + label.removeprefix('candidate-') + '-' + sha(STAGE / 'xp4.glb')[:8]
(STAGE / 'modelAssetRevision.ts').write_text('/** V27 candidate-stage helper only; not approved for main integration. */\nexport const MODEL_ASSET_REVISION = ' + json.dumps(cache) + ';\nexport function modelAssetUrl(variant: "xp4") {\n  return `/models/${variant}.glb?v=${MODEL_ASSET_REVISION}`;\n}\n')
print(json.dumps({'version': 27, 'stage': str(STAGE.relative_to(ROOT)), 'sourceSha256': bake['sourceCandidateSha256'],
                  'runtimeBytes': validation['runtimeBytes'], 'budgetStatus': size_review['status'],
                  'reviewStatus': manifest['annotationRevision']['reviewStatus'], 'mainTreeWrites': False}, indent=2))
