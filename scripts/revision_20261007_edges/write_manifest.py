"""Build fresh runtime metadata, then replace inherited B layout facts explicitly."""
from pathlib import Path
import os,runpy,json,hashlib
ROOT=Path(__file__).resolve().parents[2]
STAGE=ROOT/os.environ['TRANSWING_INTEGRATED_STAGE']
runpy.run_path(str(ROOT/'scripts/revision_20261007_inset/write_integrated_manifest.py'))
manifest_path=STAGE/'model-manifest.json'
manifest=json.loads(manifest_path.read_text())
label=os.environ.get('TRANSWING_INTEGRATED_LABEL','candidate-inset-integrated-b-edge-linkage')
construction_path=ROOT/'qa/revision-20261007-inset'/(label+'-construction.json')
construction=json.loads(construction_path.read_text())
revision=construction['receipts']['linkageInset']
extension=revision['driveExtension'];slot=revision['slotRelief'];linkage=revision['linkage']
a=manifest['annotationRevision']
a.update(baselineCommit='d0ca0a5a7105e2ef55a909f67aca26faec65c33a',parentRevision='published integrated B',edgeContourRevision=construction['receipts']['edgeContours'],furtherLinkedInset=revision,currentConstructionReceiptSha256=hashlib.sha256(construction_path.read_bytes()).hexdigest(),old171ConstructionInputsUnchanged=True)
a['lowerSkin']['currentRearConstructionRecords']=construction['receipts']['edgeContours']['sides']
a['lowerSkin']['newFrontAndRearContourReceipts']=construction['receipts']['edgeContours']
drive=manifest['internalDrive']
drive['historicalLayoutV22']=drive.pop('layoutV22',None)
drive.update(fixedDriveLayoutPreservedExceptExplicitFrontStops=False,fixedDriveLayoutPreservedExceptExplicitFrontSupportGuideAndThreadExtension=True,frontSupportAndFeetRevision=extension,currentFrontSlotRelief=slot,currentLayout={
    'frontSupportCenterY':extension['newSupportCenterY'],
    'guideSpan':[extension['rails'][0]['newFrontY'],extension['rails'][0]['rearYUnchanged']],
    'screwThreadSpan':[extension['maleThread']['nominalStartY'],extension['maleThread']['nominalEndY']],
    'physicalThreadMaterialSpan':extension['maleThread']['physicalSpanY'],
    'lead':extension['maleThread']['preservedLead'],
    'motorGearboxCoreRearSupportChanged':False,
    'source':'Current native revision receipt, not inherited layout values'})
manifest['mechanism']['actualSlotTravelScope']='当前前端槽局部让位见internalDrive.currentFrontSlotRelief；旧slotEnvelopeBlender保留作历史基线，不能当本候选完整材料验收。'
manifest['mechanism']['currentSlotFrontRelief']=slot
manifest['mechanism']['currentLinkedInsetTargetAbsX']=1.06
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('CURRENT_EDGE_LINKAGE_MANIFEST',str(manifest_path))
