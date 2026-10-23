// Plain indexed mesh passed between UI and worker (transferable buffers).
export interface IndexedMesh {
  positions: Float32Array; // xyz per vertex
  indices: Uint32Array; // 3 per triangle
}

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function bboxOf(positions: Float32Array): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function sizeOf(b: BBox): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

/**
 * Weld a triangle soup (as found in STL) into an indexed mesh by merging
 * vertices that coincide within `tol` mm. Manifold needs shared vertices.
 */
export function weld(soup: Float32Array, tol = 1e-4): IndexedMesh {
  const inv = 1 / tol;
  const map = new Map<string, number>();
  const pos: number[] = [];
  const triCount = soup.length / 9;
  const idx = new Uint32Array(triCount * 3);
  let out = 0;
  for (let t = 0; t < triCount; t++) {
    const tri: number[] = [];
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const x = soup[o], y = soup[o + 1], z = soup[o + 2];
      const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        map.set(key, id);
        pos.push(x, y, z);
      }
      tri.push(id);
    }
    // drop degenerate triangles produced by welding
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    idx[out++] = tri[0];
    idx[out++] = tri[1];
    idx[out++] = tri[2];
  }
  return { positions: new Float32Array(pos), indices: idx.slice(0, out) };
}
