import Module from 'manifold-3d';
import { autoSplit } from '../src/core/autosplit';
import { cutByPlanes, planeFrom } from '../src/core/ops';
import { sizeOf } from '../src/core/mesh';
import { fitOf } from '../src/core/layout';

const w = await Module(); w.setup();
const { Manifold } = w;
const bed: [number, number, number] = [256, 256, 256];

function run(name: string, solid: any) {
  const t0 = Date.now();
  const r = autoSplit(solid, { bed, margin: 2, minPart: 20 });
  const planes = r.cuts.map((c) => { const pt: [number, number, number] = [0, 0, 0]; pt[c.axis] = c.pos; return planeFrom(c.axis, 0, 0, pt); });
  const parts = cutByPlanes(solid, planes);
  const sizes = parts.map((p) => sizeOf(p.bbox));
  const bad = sizes.filter((s) => fitOf(s, bed) === 'too-big');
  const smallest = Math.min(...sizes.map((s) => Math.max(...s)));
  console.log(`${name}: cuts ${r.cuts.map((c) => 'XYZ'[c.axis] + c.pos.toFixed(0)).join(' ')} -> ${parts.length} parts, too-big ${bad.length}, smallest part longest side ${smallest.toFixed(0)}mm, ${Date.now() - t0}ms`);
}

// 650 x 955 x 20 frame, 20 mm bars (like the user's model)
const frame = Manifold.cube([650, 955, 20]).subtract(Manifold.cube([610, 915, 40]).translate([20, 20, -10]));
run('frame', frame);
// arch 400 x 60 x 180
run('arch', Manifold.cube([400, 60, 180]).subtract(Manifold.cylinder(60, 120, 120, 64).rotate([90, 0, 0]).translate([200, 60, 0])));
// solid block 600 x 300 x 100 -> pure grid
run('block', Manifold.cube([600, 300, 100]));
// tall vase-ish: 200 dia, 500 tall
run('tower', Manifold.cylinder(500, 100, 60, 64).subtract(Manifold.cylinder(500, 95, 55, 64).translate([0, 0, 3])));
