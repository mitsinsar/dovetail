// Geometry operations on top of manifold-3d. Pure functions over the wasm
// module so they run both in the Web Worker and in Node tests.
import type { ManifoldToplevel, Manifold } from 'manifold-3d';
import { bboxOf, type BBox, type IndexedMesh } from './mesh';

export type Vec3 = [number, number, number];

/** A cut plane: points p with dot(p, normal) = offset. Normal is unit length. */
export interface Plane {
  normal: Vec3;
  offset: number;
}

export interface Part {
  mesh: IndexedMesh;
  bbox: BBox;
  volume: number;
  kind: 'part' | 'pin';
}

export function toManifold(wasm: ManifoldToplevel, mesh: IndexedMesh): Manifold {
  const m = new wasm.Mesh({
    numProp: 3,
    vertProperties: mesh.positions,
    triVerts: mesh.indices,
  });
  m.merge(); // stitch any remaining open edges that share positions
  const solid = wasm.Manifold.ofMesh(m); // throws if the mesh is not manifold
  return solid;
}

export function fromManifold(solid: Manifold): IndexedMesh {
  const m = solid.getMesh();
  const np = m.numProp;
  const nv = m.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = m.vertProperties[i * np];
    positions[i * 3 + 1] = m.vertProperties[i * np + 1];
    positions[i * 3 + 2] = m.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(m.triVerts) };
}

/**
 * Split a solid by every plane in turn, then break each piece into its
 * disconnected bodies (a plane through a U shape yields 3 parts, not 2).
 * Returns live Manifolds; the caller owns and must delete them.
 */
export function cutBodies(solid: Manifold, planes: Plane[]): Manifold[] {
  let pieces: Manifold[] = [solid];
  for (const pl of planes) {
    const next: Manifold[] = [];
    for (const p of pieces) {
      const [a, b] = p.splitByPlane(pl.normal, pl.offset);
      if (!a.isEmpty()) next.push(a); else a.delete();
      if (!b.isEmpty()) next.push(b); else b.delete();
      if (p !== solid) p.delete();
    }
    pieces = next;
  }
  const bodies: Manifold[] = [];
  for (const p of pieces) {
    for (const body of p.decompose()) {
      if (body.volume() > 1e-3) bodies.push(body); else body.delete();
    }
    if (p !== solid) p.delete();
  }
  return bodies;
}

/** Convert bodies to transferable parts (deletes the bodies). Sorted by position. */
export function toParts(bodies: Manifold[], kind: Part['kind'] = 'part'): Part[] {
  const parts = bodies.map((b) => {
    const mesh = fromManifold(b);
    const part: Part = { mesh, bbox: bboxOf(mesh.positions), volume: b.volume(), kind };
    b.delete();
    return part;
  });
  parts.sort((a, b) =>
    a.bbox.min[0] - b.bbox.min[0] || a.bbox.min[1] - b.bbox.min[1] || a.bbox.min[2] - b.bbox.min[2]);
  return parts;
}

export function cutByPlanes(solid: Manifold, planes: Plane[]): Part[] {
  return toParts(cutBodies(solid, planes));
}

/** Translate a mesh so it rests on z = 0, centered at (cx, cy). */
export function placeOnBed(mesh: IndexedMesh, cx = 0, cy = 0): IndexedMesh {
  const b = bboxOf(mesh.positions);
  const dx = cx - (b.min[0] + b.max[0]) / 2;
  const dy = cy - (b.min[1] + b.max[1]) / 2;
  const dz = -b.min[2];
  const out = new Float32Array(mesh.positions.length);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = mesh.positions[i] + dx;
    out[i + 1] = mesh.positions[i + 1] + dy;
    out[i + 2] = mesh.positions[i + 2] + dz;
  }
  return { positions: out, indices: mesh.indices };
}

/** Plane from a principal axis plus two tilt angles (degrees) around the other axes. */
export function planeFrom(axis: 0 | 1 | 2, tiltA: number, tiltB: number, point: Vec3): Plane {
  const n: Vec3 = [0, 0, 0];
  n[axis] = 1;
  const others = [0, 1, 2].filter((k) => k !== axis) as [number, number];
  // rotate the normal: tiltA around others[0], tiltB around others[1]
  const rot = (v: Vec3, around: number, deg: number): Vec3 => {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const [i, j] = [0, 1, 2].filter((k) => k !== around);
    const out: Vec3 = [...v];
    out[i] = v[i] * c - v[j] * s;
    out[j] = v[i] * s + v[j] * c;
    return out;
  };
  let v = rot(n, others[0], tiltA);
  v = rot(v, others[1], tiltB);
  const len = Math.hypot(...v);
  v = [v[0] / len, v[1] / len, v[2] / len];
  return { normal: v, offset: v[0] * point[0] + v[1] * point[1] + v[2] * point[2] };
}
