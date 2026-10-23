// Printer presets and the slicer each one usually pairs with.
import type { Vec3 } from './ops';

export type SlicerId = 'bambu' | 'orca' | 'prusa' | 'generic';

export interface SlicerInfo {
  id: SlicerId;
  label: string;
  maxPlates: number; // more than this falls back to one file per plate
  note: string;
}

export const SLICERS: SlicerInfo[] = [
  { id: 'bambu', label: 'Bambu Studio', maxPlates: 36, note: 'One project file, plates set up' },
  { id: 'orca', label: 'OrcaSlicer', maxPlates: 36, note: 'One project file, plates set up (also Creality Print, Elegoo Slicer)' },
  { id: 'prusa', label: 'PrusaSlicer', maxPlates: 9, note: 'One project file, beds set up (PrusaSlicer 2.9+)' },
  { id: 'generic', label: 'Cura / other', maxPlates: Infinity, note: 'A zip with one 3MF per plate' },
];

export interface Printer {
  id: string;
  brand: string;
  model: string;
  bed: Vec3; // mm, X × Y × Z
  slicer: SlicerId;
}

// Build volumes from the manufacturers' published specs.
export const PRINTERS: Printer[] = [
  { id: 'bambu-a1mini', brand: 'Bambu Lab', model: 'A1 mini', bed: [180, 180, 180], slicer: 'bambu' },
  { id: 'bambu-a1', brand: 'Bambu Lab', model: 'A1', bed: [256, 256, 256], slicer: 'bambu' },
  { id: 'bambu-p1', brand: 'Bambu Lab', model: 'P1S / P1P', bed: [256, 256, 256], slicer: 'bambu' },
  { id: 'bambu-p2s', brand: 'Bambu Lab', model: 'P2S', bed: [256, 256, 256], slicer: 'bambu' },
  { id: 'bambu-x1', brand: 'Bambu Lab', model: 'X1 Carbon / X1E', bed: [256, 256, 256], slicer: 'bambu' },
  { id: 'bambu-h2', brand: 'Bambu Lab', model: 'H2D / H2S', bed: [325, 320, 325], slicer: 'bambu' },
  { id: 'prusa-mini', brand: 'Prusa', model: 'MINI+', bed: [180, 180, 180], slicer: 'prusa' },
  { id: 'prusa-mk3', brand: 'Prusa', model: 'MK3S+', bed: [250, 210, 210], slicer: 'prusa' },
  { id: 'prusa-mk4', brand: 'Prusa', model: 'MK4 / MK4S', bed: [250, 210, 220], slicer: 'prusa' },
  { id: 'prusa-core1', brand: 'Prusa', model: 'CORE One', bed: [250, 220, 270], slicer: 'prusa' },
  { id: 'prusa-xl', brand: 'Prusa', model: 'XL', bed: [360, 360, 360], slicer: 'prusa' },
  { id: 'creality-e3v3se', brand: 'Creality', model: 'Ender-3 V3 SE', bed: [220, 220, 250], slicer: 'orca' },
  { id: 'creality-k1', brand: 'Creality', model: 'K1 / K1C', bed: [220, 220, 250], slicer: 'orca' },
  { id: 'creality-k1max', brand: 'Creality', model: 'K1 Max', bed: [300, 300, 300], slicer: 'orca' },
  { id: 'creality-k2plus', brand: 'Creality', model: 'K2 Plus', bed: [350, 350, 350], slicer: 'orca' },
  { id: 'elegoo-cc', brand: 'Elegoo', model: 'Centauri Carbon', bed: [256, 256, 256], slicer: 'orca' },
  { id: 'elegoo-n4pro', brand: 'Elegoo', model: 'Neptune 4 Pro', bed: [225, 225, 265], slicer: 'orca' },
  { id: 'qidi-q1pro', brand: 'QIDI', model: 'Q1 Pro', bed: [245, 245, 240], slicer: 'orca' },
  { id: 'voron-24-350', brand: 'Voron', model: '2.4 (350)', bed: [350, 350, 340], slicer: 'orca' },
];

export const CUSTOM_PRINTER = 'custom';
