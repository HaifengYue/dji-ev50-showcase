export const PHASES = [
  {
    id: "idle",
    label: "待命",
    en: "STANDBY",
    duration: 3,
    detail: "整翼收拢，等待垂直起飞。",
  },
  {
    id: "takeoff",
    label: "垂直起飞",
    en: "TAKEOFF",
    duration: 6,
    detail: "机翼沿机身收拢，四旋翼提供垂直升力。",
  },
  {
    id: "hover",
    label: "稳定悬停",
    en: "HOVER",
    duration: 5,
    detail: "保持悬停姿态，为连续转换建立条件。",
  },
  {
    id: "wing-transition",
    label: "整翼转换",
    en: "TRANSITION",
    duration: 9,
    detail: "左右整翼绕倾斜铰链转动，动力单元随机翼一起改变方向。",
  },
  {
    id: "cruise",
    label: "固定翼巡航",
    en: "CRUISE",
    duration: 8,
    detail: "机翼完全展开，由固定翼构型提供巡航升力。",
  },
  {
    id: "orbit",
    label: "环绕飞行",
    en: "ORBIT",
    duration: 10,
    detail: "巡航构型执行连续转弯，观察机体与整翼的空间关系。",
  },
  {
    id: "deceleration-transition",
    label: "减速回转",
    en: "RETURN",
    duration: 9,
    detail: "整翼平滑回转，逐步恢复垂直升力构型。",
  },
  {
    id: "landing",
    label: "垂直降落",
    en: "LANDING",
    duration: 7,
    detail: "下降至起降平台，旋翼逐步减速。",
  },
] as const;
export type PhaseId = (typeof PHASES)[number]["id"];
export const TOTAL = PHASES.reduce((s, p) => s + p.duration, 0);
export const phaseStart = (index: number) =>
  PHASES.slice(0, index).reduce((s, p) => s + p.duration, 0);
const smooth = (t: number) => t * t * (3 - 2 * t);
export function getFlight(time: number) {
  const t = time >= TOTAL ? 0 : Math.max(0, time);
  let index = 0,
    start = 0;
  for (let i = 0; i < PHASES.length; i++) {
    if (t >= phaseStart(i)) {
      index = i;
      start = phaseStart(i);
    }
  }
  const progress = Math.min(1, (t - start) / PHASES[index].duration),
    u = smooth(progress);
  let altitude = 0,
    unfold = 0,
    speed = 0,
    yaw = 0,
    bank = 0,
    rpm = 0;
  switch (index) {
    case 0:
      rpm = u * 0.3;
      break;
    case 1:
      altitude = 4 * u;
      rpm = 0.3 + 0.7 * u;
      break;
    case 2:
      altitude = 4;
      rpm = 1;
      break;
    case 3:
      altitude = 4 + u;
      unfold = u;
      speed = u;
      rpm = 1;
      break;
    case 4:
      altitude = 5;
      unfold = 1;
      speed = 1;
      rpm = 1;
      break;
    case 5:
      altitude = 5;
      unfold = 1;
      speed = 1;
      rpm = 1;
      yaw = 2 * Math.PI * u;
      bank = -Math.sin(Math.PI * progress) * 0.24;
      break;
    case 6:
      altitude = 5 - u;
      unfold = 1 - u;
      speed = 1 - u;
      rpm = 1;
      break;
    case 7:
      altitude = 4 * (1 - u);
      rpm = 1 - u;
      break;
  }
  // 连续闭合航迹：起飞点即降落点，位置与航向在阶段边界保持连续。
  let pathAngle = 0;
  if (index === 3) pathAngle = (u * Math.PI) / 4;
  if (index === 4) pathAngle = Math.PI / 4 + (u * Math.PI) / 4;
  if (index === 5) pathAngle = Math.PI / 2 + u * Math.PI;
  if (index === 6) pathAngle = Math.PI * 1.5 + (u * Math.PI) / 2;
  if (index === 7) pathAngle = Math.PI * 2;
  yaw = pathAngle;
  bank =
    -Math.sin(Math.PI * unfold) * 0.08 -
    (index === 5 ? Math.sin(Math.PI * progress) * 0.14 : 0);
  const x = 2 * (1 - Math.cos(pathAngle)),
    z = 2 * Math.sin(pathAngle);
  return {
    index,
    progress,
    altitude,
    unfold,
    speed,
    yaw,
    bank,
    rpm,
    x,
    z,
    phase: PHASES[index],
  };
}
export function advanceTime(time: number, delta: number, loop: boolean) {
  const next = time + Math.max(0, delta);
  return next > TOTAL ? (loop ? next % TOTAL : TOTAL) : next;
}
