/** Explicit complete lower-pan domain. Coordinates are design input, never picked from successful rays. */
import assert from 'node:assert/strict';

export const FULL_PAN_DOMAIN = Object.freeze({y:Object.freeze([-1.78,-1.05]),innerAbsX:.653,outerInsetFromCurve:.015});
export const FULL_PAN_LIMITS = Object.freeze({minimumGap:.003,maximumGap:.020,minimumSkinThickness:.006,maximumSkinThickness:.09});

export function fullPanStripFromDesign(design) {
  assert.deepEqual(design?.panDomainBlender,FULL_PAN_DOMAIN,'Full-pan domain must retain Y[-1.78,-1.05], inner .653 and curve inset .015');
  assert.equal(design.nominalPanThickness,.010,'Nominal continuous lower-pan wall changed');
  assert([.015,.019].includes(design.nominalCruiseVerticalGap),'Only the historical .015 or explicitly reviewed current .019 nominal design gap is supported; physical .003–.020 limits do not change');
  const curve=design.curveKnotsBlender;
  assert(Array.isArray(curve)&&curve.length>=2,'Full pan requires explicit curve knots');
  for(const[k,p]of curve.entries()) {
    assert(Number.isFinite(p.y)&&Number.isFinite(p.absX),'Nonfinite full-pan curve knot');
    if(k)assert(p.y>curve[k-1].y,'Full-pan curve knots must be strictly ordered');
  }
  const[lo,hi]=FULL_PAN_DOMAIN.y;
  assert(curve[0].y<=lo&&curve.at(-1).y>=hi,'Curve knots must cover the complete mandatory pan Y range');
  const at=y=>{const i=curve.findIndex(p=>p.y>=y);assert(i>=0);if(curve[i].y===y)return curve[i].absX;assert(i>0);const a=curve[i-1],b=curve[i];return a.absX+(b.absX-a.absX)*(y-a.y)/(b.y-a.y);};
  const ys=[lo,...curve.filter(p=>p.y>lo&&p.y<hi).map(p=>p.y),hi];
  const knots=ys.map(y=>({y,xInner:FULL_PAN_DOMAIN.innerAbsX,xOuter:at(y)-FULL_PAN_DOMAIN.outerInsetFromCurve}));
  assert(knots.every(p=>p.xOuter-p.xInner>=.01-1e-12),'Explicit full-pan curve leaves no finite material width');
  return {id:'full-pan',yRange:[lo,hi],knots,...FULL_PAN_LIMITS};
}

export function resolveFullPanStrip(design,scan=design?.layerScanBlender) {
  const expected=fullPanStripFromDesign(design);
  assert(scan&&typeof scan==='object','Missing complete pan scan design');
  if(scan.wrapStrips===undefined)return expected;
  assert(Array.isArray(scan.wrapStrips)&&scan.wrapStrips.length===1,'Full pan cannot be replaced by selected narrow bands');
  const actual=scan.wrapStrips[0],coordinates=s=>({id:s.id,yRange:s.yRange,knots:s.knots});
  assert.deepEqual(coordinates(actual),coordinates(expected),'Mandatory full-pan coordinates must exactly follow the complete explicit curve');
  for(const key of Object.keys(FULL_PAN_LIMITS))assert(Number.isFinite(actual[key]),'Missing finite full-pan bound '+key);
  assert(actual.minimumGap>=FULL_PAN_LIMITS.minimumGap&&actual.maximumGap<=FULL_PAN_LIMITS.maximumGap&&actual.maximumGap>=actual.minimumGap,'Full-pan gap limits may not relax');
  assert(actual.minimumSkinThickness>=FULL_PAN_LIMITS.minimumSkinThickness&&actual.maximumSkinThickness<=FULL_PAN_LIMITS.maximumSkinThickness&&actual.maximumSkinThickness>=actual.minimumSkinThickness,'Full-pan wall limits may not relax');
  return actual;
}
