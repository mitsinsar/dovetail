import Module from 'manifold-3d';
import { writeFileSync } from 'fs';
import { writeSTL } from '../src/core/stl';
import { fromManifold } from '../src/core/ops';
const w = await Module(); w.setup();
// 65 x 95.5 x 2 mm plate with a hole, exported in micrometers (like Shapr3D)
const plate = w.Manifold.cube([65, 95.5, 1.974]).subtract(w.Manifold.cylinder(5, 10, 10, 48).translate([32.5, 47.75, -1]));
writeFileSync(process.argv[2], new Uint8Array(writeSTL(fromManifold(plate.scale(1000)))));
