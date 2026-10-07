/** 与 GLB 铰轴后缀和 transwing.sim.v1 既有状态保持一致。 */
export const SURFACE_IDS = [
  "L_Inboard",
  "R_Inboard",
  "L_Outboard",
  "R_Outboard",
  "Tail_L",
  "Tail_R",
] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];
export const SURFACE_GROUPS = {
  inboard: ["L_Inboard", "R_Inboard"],
  outboard: ["L_Outboard", "R_Outboard"],
  tail: ["Tail_L", "Tail_R"],
} as const;
export type SurfaceGroup = keyof typeof SURFACE_GROUPS;
export const SURFACE_CONTROLS = {
  inboard_L: "L_Inboard",
  inboard_R: "R_Inboard",
  outboard_L: "L_Outboard",
  outboard_R: "R_Outboard",
  tail_L: "Tail_L",
  tail_R: "Tail_R",
} as const;
export type SurfaceControl = keyof typeof SURFACE_CONTROLS;
export type SurfaceInput = SurfaceId | SurfaceControl | SurfaceGroup;
export type SurfacePatch = Partial<Record<SurfaceInput, number>>;
export type SurfacePose = Record<SurfaceId, number>;

/** 协议入口原子拒绝非法值；同次输入中单项覆盖分组，既有 ID 覆盖别名。 */
export function resolveSurfacePatch(input: unknown): Partial<SurfacePose> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    throw new Error("surfaces 必须为普通对象");
  const patch = input as SurfacePatch;
  const allowed: readonly string[] = [
    ...SURFACE_IDS,
    ...Object.keys(SURFACE_CONTROLS),
    ...Object.keys(SURFACE_GROUPS),
  ];
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new Error("surfaces 含未知字段");
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 12
    )
      throw new Error(`${key} 超出有效范围 [-12, 12]`);
  }
  const result: Partial<SurfacePose> = {};
  for (const group of Object.keys(SURFACE_GROUPS) as SurfaceGroup[])
    if (Object.hasOwn(patch, group))
      for (const id of SURFACE_GROUPS[group]) result[id] = patch[group];
  for (const control of Object.keys(SURFACE_CONTROLS) as SurfaceControl[])
    if (Object.hasOwn(patch, control))
      result[SURFACE_CONTROLS[control]] = patch[control];
  for (const id of SURFACE_IDS)
    if (Object.hasOwn(patch, id)) result[id] = patch[id];
  return result;
}
