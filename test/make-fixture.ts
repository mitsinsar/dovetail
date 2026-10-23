import Module from 'manifold-3d';
import { writeFileSync } from 'fs';
import { writeSTL } from '../src/core/stl';
import { fromManifold } from '../src/core/ops';
const w = await Module(); w.setup();
const { Manifold } = w;
// 400mm long arch: too big for a 256 bed, hollow so cuts make multiple bodies
const arch = Manifold.cube([400, 60, 180]).subtract(Manifold.cylinder(60, 120, 120, 64).rotate([90, 0, 0]).translate([200, 60, 0]));
writeFileSync(process.argv[2], new Uint8Array(writeSTL(fromManifold(arch))));
