import type { ExperienceState } from './core/experience';
import { NEUTRAL_DETAIL_POSE } from './core/details';
import { SURFACE_IDS, type RuntimeSnapshot, type StatePatch } from './core/simulation';

/** Entering motor control closes active detail actuation before motor commands.
 * Surface/hatch adjustments themselves retain their camera and other independent values. */
export function prepareManualInput(
  state: ExperienceState,
  snapshot: RuntimeSnapshot,
  patch: StatePatch,
) {
  const motorInput = 'motors' in patch || Object.keys(patch).length === 0;
  const closesDetail = motorInput && state.detailView !== null;
  const nextState: ExperienceState = {
    ...state,
    playing: false,
    tiltMode: true,
    tilt: { ...state.tilt, progress: snapshot.state.wingTilt, playing: false },
    autoRotate: false,
    exploded: false,
    ...(closesDetail
      ? { detailView: null, detailPose: { ...NEUTRAL_DETAIL_POSE }, detailReturnProgress: null }
      : {}),
  };
  const nextPatch: StatePatch = {
    ...(closesDetail
      ? { surfaces: Object.fromEntries(SURFACE_IDS.map((id) => [id, 0])), hatchDeg: 0 }
      : {}),
    ...patch,
    display: { ...patch.display, exploded: false },
  };
  return { state: nextState, patch: nextPatch };
}

/** Local presentation clearance only; never edits externally supplied positionM. */
export function cargoPresentationLift(
  detailView: ExperienceState['detailView'],
  control: RuntimeSnapshot['control'],
  hatchDeg: number,
  measuredLift: number,
) {
  return detailView === 'cargo' || (control === 'local' && hatchDeg > 0) ? measuredLift : 0;
}
