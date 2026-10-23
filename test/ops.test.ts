import Module from 'manifold-3d';
import { weld, bboxOf } from '../src/core/mesh';
import { parseSTL, writeSTL } from '../src/core/stl';
import { toManifold, cutByPlanes, planeFrom, placeOnBed, fromManifold } from '../src/core/ops';
import { write3MF } from '../src/core/threemf';

const wasm = await Module(); wasm.setup();
// Build a U shape via manifold, export as STL soup, re-import (simulates user file)
const { Manifold } = wasm;
const u = Manifold.cube([100, 20, 60]).subtract(Manifold.cube([60, 20, 40]).translate([20, 0, 20]));
const stl = writeSTL(fromManifold(u));
const soup = parseSTL(stl);
const mesh = weld(soup);
console.log('tris', soup.length / 9, 'welded verts', mesh.positions.length / 3);
const solid = toManifold(wasm, mesh);
console.log('volume', solid.volume());
// horizontal cut at z=30 through both arms -> 3 parts
let parts = cutByPlanes(solid, [planeFrom(2, 0, 0, [0, 0, 30])]);
console.log('z=30 cut parts', parts.length, parts.map(p => p.volume.toFixed(0)));
// tilted cut
parts = cutByPlanes(solid, [planeFrom(0, 20, 0, [50, 0, 0])]);
console.log('tilted x cut parts', parts.length, parts.map(p => p.volume.toFixed(0)));
const placed = parts.map((p, i) => ({ name: `A${i + 1}`, mesh: placeOnBed(p.mesh) }));
console.log('placed minZ', placed.map(p => bboxOf(p.mesh.positions).min[2]));
console.log('3mf bytes', write3MF(placed).length);
