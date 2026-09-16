// [source animation time, displayed mission time]. Smooth monotone time warp.
const anchors = [
  [0, 0],
  [3, 1],
  [6, 4],
  [11, 16],
  [14, 18],
  [20, 42],
  [44, 138],
  [50, 162],
  [52, 164],
  [57, 176],
  [60, 180],
];
export const MISSION_DURATION = 180;
export function sourceTime(time: number) {
  const t = Math.max(0, Math.min(MISSION_DURATION, time));
  let k = 0;
  while (k < anchors.length - 2 && t >= anchors[k + 1][1]) k++;
  const slope = (i: number) =>
    (anchors[i + 1][0] - anchors[i][0]) / (anchors[i + 1][1] - anchors[i][1]);
  const tangent = (i: number) =>
    i === 0
      ? slope(0)
      : i === anchors.length - 1
        ? slope(i - 1)
        : 2 / (1 / slope(i - 1) + 1 / slope(i));
  const [a, start] = anchors[k],
    [b, end] = anchors[k + 1],
    h = end - start,
    u = (t - start) / h,
    m0 = tangent(k) * h,
    m1 = tangent(k + 1) * h;
  return {
    time:
      (2 * u ** 3 - 3 * u * u + 1) * a +
      (u ** 3 - 2 * u * u + u) * m0 +
      (-2 * u ** 3 + 3 * u * u) * b +
      (u ** 3 - u * u) * m1,
    rate:
      ((6 * u * u - 6 * u) * a +
        (3 * u * u - 4 * u + 1) * m0 +
        (-6 * u * u + 6 * u) * b +
        (3 * u * u - 2 * u) * m1) /
      h,
  };
}
