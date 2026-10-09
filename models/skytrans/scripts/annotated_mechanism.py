"""Plain-Python single input intent and closure preflight for native staging.

The planning anchor height is explicitly provisional. The final generated skin
ray binds a complete derived mechanism record into the Blend scene, output JSON,
manifest and GLB extras. It never rewrites this input intent during generation.
"""
from pathlib import Path
import hashlib,json,math

ROOT=Path(__file__).resolve().parent.parent
INTENT_PATH=Path(__file__).with_name('data')/'annotated-mechanism-intent.json'
INTENT=json.loads(INTENT_PATH.read_text())
assert INTENT['schema']=='transwing.annotated-mechanism-intent.v1'

def digest():return hashlib.sha256(INTENT_PATH.read_bytes()).hexdigest()
def planned_anchor():return (*INTENT['targetAnchorXY'],INTENT['planningAnchorZ'])
def norm(v):return math.sqrt(sum(x*x for x in v))
def add(a,b):return tuple(x+y for x,y in zip(a,b))
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def rotate(v,axis,angle):
    axis=tuple(x/norm(axis)for x in axis);c=math.cos(angle);s=math.sin(angle);d=dot(axis,v);w=cross(axis,v)
    return tuple(v[i]*c+w[i]*s+axis[i]*d*(1-c)for i in range(3))
def closure(unfold,anchor=None,pivot=None):
    anchor=anchor or planned_anchor();pivot=pivot or INTENT['actualRightPivot'];body=INTENT['bodyAnchorRightCruise']
    length=norm(sub(anchor,body));local=sub(anchor,pivot)
    world=add(pivot,rotate(local,INTENT['rightAxisUnnormalized'],math.radians(INTENT['foldAngleDegrees'])*(1-unfold)))
    r2=length*length-(world[0]-body[0])**2-(world[2]-body[2])**2
    if r2<=0:raise ValueError('No real rear-slider closure')
    return world[1]+math.sqrt(r2)
def travel(anchor=None,samples=None):
    samples=samples or INTENT['slotAssessment']['samples'];rows=[(i/(samples-1),closure(i/(samples-1),anchor))for i in range(samples)]
    lo=min(rows,key=lambda p:p[1]);hi=max(rows,key=lambda p:p[1])
    return {'samples':samples,'minimumY':lo[1],'minimumAtUnfold':lo[0],'maximumY':hi[1],'maximumAtUnfold':hi[0],
            'hoverY':rows[0][1],'cruiseY':rows[-1][1],'continuousExtremaProof':False}
def slot_preflight(outline,anchor=None):
    """Real XY aperture bounds versus carriage travel, without resizing the slot.

    This is necessary longitudinal admission, not a finite-material collision
    certificate: the rod/eye and sloped hull require independent 3D checks.
    """
    bounds=[[min(p[i]for p in outline),max(p[i]for p in outline)]for i in range(2)]
    tr=travel(anchor);forward=tr['minimumY']-.009-.007;aft=tr['maximumY']-.009+.007
    longitudinal=bounds[1][0]<forward and aft<bounds[1][1]
    if not longitudinal:raise ValueError('Existing aperture fails new longitudinal carriage envelope; explicit geometry decision required')
    return {'plannedAnchor':list(anchor or planned_anchor()),'travel':tr,'actualApertureXYBounds':bounds,
            'outputCenterYOffset':-.009,'outputRadius':.007,'carriageLongitudinalEnvelope':[forward,aft],
            'longitudinalMargins':[forward-bounds[1][0],bounds[1][1]-aft],
            'longitudinalAdmissionPassed':longitudinal,'slotGeometryChanged':False,
            'fullFiniteMaterialApertureClearancePassed':False,'inputIntentSha256':digest()}
def final_record(anchor,rod_length,actual_travel,root_receipt):
    if tuple(anchor[:2])!=tuple(INTENT['targetAnchorXY']):raise ValueError('Final actual ball XY differs from persistent intent')
    if abs(anchor[2]-INTENT['planningAnchorZ'])>INTENT['maximumPlanningToNativeAnchorZDifference']:
        raise ValueError('Actual skin fit invalidates early slot preflight; inspect before rebuilding the aperture')
    return {'schema':'transwing.annotated-mechanism.final.v1','unitBoundary':INTENT['unitBoundary'],'inputIntentSha256':digest(),
            'referencePivot':INTENT['referencePivot'],'actualRightPivot':INTENT['actualRightPivot'],
            'rightAxisUnnormalized':INTENT['rightAxisUnnormalized'],'foldAngleDegrees':INTENT['foldAngleDegrees'],
            'bodyAnchorRightCruise':INTENT['bodyAnchorRightCruise'],'wingAnchorRightCruise':list(anchor),
            'rigidRodLength':rod_length,'actualTravel':actual_travel,'rootPhase':root_receipt['phase'],
            'sourceRootLineageSha256':INTENT['sourceTailV7dSha256'],
            'preservedClosingLineageSha256':INTENT['sourceRootV6bSha256'],
            'shortCapLineageSha256':INTENT['sourceShortCapV1Sha256'],
            'combinedSupportLineageSha256':INTENT['sourceCombinedSupportSha256'],
            'constructionRevision':INTENT['rootConstructionRevision'],
            'constructionInputHashes':INTENT['requiredConstructionInputs'],
            'geometryAcceptance':False}
