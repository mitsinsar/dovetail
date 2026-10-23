// Connectors: auto-placement on cut faces + boolean application to parts.
import type { CrossSection, Manifold, ManifoldToplevel, Mat4, SimplePolygon } from 'manifold-3d';
import type { Plane, Vec3 } from './ops';

export type ConnectorType = 'peg' | 'dowel' | 'dovetail';

export interface Connector {
  id: string;
  plane: number; // index into the plane list
  type: ConnectorType;
  at: Vec3; // centre on the cut plane, world mm
  radius: number; // peg/dowel radius; dovetail half of the narrow width
  depth: number; // how far it reaches into each side
  slide: Vec3; // dovetail slide direction (unit, in plane); unused otherwise
  length: number; // dovetail tenon length along `slide`
  clearance?: number; // per-connector override (mm per side)
}

export interface ConnectorSettings {
  type: ConnectorType | 'none';
  clearance: Record<ConnectorType, number>; // mm per side
  maxPerFace: number;
  minPart: number;
}

export const DEFAULT_CLEARANCE: Record<ConnectorType, number> = { peg: 0.15, dowel: 0.1, dovetail: 0.25 };
const WALL = 1.2; // min material around a hole
const DOVETAIL_FLARE = Math.tan((15 * Math.PI) / 180);

// ---------- small vector helpers ----------
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));

/** Orthonormal in-plane basis (u, v) for normal n. u is horizontal when possible. */
export function planeBasis(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, n));
  return [u, cross(n, u)];
}

/** Column-major matrix mapping local (x, y, z) to world x*a + y*b + z*c + t. */
function frame(a: Vec3, b: Vec3, c: Vec3, t: Vec3): Mat4 {
  return [...a, 0, ...b, 0, ...c, 0, ...t, 1] as Mat4;
}
/** Inverse of an orthonormal frame (world -> local). */
function inverseFrame(a: Vec3, b: Vec3, c: Vec3, t: Vec3): Mat4 {
  return [a[0], b[0], c[0], 0, a[1], b[1], c[1], 0, a[2], b[2], c[2], 0, -dot(a, t), -dot(b, t), -dot(c, t), 1] as Mat4;
}

// ---------- 2D helpers ----------
function pointInPolys(x: number, y: number, polys: SimplePolygon[]) {
  let inside = false; // even-odd over all contours handles holes
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function centroid(polys: SimplePolygon[]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
      a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f;
    }
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : [0, 0];
}

/** Largest inset distance at which the region still has area (≈ half its thinnest width). */
function maxInset(region: CrossSection): number {
  const b = region.bounds();
  let lo = 0, hi = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1]) / 2;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const r = region.offset(-mid);
    if (r.isEmpty() || r.area() < 1e-4) hi = mid; else lo = mid;
    r.delete();
  }
  return lo;
}

/** Spread k points inside `polys` (grid candidates + farthest-point sampling from the middle). */
function spreadPoints(polys: SimplePolygon[], k: number, minGap: number, seed: [number, number]): [number, number][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const step = Math.max((maxX - minX) / 40, (maxY - minY) / 40, 0.25);
  const cands: [number, number][] = [];
  for (let x = minX; x <= maxX; x += step) for (let y = minY; y <= maxY; y += step) if (pointInPolys(x, y, polys)) cands.push([x, y]);
  if (!cands.length) return [];
  const d2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const first = pointInPolys(seed[0], seed[1], polys) ? seed : cands.reduce((m, c) => (d2(c, seed) < d2(m, seed) ? c : m));
  if (k === 1) return [first];
  // for k > 1 start from the two extremes of the long axis, then fill in
  const chosen: [number, number][] = [];
  let far = cands.reduce((m, c) => (d2(c, first) > d2(m, first) ? c : m));
  chosen.push(far);
  while (chosen.length < k) {
    let best: [number, number] | null = null, bestD = -1;
    for (const c of cands) {
      const d = Math.min(...chosen.map((q) => d2(c, q)));
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best || Math.sqrt(bestD) < minGap) break;
    chosen.push(best);
    far = best;
  }
  return chosen;
}

/** Cross-section of the solid on a plane, in that plane's (u, v) coordinates. */
export function planeSection(solid: Manifold, plane: Plane) {
  const n = plane.normal;
  const [u, v] = planeBasis(n);
  const origin = mul(n, plane.offset);
  const local = solid.transform(inverseFrame(u, v, n, origin));
  const cs = local.slice(0);
  local.delete();
  return { cs, u, v, n, origin };
}

// ---------- auto placement ----------
export function placeConnectors(solid: Manifold, planes: Plane[], s: ConnectorSettings): { connectors: Connector[]; skipped: number } {
  const out: Connector[] = [];
  let skipped = 0;
  if (s.type === 'none') return { connectors: out, skipped };
  planes.forEach((plane, pi) => {
    const { cs, u, v, n, origin } = planeSection(solid, plane);
    const to3 = (x: number, y: number) => add(origin, add(mul(u, x), mul(v, y)));
    for (const region of cs.decompose()) {
      if (region.area() < 4) { region.delete(); continue; }
      const t = maxInset(region);
      const polys = region.toPolygons();
      const depthCap = connectorDepthCap(s.minPart);

      if (s.type === 'dovetail' && region.numContour() === 1) {
        const dt = placeDovetail(region, polys, t, u, v, n, to3, depthCap);
        if (dt) { out.push({ ...dt, id: `${pi}-${out.length}`, plane: pi }); region.delete(); continue; }
        // otherwise fall through to a peg
      }
      const type: ConnectorType = s.type === 'dowel' ? 'dowel' : 'peg';
      const clr = s.clearance[type];
      const r = Math.min(5, (t - WALL - clr) * 0.55);
      if (r < 1.2) { skipped++; region.delete(); continue; }
      const inset = region.offset(-(r + clr + WALL));
      if (inset.isEmpty()) { skipped++; inset.delete(); region.delete(); continue; }
      const ip = inset.toPolygons();
      const b = inset.bounds();
      const long = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
      const k = Math.max(1, Math.min(s.maxPerFace, 1 + Math.floor(long / (r * 7))));
      // seed at the deepest point of the region so a single connector sits in the thickest spot
      const deep = region.offset(-t * 0.9);
      const seed = deep.isEmpty() ? centroid(ip) : centroid(deep.toPolygons());
      deep.delete();
      for (const [x, y] of spreadPoints(ip, k, r * 4, seed)) {
        out.push({
          id: `${pi}-${out.length}`, plane: pi, type, at: to3(x, y), radius: round(r),
          depth: round(Math.min(depthCap, Math.max(4, r * 2.2))), slide: u, length: 0,
        });
      }
      inset.delete();
      region.delete();
    }
    cs.delete();
  });
  return { connectors: out, skipped };
}

function placeDovetail(region: CrossSection, polys: SimplePolygon[], t: number, u: Vec3, v: Vec3, n: Vec3,
  to3: (x: number, y: number) => Vec3, depthCap: number) {
  const b = region.bounds();
  const ex = b.max[0] - b.min[0], ey = b.max[1] - b.min[1];
  // slide vertically when Z lies in the plane (prints and assembles naturally), else along the short side
  const zIn = Math.abs(n[2]) < 0.15;
  const slideAlongU = zIn ? Math.abs(u[2]) > Math.abs(v[2]) : ex < ey;
  const across = slideAlongU ? ey : ex; // width available perpendicular to the slide
  const w = Math.min(16, Math.max(3, across * 0.3)); // narrow width at the face
  const depth = Math.min(depthCap, Math.max(3, w * 0.6), t * 1.5);
  if (w + 2 * depth * DOVETAIL_FLARE + 2 * WALL > across) return null;
  const [cx, cy] = centroid(polys);
  return {
    type: 'dovetail' as const, at: to3(cx, cy), radius: round(w / 2), depth: round(depth),
    slide: slideAlongU ? u : v, length: round((slideAlongU ? ex : ey) + 2),
  };
}

/** Longest a connector may reach into a part; auto-split reserves room for it. */
export const connectorDepthCap = (minPart: number) => Math.max(3, minPart * 0.45);

/** Room auto-split should leave per segment so protruding connectors still fit the bed. */
export function protrusionReserve(type: ConnectorType | 'none', minPart: number) {
  return type === 'peg' || type === 'dovetail' ? 2 * connectorDepthCap(minPart) : 0;
}

const round = (x: number) => Math.round(x * 100) / 100;

// ---------- application ----------
export interface AppliedResult { bodies: Manifold[]; pins: Manifold[]; used: Set<string> }

/** True if a tiny cube at p overlaps the body. */
function contains(wasm: ManifoldToplevel, body: Manifold, p: Vec3) {
  const bb = body.boundingBox();
  for (let k = 0; k < 3; k++) if (p[k] < bb.min[k] - 0.1 || p[k] > bb.max[k] + 0.1) return false;
  const probe = wasm.Manifold.cube([0.2, 0.2, 0.2], true).translate(p);
  const hit = body.intersect(probe);
  const yes = hit.volume() > 1e-6;
  probe.delete(); hit.delete();
  return yes;
}

/**
 * Apply connectors to the cut bodies. The body on the +normal side (A) gets
 * pegs/tenons; the body on the -normal side (B) gets matching holes/slots.
 * Dowels put holes in both and add a loose pin.
 */
export function applyConnectors(wasm: ManifoldToplevel, bodies: Manifold[], planes: Plane[], connectors: Connector[],
  clearance: Record<ConnectorType, number>): AppliedResult {
  const { Manifold, CrossSection } = wasm;
  const pins: Manifold[] = [];
  const used = new Set<string>();
  const seg = 32;

  for (const c of connectors) {
    const n = planes[c.plane]?.normal;
    if (!n) continue;
    const ia = bodies.findIndex((b) => contains(wasm, b, add(c.at, mul(n, 0.4))));
    const ib = bodies.findIndex((b) => contains(wasm, b, add(c.at, mul(n, -0.4))));
    if (ia < 0 || ib < 0 || ia === ib) continue;
    const clr = c.clearance ?? clearance[c.type];
    const [u, v] = planeBasis(n);
    const A = bodies[ia], B = bodies[ib];

    if (c.type === 'peg') {
      // right-handed frame with local z pointing into B (-n)
      const into = frame(v, u, mul(n, -1), c.at);
      const shaft = Manifold.cylinder(c.depth, c.radius, c.radius, seg).transform(into);
      const clipped = shaft.intersect(B); // never sticks out of a short neighbour
      const root = Manifold.cylinder(0.1, c.radius, c.radius, seg).translate([0, 0, -0.05]).transform(into);
      const peg = clipped.add(root);
      const hole = Manifold.cylinder(c.depth + clr + 0.05, c.radius + clr, c.radius + clr, seg).translate([0, 0, -0.05]).transform(into);
      bodies[ia] = A.add(peg);
      bodies[ib] = B.subtract(hole);
      shaft.delete(); clipped.delete(); root.delete(); peg.delete(); hole.delete();
    } else if (c.type === 'dowel') {
      const along = frame(u, v, n, c.at);
      const hole = Manifold.cylinder(2 * (c.depth + clr), c.radius + clr, c.radius + clr, seg, true).transform(along);
      bodies[ia] = A.subtract(hole);
      bodies[ib] = B.subtract(hole);
      hole.delete();
      pins.push(Manifold.cylinder(2 * c.depth - 0.6, c.radius, c.radius, seg, true).transform(along));
    } else {
      // trapezoid in (across, depth) space, extruded along the slide direction
      const across = norm(cross(c.slide, n)); // in-plane, perpendicular to slide
      const w = c.radius, d = c.depth, f = d * DOVETAIL_FLARE;
      const tri = CrossSection.ofPolygons([[[-w, -0.05], [w, -0.05], [w + f, d], [-w - f, d]]]);
      const slotCs = tri.offset(clr, 'Miter');
      const place = frame(across, mul(n, -1), c.slide, c.at); // y goes into B, z along the slide
      // a connector switched to dovetail by hand has no length yet: run it across the face (clipped to B below)
      const len = c.length > 0 ? c.length : 2000;
      const tenonRaw = Manifold.extrude(tri, len, 0, 0, [1, 1], true).transform(place);
      const tenon = tenonRaw.intersect(B); // only where B has material
      const slot = Manifold.extrude(slotCs, len + 40, 0, 0, [1, 1], true).transform(place);
      bodies[ia] = A.add(tenon);
      bodies[ib] = B.subtract(slot);
      tri.delete(); slotCs.delete(); tenonRaw.delete(); tenon.delete(); slot.delete();
    }
    A.delete(); B.delete();
    used.add(c.id);
  }
  return { bodies, pins, used };
}

// ---------- clearance test coupon ----------
export const COUPON_CLEARANCES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * One strip with a hole/slot per clearance (notches on the front edge count
 * 1..N), plus the matching key: a peg tab, a pin, or a dovetail tab.
 */
export function makeCoupon(wasm: ManifoldToplevel, type: ConnectorType, radius = 4, depth = 8): { name: string; solid: Manifold }[] {
  const { Manifold, CrossSection } = wasm;
  const seg = 48;
  const n = COUPON_CLEARANCES.length;
  const pitch = type === 'dovetail' ? radius * 2 + depth * DOVETAIL_FLARE * 2 + 8 : radius * 2 + 7;
  const width = type === 'dovetail' ? 20 : radius * 2 + 8;
  const height = depth + 3;
  let strip = Manifold.cube([pitch * n + 4, width, height]);
  COUPON_CLEARANCES.forEach((clr, i) => {
    const cx = 2 + pitch * (i + 0.5);
    if (type === 'dovetail') {
      // slot opens on the top face and runs through the strip along Y
      const w = radius, d = depth, f = d * DOVETAIL_FLARE;
      const cs = CrossSection.ofPolygons([[[-w, -0.05], [w, -0.05], [w + f, d], [-w - f, d]]]).offset(clr, 'Miter');
      const slot = Manifold.extrude(cs, width + 2).transform(frame([1, 0, 0], [0, 0, -1], [0, 1, 0], [cx, -1, height]));
      strip = strip.subtract(slot);
    } else {
      const hole = Manifold.cylinder(depth + 1, radius + clr, radius + clr, seg).translate([cx, width / 2, height - depth]);
      strip = strip.subtract(hole);
    }
    for (let m = 0; m <= i; m++) { // notch count = index + 1
      const notch = Manifold.cube([0.8, 1.2, 1.2]).translate([cx - (i * 1.6) / 2 + m * 1.6 - 0.4, -0.01, height - 1.2]);
      strip = strip.subtract(notch);
    }
  });
  const parts = [{ name: `coupon_${type}_strip`, solid: strip }];
  if (type === 'peg') {
    const base = Manifold.cube([radius * 2 + 8, radius * 2 + 8, 3]);
    parts.push({ name: 'coupon_peg_key', solid: base.add(Manifold.cylinder(depth, radius, radius, seg).translate([radius + 4, radius + 4, 3])) });
  } else if (type === 'dowel') {
    // pin printed lying flat would need supports; standing it up is fine at this size
    parts.push({ name: 'coupon_dowel_pin', solid: Manifold.cylinder(depth * 2 - 0.6, radius, radius, seg) });
  } else {
    const w = radius, d = depth, f = d * DOVETAIL_FLARE;
    const cs = CrossSection.ofPolygons([[[-w, 0], [w, 0], [w + f, d], [-w - f, d]]]);
    const tab = Manifold.extrude(cs, 20).transform(frame([1, 0, 0], [0, 0, 1], [0, -1, 0], [w + f + 4, 20, 3]));
    parts.push({ name: 'coupon_dovetail_key', solid: Manifold.cube([2 * (w + f) + 8, 20, 3]).add(tab) });
  }
  return parts;
}
