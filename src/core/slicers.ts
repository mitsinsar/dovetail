// Slicer-native multi-plate project export.
//
// Each slicer decides which plate an object belongs to from where it sits in a
// shared world space, so every part is placed at (plate origin + its spot on
// that plate). Layouts follow the slicers' own source:
//  - Bambu Studio / OrcaSlicer (PartPlate.cpp): ⌈√n⌉ columns, pitch = bed × 1.2,
//    rows go toward -Y; plates are declared in Metadata/model_settings.config.
//  - PrusaSlicer 2.9+ (MultipleBeds.cpp): spiral grid, gap = min(100, 0.3 × bed diagonal).
import { zipSync, strToU8 } from 'fflate';
import { bboxOf, type IndexedMesh } from './mesh';
import type { Vec3 } from './ops';
import type { SlicerId } from './printers';
import { write3MF, type ProjectObject } from './threemf';

export interface PlateObject { name: string; mesh: IndexedMesh; plate: number } // mesh in plate coords (0..bed)

/** Orca/Bambu: compute_colum_count(). */
export function bambuColumns(count: number) {
  const v = Math.sqrt(count), r = Math.round(v);
  return v > r ? r + 1 : r;
}

export function bambuPlateOrigin(i: number, count: number, bed: Vec3): [number, number] {
  const cols = bambuColumns(count);
  return [(i % cols) * bed[0] * 1.2, -Math.floor(i / cols) * bed[1] * 1.2];
}

/** PrusaSlicer BedsGrid::index2grid_coords (first quadrant). */
export function prusaGridCoords(index: number): [number, number] {
  if (index === 0) return [0, 0];
  let id = index + 1, a = 1;
  while ((a + 1) * (a + 1) < id) a++;
  id -= a * a;
  return id <= a ? [a, id - 1] : [id - a - 1, a];
}

export function prusaPlateOrigin(i: number, bed: Vec3): [number, number] {
  const gap = Math.min(100, Math.hypot(bed[0], bed[1]) * 0.3);
  const [x, y] = prusaGridCoords(i);
  return [x * (bed[0] + gap), y * (bed[1] + gap)];
}

/** Centre each mesh on its own origin and return it with the world translation that puts it back. */
function toProjectObjects(objs: PlateObject[], origin: (plate: number) => [number, number]): ProjectObject[] {
  return objs.map((o) => {
    const b = bboxOf(o.mesh.positions);
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = b.min[2];
    const p = new Float32Array(o.mesh.positions.length);
    for (let i = 0; i < p.length; i += 3) {
      p[i] = o.mesh.positions[i] - cx; p[i + 1] = o.mesh.positions[i + 1] - cy; p[i + 2] = o.mesh.positions[i + 2] - cz;
    }
    const [ox, oy] = origin(o.plate);
    return { name: o.name, mesh: { positions: p, indices: o.mesh.indices }, translate: [ox + cx, oy + cy, cz] };
  });
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bambuModelSettings(objs: ProjectObject[], plateOf: number[], plates: number): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  objs.forEach((o, i) => {
    lines.push(`  <object id="${i + 1}">`, `    <metadata key="name" value="${esc(o.name)}"/>`, `    <metadata key="extruder" value="1"/>`, '  </object>');
  });
  for (let p = 0; p < plates; p++) {
    lines.push('  <plate>', `    <metadata key="plater_id" value="${p + 1}"/>`, `    <metadata key="plater_name" value="Plate ${p + 1}"/>`, '    <metadata key="locked" value="false"/>');
    plateOf.forEach((pl, i) => {
      if (pl !== p) return;
      lines.push('    <model_instance>', `      <metadata key="object_id" value="${i + 1}"/>`, '      <metadata key="instance_id" value="0"/>', `      <metadata key="identify_id" value="${i + 1}"/>`, '    </model_instance>');
    });
    lines.push('  </plate>');
  }
  lines.push('</config>');
  return lines.join('\n');
}

export interface ExportResult { filename: string; data: Uint8Array; kind: 'project' | 'zip' }

/**
 * Build the download for a slicer: a single multi-plate project where the
 * slicer supports it, otherwise a zip with one 3MF per plate.
 */
export function exportForSlicer(slicer: SlicerId, objs: PlateObject[], plates: number, bed: Vec3, base: string, maxPlates: number): ExportResult {
  if (slicer === 'generic' || plates > maxPlates) {
    const files: Record<string, Uint8Array> = {};
    for (let p = 0; p < plates; p++) {
      const onPlate = objs.filter((o) => o.plate === p);
      if (onPlate.length) files[`${base}_plate${p + 1}.3mf`] = write3MF(onPlate.map((o) => ({ name: o.name, mesh: o.mesh })));
    }
    return { filename: `${base}_plates.zip`, data: zipSync(files), kind: 'zip' };
  }

  if (slicer === 'prusa') {
    const project = toProjectObjects(objs, (p) => prusaPlateOrigin(p, bed));
    return { filename: `${base}_prusaslicer.3mf`, data: write3MF(project), kind: 'project' };
  }

  // Bambu Studio / OrcaSlicer
  const project = toProjectObjects(objs, (p) => bambuPlateOrigin(p, plates, bed));
  const app = slicer === 'bambu' ? 'BambuStudio-02.02.00.00' : 'OrcaSlicer-2.3.0';
  return {
    filename: `${base}_${slicer === 'bambu' ? 'bambustudio' : 'orcaslicer'}.3mf`,
    data: write3MF(project, {
      metadata: { Application: app, 'BambuStudio:3mfVersion': '1' },
      extraFiles: { 'Metadata/model_settings.config': strToU8(bambuModelSettings(project, objs.map((o) => o.plate), plates)) },
    }),
    kind: 'project',
  };
}
