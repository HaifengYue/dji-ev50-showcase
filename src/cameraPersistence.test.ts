/** 实际 React/R3F 挂载及 Three 镜头/OrbitControls；不声称浏览器像素或输入验收。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "@react-three/fiber";
import * as THREE from "three";
import { gsap } from "gsap";
import type { OrbitControls } from "three-stdlib";
import { CameraRig } from "./Scene";
import {
  INITIAL_EXPERIENCE,
  experienceReducer,
  type ExperienceAction,
} from "./experience";
import { boxCorners, getInspectionFrame } from "./inspection";
import { SimulationRuntime } from "./simulation";
import { measureModelRig } from "./rig";
import { loadRuntimeRig } from "../qa/lib/runtime-motor-motion.mts";

test("挂载真实CameraRig后机构全流程与重复可视层切换保留镜头和OrbitControls实例", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAct = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { devicePixelRatio: 1, matchMedia: () => ({ matches: true }) },
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const noop = () => {};
  // Rendering is deliberately stubbed. React effects, projection matrices and controls are real.
  const canvas = {
    style: {},
    clientWidth: 1000,
    clientHeight: 650,
    addEventListener: noop,
    removeEventListener: noop,
    ownerDocument: { addEventListener: noop, removeEventListener: noop },
    getBoundingClientRect: () => ({
      width: 1000,
      height: 650,
      left: 0,
      top: 0,
    }),
  } as unknown as HTMLCanvasElement;
  const renderer = {
    domElement: canvas,
    render: noop,
    setSize: noop,
    setPixelRatio: noop,
    shadowMap: {},
    xr: {
      addEventListener: noop,
      removeEventListener: noop,
      setAnimationLoop: noop,
    },
  } as unknown as THREE.WebGLRenderer;
  const root = createRoot(canvas);
  const runtime = new SimulationRuntime();
  try {
    const { rig } = await loadRuntimeRig();
    const measurements = measureModelRig(rig);
    await root.configure({
      gl: renderer,
      size: { width: 1000, height: 650, top: 0, left: 0 },
      frameloop: "never",
    });
    let experience = INITIAL_EXPERIENCE;
    let drive = false;
    let extra: Partial<ComponentProps<typeof CameraRig>> = {};
    const props = (): ComponentProps<typeof CameraRig> => ({
      runtime,
      view: experience.cameraView,
      reset: experience.cameraReset,
      autoRotate: experience.autoRotate,
      inspection: experience.inspection,
      measurements,
      exploded: experience.exploded,
      jointSide: experience.jointSide,
      flightView:
        !experience.tiltMode && (experience.time > 0 || experience.playing),
      tiltProgress: experience.tiltMode ? experience.tilt.progress : null,
      detailView: experience.detailView,
      systemBounds: null,
      internalDriveInspection: drive,
      ...extra,
    });
    let store!: ReturnType<typeof root.render>;
    let frameTime = 0;
    const render = async () => {
      await act(async () => {
        store = root.render(createElement(CameraRig, props()));
      });
      for (let frame = 0; frame < 4; frame++) {
        frameTime += 1 / 60;
        store.getState().advance(frameTime, false);
      }
    };
    const dispatch = async (action: ExperienceAction) => {
      experience = experienceReducer(experience, action);
      await render();
    };
    const snapshot = () => {
      const { camera, controls } = store.getState();
      const orbit = controls as unknown as OrbitControls;
      return {
        camera: camera.uuid,
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(),
        zoom: (camera as THREE.PerspectiveCamera).zoom,
        target: orbit.target.toArray(),
        rotate: orbit.enableRotate,
      };
    };
    const assertSameCamera = (
      expected: ReturnType<typeof snapshot>,
      label: string,
    ) => {
      const actual = snapshot();
      assert.equal(actual.camera, expected.camera, label);
      assert.equal(actual.rotate, expected.rotate, label);
      assert.equal(actual.zoom, expected.zoom, label);
      for (const field of ["position", "quaternion", "up", "target"] as const) {
        actual[field].forEach((value, axis) =>
          assert.ok(
            Math.abs(value - expected[field][axis]) < 1e-10,
            `${label}: ${field}[${axis}]`,
          ),
        );
      }
    };
    const assertMotionBoundsVisible = () => {
      const camera = store.getState().camera;
      camera.updateMatrixWorld(true);
      for (const point of boxCorners(measurements.bounds)) {
        point.project(camera);
        assert.ok(
          Math.abs(point.x) < 1 &&
            Math.abs(point.y) < 1 &&
            Math.abs(point.z) < 1,
          "initial/reset free view must fit the whole mechanism travel",
        );
      }
    };
    await render();
    assertMotionBoundsVisible();
    assert.equal(store.getState().camera.type, "PerspectiveCamera");
    assert.equal(
      (store.getState().controls as unknown as OrbitControls).enableRotate,
      true,
    );
    for (const mode of ["free", "top", "joint", "detail", "flight"] as const) {
      if (mode === "top") await dispatch({ type: "inspect", view: "top" });
      if (mode === "joint") await dispatch({ type: "joint", side: "L" });
      if (mode === "detail") await dispatch({ type: "detail", view: "wing" });
      if (mode === "flight") await dispatch({ type: "play-flight" });
      const camera = store.getState().camera as THREE.PerspectiveCamera;
      const controls = store.getState().controls as unknown as OrbitControls;
      // Simulate a user-selected panned, zoomed and rotated viewpoint, including below the aircraft.
      controls.enableDamping = false;
      controls.target.set(0.72, 1.93, -0.48);
      camera.position.set(-11.7, -2.4, 14.6);
      camera.zoom = 2.13;
      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
      controls.update();
      const before = snapshot();
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const action of [
          { type: "scrub", progress: 0.327 },
          { type: "begin", direction: 1 },
          { type: "tick", seconds: 0.25 },
          { type: "pause" },
          { type: "begin", direction: -1 },
          { type: "rate", value: 0.5 },
          { type: "repeat", enabled: true },
          { type: "reset" },
        ] as const) {
          await dispatch({ type: "enter-tilt" });
          await dispatch({ type: "tilt", action });
          assertSameCamera(before, `${mode}: ${JSON.stringify(action)}`);
          assert.equal(
            store.getState().controls,
            controls,
            "mechanism actions must not remount controls",
          );
        }
        drive = !drive;
        await render();
        assertSameCamera(before, `${mode}: internal drive`);
        assert.equal(store.getState().controls, controls);
        await dispatch({
          type: "set",
          key: "exploded",
          value: repeat % 2 === 0,
        });
        assertSameCamera(before, `${mode}: exploded view`);
        // Model changes can remove a detail focus without issuing a new framing request.
        extra = {
          detailView: null,
          jointSide: null,
          flightView: !props().flightView,
        };
        await render();
        assertSameCamera(before, `${mode}: mode transition`);
        await act(async () => {
          store.getState().setSize(650 + repeat * 50, 900);
        });
        assertSameCamera(before, `${mode}: resize`);
      }
      extra = {};
      drive = false;
    }
    // Explicit view commands still replace the viewpoint and reset orthographic zoom.
    const beforePreset = snapshot();
    await dispatch({ type: "inspect", view: "front" });
    assert.equal(store.getState().camera.type, "OrthographicCamera");
    assert.notDeepEqual(snapshot().position, beforePreset.position);
    assert.equal(snapshot().zoom, 1);
    // Repeated commands within the same orthographic camera must also clear an old pan target.
    for (const view of ["top", "side", "front", "front"] as const) {
      const controls = store.getState().controls as unknown as OrbitControls;
      controls.target.set(2.5, -1.1, 0.8);
      controls.object.position.set(-7, 4, 13);
      controls.update();
      await dispatch({ type: "inspect", view });
      const { size } = store.getState();
      const expected = getInspectionFrame(
        measurements.bounds,
        view,
        size.width / size.height,
      );
      assert.ok(
        new THREE.Vector3(...snapshot().target).distanceTo(expected.target) <
          1e-10,
      );
      assert.ok(
        store.getState().camera.position.distanceTo(expected.position) < 1e-10,
      );
    }
    await dispatch({ type: "reset" });
    assertMotionBoundsVisible();
    assert.equal(store.getState().camera.type, "PerspectiveCamera");
    assert.equal(snapshot().rotate, true);

    // Exercise an interrupted real GSAP view transition without waiting for wall-clock animation.
    window.matchMedia = (media) => ({
      matches: false,
      media,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => true,
    });
    await dispatch({ type: "inspect", view: "top" });
    const cameraTweens = () =>
      gsap.globalTimeline
        .getChildren(false, true, false)
        .filter((item) => item.duration() === 1.05);
    assert.equal(cameraTweens().length, 1);
    const pending = cameraTweens()[0];
    pending.pause();
    await act(async () => {
      pending.progress(0.35);
    });
    const midway = store.getState().camera.position.clone();
    await dispatch({ type: "enter-tilt" });
    await dispatch({ type: "tilt", action: { type: "begin", direction: 1 } });
    assert.equal(
      cameraTweens()[0],
      pending,
      "mechanism input must not restart an in-progress view command",
    );
    assert.ok(store.getState().camera.position.distanceTo(midway) < 1e-10);
    await act(async () => {
      store.getState().setSize(720, 960);
    });
    await act(async () => {
      pending.progress(1);
    });
    const orthographic = store.getState().camera as THREE.OrthographicCamera;
    assert.ok(
      Math.abs(
        (orthographic.right - orthographic.left) /
          (orthographic.top - orthographic.bottom) -
          0.75,
      ) < 1e-10,
    );
    // A newer explicit preset replaces the unfinished older command.
    await dispatch({ type: "inspect", view: "front" });
    const replaced = cameraTweens()[0];
    await dispatch({ type: "inspect", view: "side" });
    assert.equal(cameraTweens().length, 1);
    assert.notEqual(cameraTweens()[0], replaced);
    await act(async () => {
      cameraTweens()[0].progress(1);
    });
    const final = getInspectionFrame(measurements.bounds, "side", 0.75);
    assert.ok(
      store.getState().camera.position.distanceTo(final.position) < 1e-10,
    );
    assert.ok(
      new THREE.Vector3(...snapshot().target).distanceTo(final.target) < 1e-10,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    runtime.dispose();
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalAct)
      Object.defineProperty(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT",
        originalAct,
      );
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
