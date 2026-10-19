import { r } from "./sketch";

type Point = readonly [number, number];

/**
 * A fixed number in -1..1 for (seed, i), so a drawing can look hand-made and still be the same on every render:
 * integer arithmetic only (mulberry32's mix), so the server, the client and every browser get the same bits.
 */
export function wobble(seed: number, i: number): number {
  let t = (seed * 7919 + i * 104729 + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}

/**
 * A ruled line drawn by hand, a to b: it starts a little before a and runs a little past b (corners cross, the way
 * a sketched box's do), and bends `amp` units either way through its thirds. `from` and `to` (0..1) draw only part
 * of it: a second, lighter pass over a stretch of the first.
 */
export function roughLine(
  a: Point,
  b: Point,
  seed: number,
  { amp = 0.4, overshoot = 0.8, from = 0, to = 1, shift = 0 } = {},
): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // The normal, to the line's left.
  const nx = uy;
  const ny = -ux;
  const o0 = overshoot * (0.5 + 0.5 * Math.abs(wobble(seed, 1)));
  const o1 = overshoot * (0.5 + 0.5 * Math.abs(wobble(seed, 2)));
  const s = -o0 + (length + o0 + o1) * from;
  const e = -o0 + (length + o0 + o1) * to;
  const at = (d: number, off: number): Point => [
    a[0] + ux * d + nx * (off + shift),
    a[1] + uy * d + ny * (off + shift),
  ];
  const p0 = at(s, 0);
  const c1 = at(s + (e - s) / 3, amp * wobble(seed, 3));
  const c2 = at(s + ((e - s) * 2) / 3, amp * wobble(seed, 4));
  const p1 = at(e, 0);
  return `M${r(p0[0])} ${r(p0[1])}C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p1[0])} ${r(p1[1])}`;
}

/** A cubic Bézier and its unit tangent at t. */
function cubic(p: readonly Point[], t: number): [Point, Point] {
  const m = 1 - t;
  const x =
    m * m * m * p[0][0] +
    3 * m * m * t * p[1][0] +
    3 * m * t * t * p[2][0] +
    t * t * t * p[3][0];
  const y =
    m * m * m * p[0][1] +
    3 * m * m * t * p[1][1] +
    3 * m * t * t * p[2][1] +
    t * t * t * p[3][1];
  const tx =
    3 * m * m * (p[1][0] - p[0][0]) +
    6 * m * t * (p[2][0] - p[1][0]) +
    3 * t * t * (p[3][0] - p[2][0]);
  const ty =
    3 * m * m * (p[1][1] - p[0][1]) +
    6 * m * t * (p[2][1] - p[1][1]) +
    3 * t * t * (p[3][1] - p[2][1]);
  const l = Math.hypot(tx, ty) || 1;
  return [
    [x, y],
    [tx / l, ty / l],
  ];
}

/** The point on a cubic whose x is `x`, for a curve that runs left to right: bisection, arithmetic only. */
export function pointAtX(curve: readonly Point[], x: number): Point {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(curve, mid)[0][0] < x) lo = mid;
    else hi = mid;
  }
  return cubic(curve, (lo + hi) / 2)[0];
}

/**
 * A brush stroke along a cubic, as a filled shape: `width(t)` units across at each point, so it can start fine,
 * swell and tail off. `vertical` measures the width straight up and down instead of across the curve, for a
 * layer that stretches sideways: a stretch then never thins it.
 */
export function brush(
  curve: readonly Point[],
  width: (t: number) => number,
  { steps = 28, vertical = false } = {},
): string {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [[x, y], [tx, ty]] = cubic(curve, t);
    const half = width(t) / 2;
    const [nx, ny] = vertical ? [0, -1] : [ty, -tx];
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  }
  const points = [...left, ...right.reverse()];
  return (
    points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${r(x)} ${r(y)}`)
      .join("") + "Z"
  );
}

/** Thin, then full, then `end`: the profile of a stroke that starts with a light touch. */
export function swell(start: number, full: number, end: number, peak = 0.55) {
  return (t: number) =>
    t < peak
      ? start + (full - start) * Math.sin((t / peak) * (Math.PI / 2))
      : full + (end - full) * ((t - peak) / (1 - peak)) ** 1.4;
}
