import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { autoSplit } from '../src/core/autosplit';
import { cutBodies, planeFrom, toParts } from '../src/core/ops';
import { protrusionReserve, placeConnectors, applyConnectors, DEFAULT_CLEARANCE } from '../src/core/connectors';
import { packPlates } from '../src/core/pack';
import { exportForSlicer, bambuPlateOrigin, prusaPlateOrigin, prusaGridCoords } from '../src/core/slicers';
import { SLICERS } from '../src/core/printers';

const w = await Module(); w.setup();
// Prusa spiral matches the C++ for the first beds
console.log('prusa grid', [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => prusaGridCoords(i).join(',')).join(' '));

function check(name: string, solid: any, bed: [number, number, number]) {
  const r = autoSplit(solid, { bed, margin: 2, minPart: 20, reserve: protrusionReserve('peg', 20) });
  const planes = r.cuts.map((c) => { const pt: [number, number, number] = [0, 0, 0]; pt[c.axis] = c.pos; return planeFrom(c.axis, 0, 0, pt); });
  const { connectors } = placeConnectors(solid, planes, { type: 'peg', clearance: DEFAULT_CLEARANCE, maxPerFace: 4, minPart: 20 });
  const { bodies } = applyConnectors(w, cutBodies(solid, planes), planes, connectors, DEFAULT_CLEARANCE);
  const parts = toParts(bodies);
  const pack = packPlates(parts.map((p) => p.mesh), bed, 4, 2);
  const objs = pack.placed.map((p) => ({ name: `p${p.index}`, mesh: p.mesh, plate: p.plate }));
  for (const s of SLICERS) {
    const out = exportForSlicer(s.id, objs, pack.plates, bed, name, s.maxPlates);
    const zip = unzipSync(out.data);
    if (out.kind === 'zip') { console.log(`${name} ${s.id}: zip of ${Object.keys(zip).length} plate files`); continue; }
    const model = strFromU8(zip['3D/3dmodel.model']);
    // world bbox of each object = local bbox + item translation
    const objBoxes = new Map<string, number[]>();
    for (const m of model.matchAll(/<object id="(\d+)"[^>]*>(.*?)<\/object>/gs)) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, minz = Infinity;
      for (const v of m[2].matchAll(/x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)) {
        minx = Math.min(minx, +v[1]); maxx = Math.max(maxx, +v[1]); miny = Math.min(miny, +v[2]); maxy = Math.max(maxy, +v[2]); minz = Math.min(minz, +v[3]);
      }
      objBoxes.set(m[1], [minx, miny, maxx, maxy, minz]);
    }
    let wrong = 0, outside = 0;
    for (const it of model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)) {
      const t = it[2].split(' ').map(Number); const [tx, ty, tz] = [t[9], t[10], t[11]];
      const b = objBoxes.get(it[1])!;
      const wb = [b[0] + tx, b[1] + ty, b[2] + tx, b[3] + ty];
      const want = objs[+it[1] - 1].plate;
      // which plate region contains it (the slicer's rule)
      let found = -1;
      for (let p = 0; p < 36; p++) {
        const [ox, oy] = s.id === 'prusa' ? prusaPlateOrigin(p, bed) : bambuPlateOrigin(p, pack.plates, bed);
        if (wb[0] >= ox - 1e-3 && wb[2] <= ox + bed[0] + 1e-3 && wb[1] >= oy - 1e-3 && wb[3] <= oy + bed[1] + 1e-3) { found = p; break; }
      }
      if (found < 0) outside++; else if (found !== want) wrong++;
      if (Math.abs(b[4] + tz) > 1e-3) outside++;
    }
    let plateInfo = '';
    if (zip['Metadata/model_settings.config']) {
      const cfg = strFromU8(zip['Metadata/model_settings.config']);
      plateInfo = `, config plates ${(cfg.match(/<plate>/g) ?? []).length}, instances ${(cfg.match(/<model_instance>/g) ?? []).length}`;
    }
    console.log(`${name} ${s.id}: ${objs.length} objects on ${pack.plates} plates -> wrong plate ${wrong}, off-plate ${outside}${plateInfo}`);
  }
}
const frame = w.Manifold.cube([650, 955, 20]).subtract(w.Manifold.cube([610, 915, 40]).translate([20, 20, -10]));
check('frame256', frame, [256, 256, 256]);
check('frameMK4', frame, [250, 210, 220]);
check('frameMini', frame, [180, 180, 180]);
