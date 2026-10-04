/** 独立细节检视参数是保守的模型行程，不是原厂舵面限位或实飞控制律。 */
export type DetailView =
  "wing" | "tail" | "cargo" | "sensors" | "motors" | "systems";
export type DetailControl = "inboard" | "outboard" | "tail" | "hatch";
export type DetailPose = Record<DetailControl, number>;
export const NEUTRAL_DETAIL_POSE: DetailPose = {
  inboard: 0,
  outboard: 0,
  tail: 0,
  hatch: 0,
};
export const DETAIL_LIMITS: Record<DetailControl, readonly [number, number]> = {
  inboard: [-12, 12],
  outboard: [-12, 12],
  tail: [-12, 12],
  hatch: [0, 55],
};
export const DETAIL_VIEWS: ReadonlyArray<{
  id: DetailView;
  label: string;
  description: string;
  controls: readonly DetailControl[];
}> = [
  {
    id: "wing",
    label: "主翼舵面",
    description:
      "每翼内、外两片副翼。同步偏转用于检查柔性铰接位置与间隙，不代表滚转控制律。",
    controls: ["inboard", "outboard"],
  },
  {
    id: "tail",
    label: "V 尾舵面",
    description:
      "两片 V 尾方向升降舵。仅展示有限偏转，不推断实际俯仰、偏航混控。",
    controls: ["tail"],
  },
  {
    id: "cargo",
    label: "前货舱盖",
    description:
      "观察分体舱盖、锁扣与壳口。开启行程与铰轴为模型示意，非原厂机构尺寸。",
    controls: ["hatch"],
  },
  {
    id: "sensors",
    label: "外露探头",
    description:
      "左侧尾尖空速静压探头依据手册与外观重建。安装细部为近似，不宣称真实测量精度。",
    controls: [],
  },
  {
    id: "motors",
    label: "电机外形",
    description:
      "观察右前动力舱、电机轴与桨毂。每个吊舱内含一台电机与一个电调有手册依据。",
    controls: [],
  },
  {
    id: "systems",
    label: "电机 / 电调",
    description:
      "独立概念模块：每吊舱电机＋电调有手册依据；形状、布置细节为概念示意。",
    controls: [],
  },
];
export const DETAIL_CONTROL_LABELS: Record<DetailControl, string> = {
  inboard: "内侧副翼示意偏转",
  outboard: "外侧副翼示意偏转",
  tail: "V 尾舵面示意偏转",
  hatch: "货舱盖示意开启",
};
export function normalizeDetailPose(
  pose: Partial<DetailPose> = {},
): DetailPose {
  return Object.fromEntries(
    (Object.keys(DETAIL_LIMITS) as DetailControl[]).map((key) => {
      const [minimum, maximum] = DETAIL_LIMITS[key];
      const value = pose[key] ?? 0;
      return [
        key,
        Number.isFinite(value)
          ? Math.min(maximum, Math.max(minimum, value))
          : 0,
      ];
    }),
  ) as DetailPose;
}
export function controlsForDetail(view: DetailView) {
  return DETAIL_VIEWS.find((item) => item.id === view)!.controls;
}
