import { bboxOf, sizeOf, type IndexedMesh } from './mesh';
import { placeOnBed } from './ops';

export type Fit = 'fits' | 'rotate' | 'too-big';

/** Does a part of size `s` fit a bed of size `bed`, as-is or after rotating? */
export function fitOf(s: [number, number, number], bed: [number, number, number]): Fit {
  if (s[0] <= bed[0] && s[1] <= bed[1] && s[2] <= bed[2]) return 'fits';
  const a = [...s].sort((x, y) => x - y), b = [...bed].sort((x, y) => x - y);
  return a.every((v, i) => v <= b[i]) ? 'rotate' : 'too-big';
}

/**
 * Simple shelf packing on the plate, centered on (0, 0). Slicers re-arrange
 * anyway; this just keeps parts from overlapping when the 3MF opens.
 */
export function layoutOnPlate(meshes: IndexedMesh[], bed: [number, number, number], gap = 8): IndexedMesh[] {
  const sized = meshes.map((m, i) => ({ i, s: sizeOf(bboxOf(m.positions)) }));
  const out: IndexedMesh[] = new Array(meshes.length);
  let x = -bed[0] / 2, y = -bed[1] / 2, rowH = 0;
  for (const { i, s } of sized) {
    if (x + s[0] > bed[0] / 2 && x > -bed[0] / 2) { x = -bed[0] / 2; y += rowH + gap; rowH = 0; }
    out[i] = placeOnBed(meshes[i], x + s[0] / 2, y + s[1] / 2);
    x += s[0] + gap;
    rowH = Math.max(rowH, s[1]);
  }
  return out;
}
