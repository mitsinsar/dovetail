// Multi-plate packing on a raster of each part's real footprint, so parts can
// nest into each other's empty space (bars inside an L corner). Bottom-left
// placement, 4 rotations, new plate when nothing fits.
import { bboxOf, type IndexedMesh } from './mesh';
import type { Vec3 } from './ops';
import { orientCandidates } from './orient';

export interface PlacedPart {
  index: number; // index into the input list
  plate: number;
  mesh: IndexedMesh; // oriented and positioned in plate coords (0..bed)
  fits: boolean;
}

export interface PackResult { plates: number; placed: PlacedPart[] }

interface Footprint {
  mesh: IndexedMesh; // rotated, min corner at origin
  w: number; h: number; // mask size in cells (dilated)
  runs: [number, number, number][]; // [row, x0, x1) free-space runs that must be empty
  size: [number, number];
  cells: number;
}

function rotateZ(mesh: IndexedMesh, quarter: number): IndexedMesh {
  const p = mesh.positions, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    const [rx, ry] = quarter === 1 ? [-y, x] : quarter === 2 ? [-x, -y] : quarter === 3 ? [y, -x] : [x, y];
    out[i] = rx; out[i + 1] = ry; out[i + 2] = p[i + 2];
  }
  const b = bboxOf(out);
  for (let i = 0; i < out.length; i += 3) { out[i] -= b.min[0]; out[i + 1] -= b.min[1]; out[i + 2] -= b.min[2]; }
  return { positions: out, indices: mesh.indices };
}

/** Rasterize the XY projection (cell centres + edges), then dilate by `pad` cells. */
function footprint(mesh: IndexedMesh, cell: number, pad: number): Footprint {
  const b = bboxOf(mesh.positions);
  const sw = b.max[0] - b.min[0], sh = b.max[1] - b.min[1];
  const cw = Math.max(1, Math.ceil(sw / cell)), ch = Math.max(1, Math.ceil(sh / cell));
  const grid = new Uint8Array(cw * ch);
  const mark = (x: number, y: number) => {
    const cx = Math.min(cw - 1, Math.max(0, Math.floor(x / cell))), cy = Math.min(ch - 1, Math.max(0, Math.floor(y / cell)));
    grid[cy * cw + cx] = 1;
  };
  const p = mesh.positions, ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const ax = p[ix[t] * 3], ay = p[ix[t] * 3 + 1];
    const bx = p[ix[t + 1] * 3], by = p[ix[t + 1] * 3 + 1];
    const cx = p[ix[t + 2] * 3], cy = p[ix[t + 2] * 3 + 1];
    // edges, sampled at half-cell steps (catches thin walls)
    for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]]) {
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cell / 2)) + 1;
      for (let s = 0; s <= steps; s++) mark(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    }
    // interior: cell centres inside the triangle
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / cell)), x1 = Math.min(cw - 1, Math.floor(Math.max(ax, bx, cx) / cell));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / cell)), y1 = Math.min(ch - 1, Math.floor(Math.max(ay, by, cy) / cell));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      if (grid[gy * cw + gx]) continue;
      const px = (gx + 0.5) * cell, py = (gy + 0.5) * cell;
      const w0 = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
      const w1 = (cx - bx) * (py - by) - (px - bx) * (cy - by);
      const w2 = (ax - cx) * (py - cy) - (px - cx) * (ay - cy);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) grid[gy * cw + gx] = 1;
    }
  }
  // dilate by `pad` cells (square), into a mask offset by pad
  const w = cw + 2 * pad, h = ch + 2 * pad;
  const mask = new Uint8Array(w * h);
  let cells = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (!grid[y * cw + x]) continue;
    cells++;
    for (let dy = 0; dy <= 2 * pad; dy++) {
      const row = (y + dy) * w;
      for (let dx = 0; dx <= 2 * pad; dx++) mask[row + x + dx] = 1;
    }
  }
  const runs: [number, number, number][] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) { x++; continue; }
      const s = x;
      while (x < w && mask[y * w + x]) x++;
      runs.push([y, s, x]);
    }
  }
  return { mesh, w, h, runs, size: [sw, sh], cells };
}

class Plate {
  occ: Uint8Array;
  prefix: Int32Array; // per row prefix sums of occupancy, (W + 1) per row
  constructor(public W: number, public H: number) {
    this.occ = new Uint8Array(W * H);
    this.prefix = new Int32Array((W + 1) * H);
  }
  free(row: number, x0: number, x1: number) {
    const base = row * (this.W + 1);
    return this.prefix[base + x1] - this.prefix[base + x0] === 0;
  }
  fits(f: Footprint, px: number, py: number) {
    if (px + f.w > this.W || py + f.h > this.H) return false;
    for (const [r, a, b] of f.runs) if (!this.free(py + r, px + a, px + b)) return false;
    return true;
  }
  /** Lowest row, then leftmost column where the footprint fits. */
  find(f: Footprint): [number, number] | null {
    for (let y = 0; y + f.h <= this.H; y++) for (let x = 0; x + f.w <= this.W; x++) if (this.fits(f, x, y)) return [x, y];
    return null;
  }
  place(f: Footprint, px: number, py: number) {
    const rows = new Set<number>();
    for (const [r, a, b] of f.runs) { for (let x = a; x < b; x++) this.occ[(py + r) * this.W + px + x] = 1; rows.add(py + r); }
    for (const r of rows) {
      const base = r * (this.W + 1);
      for (let x = 0; x < this.W; x++) this.prefix[base + x + 1] = this.prefix[base + x] + this.occ[r * this.W + x];
    }
  }
}

/**
 * Orient every part, then pack real footprints onto as few plates as possible.
 * `gap` is the spacing between parts; `margin` is kept free at the plate edge.
 */
export function packPlates(meshes: IndexedMesh[], bed: Vec3, gap = 4, margin = 2): PackResult {
  const usableW = bed[0] - 2 * margin, usableH = bed[1] - 2 * margin;
  const cell = Math.max(1, Math.round(Math.max(usableW, usableH) / 160)); // ~160 cells across
  const pad = Math.ceil(gap / 2 / cell);
  // plate grid includes `pad` cells beyond the usable area: dilation may spill there, the part may not
  const W = Math.floor(usableW / cell) + 2 * pad, H = Math.floor(usableH / cell) + 2 * pad;

  // each part: up to 3 orientations (best first), each with 4 rotations
  const items = meshes.map((m, index) => {
    const opts = orientCandidates(m, bed, 3).map((o) => ({
      height: o.size[2],
      rots: [0, 1, 2, 3].map((q) => footprint(rotateZ(o.mesh, q), cell, pad)),
    }));
    return { index, opts };
  });

  // greedy packing is order-sensitive: try several part orders × strategies and
  // keep the fewest plates (ties go to the earliest = most conservative run)
  const fp = (it: Item) => it.opts[0].rots[0];
  const orders: Item[][] = [
    [...items].sort((a, b) => fp(b).cells - fp(a).cells), // biggest area first
    [...items].sort((a, b) => Math.max(...fp(b).size) - Math.max(...fp(a).size)), // longest first
    [...items].sort((a, b) => fp(b).w * fp(b).h - fp(a).w * fp(a).h), // biggest bounding box first
  ];
  let seed = 12345; // deterministic shuffles so the same input always packs the same way
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 6; k++) {
    // perturbed area order: keeps big-first tendency, varies ties and near-ties
    orders.push([...items].map((it) => ({ it, key: fp(it).cells * (0.7 + 0.6 * rnd()) }))
      .sort((a, b) => b.key - a.key).map((x) => x.it));
  }
  const modes = items.some((it) => it.opts.length > 1) ? (['strict', 'best', 'compact'] as const) : (['strict'] as const);
  let best: PackResult | null = null;
  for (const order of orders) for (const mode of modes) {
    const r = runPack(order, W, H, cell, margin, usableW, usableH, bed, mode);
    if (!best || r.plates < best.plates) best = r;
  }
  return best!;
}

type Item = { index: number; opts: { height: number; rots: Footprint[] }[] };

function bestSpot(plate: Plate, rots: Footprint[], usableW: number, usableH: number) {
  let best: { f: Footprint; x: number; y: number } | null = null;
  for (const f of rots) {
    if (f.size[0] > usableW + 1e-6 || f.size[1] > usableH + 1e-6) continue;
    const hit = plate.find(f);
    if (hit && (!best || hit[1] < best.y || (hit[1] === best.y && hit[0] < best.x))) best = { f, x: hit[0], y: hit[1] };
  }
  return best;
}

/**
 * 'best': every part tries its best orientation on all open plates, then its
 * alternates on all open plates, then opens a plate in its best orientation.
 * 'compact': same, but parts open a plate in their smallest-footprint orientation.
 * 'strict': best orientation only.
 */
function runPack(items: Item[], W: number, H: number, cell: number, margin: number,
  usableW: number, usableH: number, bed: Vec3, mode: 'strict' | 'best' | 'compact'): PackResult {
  const plates: Plate[] = [];
  const placed: PlacedPart[] = [];
  const put = (it: Item, opt: Item['opts'][number], pi: number, spot: { f: Footprint; x: number; y: number }) => {
    plates[pi].place(spot.f, spot.x, spot.y);
    // mask cell (x, y) holds part-min-corner minus pad cells; plate cell 0 sits pad cells before the margin
    const ox = margin + spot.x * cell, oy = margin + spot.y * cell;
    placed.push({ index: it.index, plate: pi, mesh: translate(spot.f.mesh, [ox, oy, 0]), fits: opt.height <= bed[2] });
  };
  for (const it of items) {
    let done = false;
    const usable = mode === 'strict' ? it.opts.slice(0, 1) : it.opts;
    for (const opt of usable) {
      for (let pi = 0; pi < plates.length && !done; pi++) {
        const spot = bestSpot(plates[pi], opt.rots, usableW, usableH);
        if (spot) { put(it, opt, pi, spot); done = true; }
      }
      if (done) break;
    }
    if (done) continue;
    const order = mode === 'compact'
      ? [...it.opts].sort((p, q) => p.rots[0].cells - q.rots[0].cells)
      : usable;
    for (const opt of order) {
      plates.push(new Plate(W, H));
      const spot = bestSpot(plates[plates.length - 1], opt.rots, usableW, usableH);
      if (spot) { put(it, opt, plates.length - 1, spot); done = true; break; }
      plates.pop();
    }
    if (!done) { // too big for any plate: own plate, flagged
      plates.push(new Plate(W, H));
      placed.push({ index: it.index, plate: plates.length - 1, mesh: translate(it.opts[0].rots[0].mesh, [margin, margin, 0]), fits: false });
    }
  }
  placed.sort((a, b) => a.index - b.index);
  return { plates: plates.length, placed };
}

function translate(mesh: IndexedMesh, d: Vec3): IndexedMesh {
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i += 3) { out[i] = mesh.positions[i] + d[0]; out[i + 1] = mesh.positions[i + 1] + d[1]; out[i + 2] = mesh.positions[i + 2] + d[2]; }
  return { positions: out, indices: mesh.indices };
}
