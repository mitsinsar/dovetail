// Print orientation: choose which face goes down, then the Z rotation with the
// smallest footprint. Pure JS over indexed meshes.
import { bboxOf, type IndexedMesh } from './mesh';
import type { Vec3 } from './ops';

type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export interface Oriented {
  mesh: IndexedMesh; // rotated, min corner at the origin
  size: Vec3;
  overhang: number; // mm² of downward-facing area not on the bed
  contact: number; // mm² touching the bed
}

const OVERHANG_COS = Math.cos((45 * Math.PI) / 180);

function applyMat(m: Mat3, positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
  return out;
}

/** Rotation taking unit vector a onto unit vector b (Rodrigues). */
function rotationBetween(a: Vec3, b: Vec3): Mat3 {
  const v: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c < -0.999999) { // opposite: rotate 180° around any perpendicular axis
    const p: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ax = norm([a[1] * p[2] - a[2] * p[1], a[2] * p[0] - a[0] * p[2], a[0] * p[1] - a[1] * p[0]]);
    const [x, y, z] = ax;
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function triangleData(mesh: IndexedMesh) {
  const p = mesh.positions, ix = mesh.indices, n = ix.length / 3;
  const normals = new Float32Array(n * 3), areas = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    areas[t] = len / 2;
    if (len) { normals[t * 3] = nx / len; normals[t * 3 + 1] = ny / len; normals[t * 3 + 2] = nz / len; }
  }
  return { normals, areas, n };
}

/** Score one "this normal points down" candidate. */
function evaluate(mesh: IndexedMesh, down: Vec3) {
  const R = rotationBetween(down, [0, 0, -1]);
  const pos = applyMat(R, mesh.positions);
  const rotated = { positions: pos, indices: mesh.indices };
  const { normals, areas, n } = triangleData(rotated);
  let minZ = Infinity;
  for (let i = 2; i < pos.length; i += 3) minZ = Math.min(minZ, pos[i]);
  let contact = 0, overhang = 0;
  const ix = mesh.indices;
  for (let t = 0; t < n; t++) {
    const nz = normals[t * 3 + 2];
    if (nz > -OVERHANG_COS) continue;
    const zMax = Math.max(pos[ix[t * 3] * 3 + 2], pos[ix[t * 3 + 1] * 3 + 2], pos[ix[t * 3 + 2] * 3 + 2]);
    if (zMax - minZ < 0.05) contact += areas[t]; else overhang += areas[t];
  }
  return { R, pos, contact, overhang };
}

/** Rotate around Z to the minimum-area bounding rectangle (rotating calipers on the hull). */
function minAreaRectAngle(pos: Float32Array): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1]]);
  const hull = convexHull(pts);
  if (hull.length < 3) return 0;
  let best = 0, bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    const ang = -Math.atan2(y2 - y1, x2 - x1);
    const c = Math.cos(ang), s = Math.sin(ang);
    let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
    for (const [x, y] of hull) {
      const rx = x * c - y * s, ry = x * s + y * c;
      a = Math.min(a, rx); b = Math.max(b, rx); d = Math.min(d, ry); e = Math.max(e, ry);
    }
    const area = (b - a) * (e - d);
    if (area < bestArea - 1e-6) { bestArea = area; best = ang; }
  }
  return best;
}

function convexHull(points: [number, number][]): [number, number][] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Pick the best face to print on. Candidates are the largest flat areas
 * (triangles grouped by normal). Score favours little overhang, large bed
 * contact and a low part; orientations that don't fit the bed are dropped.
 */
export function orientForPrint(mesh: IndexedMesh, bed: Vec3): Oriented {
  return orientCandidates(mesh, bed, 1)[0];
}

/** Best `k` distinct orientations, best first. Unfit orientations only appear if nothing fits. */
export function orientCandidates(mesh: IndexedMesh, bed: Vec3, k = 3): Oriented[] {
  const { normals, areas, n } = triangleData(mesh);
  const groups = new Map<string, { n: Vec3; area: number }>();
  let total = 0;
  for (let t = 0; t < n; t++) {
    total += areas[t];
    const nn: Vec3 = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
    const key = nn.map((v) => Math.round(v * 50)).join(',');
    const g = groups.get(key);
    if (g) g.area += areas[t]; else groups.set(key, { n: nn, area: areas[t] });
  }
  const candidates = [...groups.values()].sort((a, b) => b.area - a.area).slice(0, 10).map((g) => g.n);
  candidates.push([0, 0, -1]); // as modelled

  const maxDim = Math.max(...bboxOf(mesh.positions).max.map((v, k) => v - bboxOf(mesh.positions).min[k])) || 1;
  const scored: { score: number; pos: Float32Array; contact: number; overhang: number }[] = [];
  for (const down of candidates) {
    const e = evaluate(mesh, down);
    const angle = minAreaRectAngle(e.pos);
    const pos = rotateZ(e.pos, angle);
    const b = bboxOf(pos);
    const size = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
    const fitsFlat = (size[0] <= bed[0] && size[1] <= bed[1]) || (size[1] <= bed[0] && size[0] <= bed[1]);
    const score = (fitsFlat && size[2] <= bed[2] ? 0 : 1e6)
      + (e.overhang / total) * 3 - (e.contact / total) * 1.5 + (size[2] / maxDim) * 0.6;
    scored.push({ score, pos, contact: e.contact, overhang: e.overhang });
  }
  scored.sort((a, b) => a.score - b.score);
  const picked: Oriented[] = [];
  for (const c of scored) {
    if (picked.length >= k) break;
    if (picked.length && c.score >= 1e6) break; // never fall back to an unfit orientation
    const o = finish(c.pos, c.contact, c.overhang, mesh);
    // skip near-duplicates (same footprint and height)
    // skip near-duplicates: same size and same handedness (a flipped L nests differently, so keep it)
    if (picked.some((p) => p.size.every((v, i) => Math.abs(v - o.size[i]) < 0.5) && skew(p.mesh) === skew(o.mesh))) continue;
    if (picked.length) {
      // alternates must stay printable: not much taller than the best, and not a tall thin tower
      const h0 = picked[0].size[2];
      if (o.size[2] > Math.max(h0 * 1.6, h0 + 20)) continue;
      if (o.size[2] > 2 * Math.min(o.size[0], o.size[1])) continue;
      if (c.overhang > picked[0].overhang * 1.5 + 100) continue;
    }
    picked.push(o);
  }
  return picked;
}

function finish(pos: Float32Array, contact: number, overhang: number, mesh: IndexedMesh): Oriented {
  // long side along X, min corner at the origin
  let b = bboxOf(pos);
  let out = pos;
  if (b.max[1] - b.min[1] > b.max[0] - b.min[0]) { out = rotateZ(pos, Math.PI / 2); b = bboxOf(out); }
  for (let i = 0; i < out.length; i += 3) { out[i] -= b.min[0]; out[i + 1] -= b.min[1]; out[i + 2] -= b.min[2]; }
  return {
    mesh: { positions: out, indices: mesh.indices },
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    contact, overhang,
  };
}

/** Sign of the footprint's product of inertia: tells a shape from its mirror image. */
function skew(mesh: IndexedMesh): number {
  const p = mesh.positions;
  let cx = 0, cy = 0;
  const n = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; }
  cx /= n; cy /= n;
  let ixy = 0, scale = 0;
  for (let i = 0; i < p.length; i += 3) { ixy += (p[i] - cx) * (p[i + 1] - cy); scale += Math.abs((p[i] - cx) * (p[i + 1] - cy)); }
  return Math.abs(ixy) < scale * 0.05 ? 0 : Math.sign(ixy);
}

function rotateZ(pos: Float32Array, a: number): Float32Array {
  const c = Math.cos(a), s = Math.sin(a);
  return applyMat([c, -s, 0, s, c, 0, 0, 0, 1], pos);
}

export function translate(mesh: IndexedMesh, d: Vec3): IndexedMesh {
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i += 3) { out[i] = mesh.positions[i] + d[0]; out[i + 1] = mesh.positions[i + 1] + d[1]; out[i + 2] = mesh.positions[i + 2] + d[2]; }
  return { positions: out, indices: mesh.indices };
}

export function swapXY(mesh: IndexedMesh): IndexedMesh {
  // 90° rotation then shift back to positive quadrant
  const r = rotateZ(mesh.positions, Math.PI / 2);
  const b = bboxOf(r);
  for (let i = 0; i < r.length; i += 3) { r[i] -= b.min[0]; r[i + 1] -= b.min[1]; }
  return { positions: r, indices: mesh.indices };
}
