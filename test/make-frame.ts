import Module from 'manifold-3d';
import { writeFileSync } from 'fs';
import { writeSTL } from '../src/core/stl';
import { fromManifold } from '../src/core/ops';
const w = await Module(); w.setup();
// 650 x 955 x 20 mm picture frame with 20 mm bars, exported in 1/100 mm
const frame = w.Manifold.cube([650, 955, 20]).subtract(w.Manifold.cube([610, 915, 40]).translate([20, 20, -10]));
writeFileSync(process.argv[2], new Uint8Array(writeSTL(fromManifold(frame.scale(100)))));
