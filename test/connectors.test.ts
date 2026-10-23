import Module from 'manifold-3d';
import { autoSplit } from '../src/core/autosplit';
import { cutBodies, planeFrom, toParts } from '../src/core/ops';
import { placeConnectors, applyConnectors, makeCoupon, DEFAULT_CLEARANCE, type ConnectorType } from '../src/core/connectors';

const w = await Module(); w.setup();
const { Manifold } = w;
const bed: [number, number, number] = [256, 256, 256];

function run(name: string, solid: any, type: ConnectorType) {
  const t0 = Date.now();
  const r = autoSplit(solid, { bed, margin: 2, minPart: 20 });
  const planes = r.cuts.map((c) => { const pt: [number, number, number] = [0, 0, 0]; pt[c.axis] = c.pos; return planeFrom(c.axis, 0, 0, pt); });
  const { connectors, skipped } = placeConnectors(solid, planes, { type, clearance: DEFAULT_CLEARANCE, maxPerFace: 4, minPart: 20 });
  const bodies = cutBodies(solid, planes);
  const before = bodies.reduce((s, b) => s + b.volume(), 0);
  const { bodies: out, pins, used } = applyConnectors(w, bodies, planes, connectors, DEFAULT_CLEARANCE);
  const after = out.reduce((s, b) => s + b.volume(), 0);
  let overlap = 0;
  const all = [...out, ...pins];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const x = all[i].intersect(all[j]); overlap += x.volume(); x.delete();
  }
  const bad = out.filter((b) => b.status() !== 'NoError' || b.isEmpty()).length;
  const parts = toParts(out); const pinParts = toParts(pins, 'pin');
  const desc = connectors.slice(0, 3).map((c) => `${c.type} r${c.radius} d${c.depth}`).join(', ');
  console.log(`${name}/${type}: ${planes.length} planes, ${connectors.length} connectors (${used.size} applied, ${skipped} faces skipped) [${desc}], ${parts.length} parts + ${pinParts.length} pins, vol ${before.toFixed(0)} -> ${after.toFixed(0)}, bad ${bad}, overlap ${overlap.toFixed(4)}mm3, ${Date.now() - t0}ms`);
}

const frame = Manifold.cube([650, 955, 20]).subtract(Manifold.cube([610, 915, 40]).translate([20, 20, -10]));
const block = Manifold.cube([600, 300, 100]);
const arch = Manifold.cube([400, 60, 180]).subtract(Manifold.cylinder(60, 120, 120, 64).rotate([90, 0, 0]).translate([200, 60, 0]));
for (const t of ['peg', 'dowel', 'dovetail'] as ConnectorType[]) { run('frame', frame, t); run('block', block, t); run('arch', arch, t); }
for (const t of ['peg', 'dowel', 'dovetail'] as ConnectorType[]) {
  const c = makeCoupon(w, t);
  console.log(`coupon ${t}:`, c.map((p) => `${p.name} ${p.solid.volume().toFixed(0)}mm3 status=${p.solid.status()}`).join(' | '));
}
