// Builds the demo model used for the docs: a 520 mm chess rook, too tall for
// any common printer, with round cut faces that show the connectors well.
//   npx tsx scripts/make-demo.ts demo/rook.stl
import Module from 'manifold-3d';
import { writeFileSync } from 'fs';
import { writeSTL } from '../src/core/stl';
import { fromManifold } from '../src/core/ops';

const w = await Module(); w.setup();
const { Manifold, CrossSection } = w;
const seg = 160;

// lathe profile (radius, z), revolved around Z: plinth, base mouldings, tapering tower, collar, crown
const profile: [number, number][] = [
  [0, 0], [118, 0], [118, 14], [110, 20], [110, 30], [100, 36], [100, 44], [90, 52],
];
for (let i = 1; i <= 20; i++) { // concave sweep up into the tower
  const t = i / 20;
  profile.push([90 - 26 * Math.sin((t * Math.PI) / 2), 52 + 60 * t]);
}
profile.push([64, 300], [62, 380]); // gently tapering tower
profile.push([80, 392], [80, 404], [70, 410], [70, 418]); // collar
for (let i = 1; i <= 12; i++) { // flare out to the crown
  const t = i / 12;
  profile.push([70 + 26 * (1 - Math.cos((t * Math.PI) / 2)), 418 + 40 * t]);
}
profile.push([96, 520], [0, 520]);
let rook = Manifold.revolve(new CrossSection([profile]), seg);

// crown: a shallow well and six battlements
rook = rook.subtract(Manifold.cylinder(30, 72, 72, seg).translate([0, 0, 496]));
for (let k = 0; k < 6; k++) {
  const notch = Manifold.cube([220, 22, 34], true).translate([0, 0, 520]).rotate([0, 0, k * 30]);
  rook = rook.subtract(notch);
}
// two bands around the tower
for (const z of [190, 290]) rook = rook.add(Manifold.cylinder(6, 68 - (z - 112) * 0.01, 68 - (z - 112) * 0.01, seg).translate([0, 0, z]));

const model = rook.translate([150, 150, 0]);
writeFileSync(process.argv[2] ?? 'demo/rook.stl', new Uint8Array(writeSTL(fromManifold(model))));
console.log('genus', model.genus(), 'volume', (model.volume() / 1000).toFixed(0), 'cm³', 'bbox', JSON.stringify(model.boundingBox()));
