// Auto-split: pick axis-aligned cut planes so every cell fits the bed, then
// slide each cut to a cheap spot using the model's cross-section profile.
import type { Manifold } from 'manifold-3d';
import type { Vec3 } from './ops';

export type Axis = 0 | 1 | 2;

export interface AxisCut { axis: Axis; pos: number }

export interface AutoSplitOptions {
  bed: Vec3;
  margin: number; // mm kept free on each bed axis (brim, skirt, tolerance)
  minPart: number; // mm, smallest allowed segment / distance from a feature edge
  reserve?: number; // mm kept free per segment for connectors that stick out (pegs, tenons)
  samples?: number; // profile resolution per axis
}

export interface AutoSplitResult {
  cuts: AxisCut[];
  bedAxisForModelAxis: [Axis, Axis, Axis]; // which bed dimension each model axis was fitted to
  profiles: { axis: Axis; lo: number; hi: number; areas: number[] }[];
}

/** Cross-section area of `solid` at `n + 1` evenly spaced positions along `axis`. */
export function crossSectionProfile(solid: Manifold, axis: Axis, lo: number, hi: number, n: number): number[] {
  // rotate so `axis` becomes Z, then slice horizontally
  const rotated = axis === 2 ? solid : axis === 0 ? solid.rotate([0, -90, 0]) : solid.rotate([90, 0, 0]);
  const areas: number[] = [];
  for (let i = 0; i <= n; i++) {
    const cs = rotated.slice(lo + ((hi - lo) * i) / n);
    areas.push(cs.area());
    cs.delete();
  }
  if (rotated !== solid) rotated.delete();
  return areas;
}

/**
 * Choose cut positions along one axis.
 * Cost of a cut = its cross-section area (smaller face = less to join, cutting
 * through empty space is free) + a penalty near abrupt profile changes (cuts
 * that land just beside a feature leave slivers) + a small pull toward the
 * uniform grid position. Dynamic programming over sample positions keeps every
 * segment between `minPart` and `maxSeg`.
 */
export function chooseCuts(areas: number[], lo: number, hi: number, maxSeg: number, minPart: number): number[] | null {
  const len = hi - lo;
  if (len <= maxSeg) return [];
  const n = areas.length - 1;
  const h = len / n;
  const pos = (i: number) => lo + i * h;
  const maxA = Math.max(...areas) || 1;
  const win = Math.max(1, Math.round(minPart / h));

  const base = areas.map((a, i) => {
    let edge = 0;
    for (let d = -win; d <= win; d++) {
      const j = i + d;
      if (j >= 0 && j <= n) edge = Math.max(edge, Math.abs(areas[j] - a));
    }
    return a / maxA + (edge / maxA) * 0.8;
  });

  for (let segs = Math.ceil(len / maxSeg); segs <= Math.ceil(len / maxSeg) + 3; segs++) {
    const k = segs - 1; // number of cuts
    const uniform = (c: number) => lo + ((c + 1) * len) / segs;
    const cost = (c: number, i: number) => base[i] + 0.15 * Math.abs(pos(i) - uniform(c)) / maxSeg;
    // best[c][i]: min cost with cut c at sample i; prev for backtracking
    const best: number[][] = [];
    const prev: number[][] = [];
    for (let c = 0; c < k; c++) {
      best.push(new Array(n + 1).fill(Infinity));
      prev.push(new Array(n + 1).fill(-1));
      for (let i = 1; i < n; i++) {
        const p = pos(i);
        if (c === 0) {
          const d = p - lo;
          if (d >= minPart && d <= maxSeg) best[c][i] = cost(c, i);
          continue;
        }
        for (let j = 0; j < i; j++) {
          if (!isFinite(best[c - 1][j])) continue;
          const d = p - pos(j);
          if (d < minPart || d > maxSeg) continue;
          const v = best[c - 1][j] + cost(c, i);
          if (v < best[c][i]) { best[c][i] = v; prev[c][i] = j; }
        }
      }
    }
    let end = -1, endCost = Infinity;
    for (let i = 0; i <= n; i++) {
      const d = hi - pos(i);
      if (d >= minPart && d <= maxSeg && best[k - 1][i] < endCost) { endCost = best[k - 1][i]; end = i; }
    }
    if (end < 0) continue;
    const cuts: number[] = [];
    for (let c = k - 1, i = end; c >= 0; i = prev[c][i], c--) cuts.unshift(pos(i));
    return cuts;
  }
  return null;
}

export function autoSplit(solid: Manifold, opts: AutoSplitOptions): AutoSplitResult {
  const box = solid.boundingBox();
  const lo = box.min as Vec3, hi = box.max as Vec3;
  const size = [0, 1, 2].map((k) => hi[k] - lo[k]);
  const samples = opts.samples ?? 240;
  const usable = opts.bed.map((b) => b - 2 * opts.margin) as Vec3;

  // model X/Y may go to either bed X/Y; pick the assignment with fewer cells
  const cells = (map: [Axis, Axis, Axis]) => map.reduce<number>((n, b, k) => n * Math.ceil(size[k] / usable[b]), 1);
  const straight: [Axis, Axis, Axis] = [0, 1, 2], swapped: [Axis, Axis, Axis] = [1, 0, 2];
  const map = cells(swapped) < cells(straight) ? swapped : straight;

  const cuts: AxisCut[] = [];
  const profiles: AutoSplitResult['profiles'] = [];
  for (const axis of [0, 1, 2] as Axis[]) {
    if (size[axis] <= usable[map[axis]]) continue;
    const maxSeg = usable[map[axis]] - (opts.reserve ?? 0);
    const areas = crossSectionProfile(solid, axis, lo[axis], hi[axis], samples);
    profiles.push({ axis, lo: lo[axis], hi: hi[axis], areas });
    const minPart = Math.min(opts.minPart, maxSeg / 3);
    let positions = chooseCuts(areas, lo[axis], hi[axis], maxSeg, minPart);
    // fall back to a uniform grid if constraints can't be met
    positions ??= Array.from({ length: Math.ceil(size[axis] / maxSeg) - 1 },
      (_, i) => lo[axis] + ((i + 1) * size[axis]) / Math.ceil(size[axis] / maxSeg));
    for (const pos of positions) cuts.push({ axis, pos });
  }
  return { cuts, bedAxisForModelAxis: map, profiles };
}

