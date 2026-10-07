import { useReducer, type SetStateAction } from "react";
import { advanceTime, getFlight, TOTAL } from "./flight";
import {
  INITIAL_TILT,
  tiltReducer,
  type TiltAction,
  type TiltState,
} from "./tilt";
import type { CameraView } from "./inspection";
import {
  NEUTRAL_DETAIL_POSE,
  allowsDetailControl,
  updateDetailPose,
  type DetailView,
  type DetailControl,
  type DetailPose,
} from "./details";

export type ExperienceState = {
  time: number;
  playing: boolean;
  tiltMode: boolean;
  tilt: TiltState;
  inspection: boolean;
  jointSide: "L" | "R" | null;
  cameraView: CameraView;
  cameraReset: number;
  autoRotate: boolean;
  exploded: boolean;
  detailView: DetailView | null;
  detailPose: DetailPose;
  detailReturnProgress: number | null;
};
export const INITIAL_EXPERIENCE: ExperienceState = {
  time: 0,
  playing: false,
  tiltMode: false,
  tilt: INITIAL_TILT,
  inspection: false,
  jointSide: null,
  cameraView: "perspective",
  cameraReset: 0,
  autoRotate: false,
  exploded: false,
  detailView: null,
  detailPose: NEUTRAL_DETAIL_POSE,
  detailReturnProgress: null,
};
type StateChange = {
  [K in keyof ExperienceState]: {
    type: "set";
    key: K;
    value: SetStateAction<ExperienceState[K]>;
  };
}[keyof ExperienceState];
export type ExperienceAction =
  | StateChange
  | { type: "tilt"; action: TiltAction }
  | { type: "enter-tilt" }
  | { type: "leave-tilt" }
  | { type: "inspect"; view: CameraView }
  | { type: "joint"; side: "L" | "R" }
  | { type: "play-flight" }
  | { type: "advance-flight"; seconds: number; loop: boolean }
  | { type: "detail"; view: DetailView }
  | { type: "detail-pose"; control: DetailControl; degrees: number }
  | { type: "detail-neutral" }
  | { type: "close-detail" }
  | { type: "reset" };
export const displayedUnfold = (state: ExperienceState) =>
  state.tiltMode ? state.tilt.progress : getFlight(state.time).unfold;
function neutralDetails(state: ExperienceState): ExperienceState {
  return {
    ...state,
    detailView: null,
    detailPose: NEUTRAL_DETAIL_POSE,
    detailReturnProgress: null,
    tilt:
      state.detailView && state.detailReturnProgress !== null
        ? tiltReducer(state.tilt, {
            type: "scrub",
            progress: state.detailReturnProgress,
          })
        : state.tilt,
  };
}
function enterTilt(state: ExperienceState): ExperienceState {
  const next = neutralDetails(state);
  return {
    ...next,
    playing: false,
    tiltMode: true,
    inspection: true,
    autoRotate: false,
    exploded: false,
    tilt: next.tiltMode
      ? next.tilt
      : tiltReducer(next.tilt, {
          type: "scrub",
          progress: displayedUnfold(next),
        }),
  };
}
export function experienceReducer(
  state: ExperienceState,
  action: ExperienceAction,
): ExperienceState {
  switch (action.type) {
    case "set": {
      const value =
        typeof action.value === "function"
          ? (action.value as (previous: unknown) => unknown)(state[action.key])
          : action.value;
      // 既有UI赋值与显式模式动作共用安全边界。
      // 排队中的镜头或播放更新不能令舱盖、舵面残留偏转。
      const exitsDetail =
        action.key === "time" ||
        action.key === "cameraView" ||
        action.key === "cameraReset" ||
        (action.key === "playing" && value === true) ||
        (action.key === "exploded" && value === true) ||
        (action.key === "inspection" && value === false) ||
        (action.key === "autoRotate" && value === true) ||
        (action.key === "jointSide" && value !== null);
      return {
        ...(exitsDetail ? neutralDetails(state) : state),
        [action.key]: value,
      };
    }
    case "tilt": {
      // 静态细节检查忽略已经排队的动画时钟。
      if (state.detailView && action.action.type === "tick") return state;
      const next = ["begin", "scrub", "reset"].includes(action.action.type)
        ? neutralDetails(state)
        : state;
      return { ...next, tilt: tiltReducer(next.tilt, action.action) };
    }
    case "enter-tilt":
      return enterTilt(state);
    case "leave-tilt":
      return {
        ...neutralDetails(state),
        tilt: tiltReducer(state.tilt, { type: "pause" }),
        tiltMode: false,
        jointSide: null,
        autoRotate: false,
      };
    case "inspect": {
      const next = enterTilt(state);
      return {
        ...next,
        tilt: tiltReducer(next.tilt, { type: "pause" }),
        jointSide: null,
        cameraView: action.view,
        cameraReset: state.cameraReset + 1,
      };
    }
    case "joint": {
      const next = enterTilt(state);
      return {
        ...next,
        tilt: tiltReducer(next.tilt, { type: "pause" }),
        jointSide: action.side,
        cameraReset: state.cameraReset + 1,
      };
    }
    case "play-flight":
      return {
        ...neutralDetails(state),
        tilt: tiltReducer(state.tilt, { type: "pause" }),
        tiltMode: false,
        jointSide: null,
        autoRotate: false,
        inspection: false,
        exploded: false,
        time: state.tiltMode || state.time >= TOTAL ? 0 : state.time,
        playing: !state.playing,
      };
    case "advance-flight": {
      if (!state.playing || state.tiltMode) return state;
      const time = advanceTime(state.time, action.seconds, action.loop);
      return { ...state, time, playing: time < TOTAL || action.loop };
    }
    case "detail":
      return {
        ...enterTilt(state),
        detailView: action.view,
        detailPose: NEUTRAL_DETAIL_POSE,
        detailReturnProgress: state.detailView
          ? state.detailReturnProgress
          : displayedUnfold(state),
        // 固定装配姿态使特写取景和机构净空可重复。
        tilt: tiltReducer(state.tilt, { type: "scrub", progress: 1 }),
        jointSide: null,
        cameraView: "perspective",
        cameraReset: state.cameraReset + 1,
      };
    case "detail-pose":
      if (
        !state.detailView ||
        !allowsDetailControl(state.detailView, action.control) ||
        !Number.isFinite(action.degrees)
      )
        return state;
      return {
        ...state,
        detailPose: updateDetailPose(
          state.detailPose,
          action.control,
          action.degrees,
        ),
      };
    case "detail-neutral":
      return { ...state, detailPose: NEUTRAL_DETAIL_POSE };
    case "close-detail":
      return {
        ...neutralDetails(state),
        cameraView: "perspective",
        cameraReset: state.cameraReset + 1,
      };
    case "reset":
      return {
        ...INITIAL_EXPERIENCE,
        tilt: tiltReducer(state.tilt, { type: "reset" }),
        cameraReset: state.cameraReset + 1,
      };
  }
}

export function useExperience(acceptInput = true) {
  const [state, reducerDispatch] = useReducer(
    experienceReducer,
    INITIAL_EXPERIENCE,
  );
  const dispatch = (action: ExperienceAction) => {
    if (acceptInput) reducerDispatch(action);
  };
  const setter =
    <K extends keyof ExperienceState>(key: K) =>
    (value: SetStateAction<ExperienceState[K]>) =>
      dispatch({ type: "set", key, value } as ExperienceAction);
  return {
    state,
    dispatch,
    setTime: setter("time"),
    setPlaying: setter("playing"),
    setInspection: setter("inspection"),
    setJointSide: setter("jointSide"),
    setCameraView: setter("cameraView"),
    setCameraReset: setter("cameraReset"),
    setAutoRotate: setter("autoRotate"),
    setExploded: setter("exploded"),
  };
}
