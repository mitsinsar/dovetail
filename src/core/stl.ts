import type { IndexedMesh } from './mesh';

/** Parse binary or ASCII STL into a triangle soup (9 floats per triangle). */
export function parseSTL(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) return parseBinary(dv, n);
  }
  return parseAscii(new TextDecoder().decode(buf));
}

function parseBinary(dv: DataView, n: number): Float32Array {
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12; // skip normal
    for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(base + k * 4, true);
  }
  return out;
}

function parseAscii(text: string): Float32Array {
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length === 0 || vals.length % 9 !== 0) throw new Error('Not a valid STL file');
  return new Float32Array(vals);
}

/** Write an indexed mesh as binary STL. */
export function writeSTL(mesh: IndexedMesh, name = 'part'): ArrayBuffer {
  const { positions: p, indices: ix } = mesh;
  const n = ix.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = new TextEncoder().encode(`SplitSTL ${name}`.slice(0, 80));
  new Uint8Array(buf, 0, header.length).set(header);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const i of [a, b, c]) {
      dv.setFloat32(o, p[i], true);
      dv.setFloat32(o + 4, p[i + 1], true);
      dv.setFloat32(o + 8, p[i + 2], true);
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return buf;
}
