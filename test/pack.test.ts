import Module from 'manifold-3d';
import { autoSplit } from '../src/core/autosplit';
import { cutBodies, planeFrom, toParts, toManifold } from '../src/core/ops';
import { protrusionReserve, placeConnectors, applyConnectors, DEFAULT_CLEARANCE, type ConnectorType } from '../src/core/connectors';
import { packPlates } from '../src/core/pack';
import { bboxOf, sizeOf } from '../src/core/mesh';

const w = await Module(); w.setup();
const { Manifold } = w;
const bed: [number, number, number] = [256, 256, 256];

function run(name: string, solid: any, type: ConnectorType) {
  const r = autoSplit(solid, { bed, margin: 2, minPart: 20, reserve: protrusionReserve(type, 20) });
  const planes = r.cuts.map((c) => { const pt: [number, number, number] = [0, 0, 0]; pt[c.axis] = c.pos; return planeFrom(c.axis, 0, 0, pt); });
  const { connectors } = placeConnectors(solid, planes, { type, clearance: DEFAULT_CLEARANCE, maxPerFace: 4, minPart: 20 });
  const { bodies, pins } = applyConnectors(w, cutBodies(solid, planes), planes, connectors, DEFAULT_CLEARANCE);
  const meshes = [...toParts(bodies), ...toParts(pins, 'pin')].map((p) => p.mesh);
  const t0 = Date.now();
  const res = packPlates(meshes, bed, 4, 2);
  const nested = res.placed.length;
  // checks: inside plate, on bed, footprints don't overlap within a plate
  let outside = 0, overlaps = 0, notOnBed = 0;
  const boxes = res.placed.map((p) => ({ plate: p.plate, b: bboxOf(p.mesh.positions) }));
  for (const { b } of boxes) {
    if (b.min[0] < -1e-3 || b.min[1] < -1e-3 || b.max[0] > bed[0] + 1e-3 || b.max[1] > bed[1] + 1e-3) outside++;
    if (Math.abs(b.min[2]) > 1e-3) notOnBed++;
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j];
    if (a.plate !== c.plate) continue;
    if (!(a.b.min[0] < c.b.max[0] && c.b.min[0] < a.b.max[0] && a.b.min[1] < c.b.max[1] && c.b.min[1] < a.b.max[1])) continue;
    // bboxes may overlap when parts nest; check real geometry (footprints grown by 1.5 mm)
    const A = toManifold(w, res.placed[i].mesh), C = toManifold(w, res.placed[j].mesh);
    const grownA = A.add(A.translate([1.5, 0, 0])).add(A.translate([-1.5, 0, 0])).add(A.translate([0, 1.5, 0])).add(A.translate([0, -1.5, 0]));
    const hit = grownA.intersect(C); if (hit.volume() > 1e-6) overlaps++;
    [A, C, grownA, hit].forEach((m) => m.delete());
  }
  const heights = res.placed.map((p) => sizeOf(bboxOf(p.mesh.positions))[2].toFixed(0));
  console.log(`${name}/${type}: ${meshes.length} objects -> ${res.plates} plates, outside ${outside}, overlaps ${overlaps}, notOnBed ${notOnBed}, heights [${[...new Set(heights)].join(',')}], ${Date.now() - t0}ms`);
}
const frame = Manifold.cube([650, 955, 20]).subtract(Manifold.cube([610, 915, 40]).translate([20, 20, -10]));
run('frame', frame, 'peg'); run('frame', frame, 'dowel'); run('frame', frame, 'dovetail');
run('block', Manifold.cube([600, 300, 100]), 'peg');
run('arch', Manifold.cube([400, 60, 180]).subtract(Manifold.cylinder(60, 120, 120, 64).rotate([90, 0, 0]).translate([200, 60, 0])), 'dowel');
run('tower', Manifold.cylinder(500, 100, 60, 64).subtract(Manifold.cylinder(500, 95, 55, 64).translate([0, 0, 3])), 'peg');
