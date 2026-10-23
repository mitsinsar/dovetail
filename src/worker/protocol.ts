import type { BBox, IndexedMesh } from '../core/mesh';
import type { Part, Plane, Vec3 } from '../core/ops';
import type { AutoSplitResult } from '../core/autosplit';
import type { Connector, ConnectorSettings, ConnectorType } from '../core/connectors';
import type { PackResult } from '../core/pack';

export type Request =
  | { type: 'load'; file?: ArrayBuffer; scale?: number } // no file = rescale the cached one; no scale = auto-detect
  | { type: 'cut'; planes: Plane[]; connectors: Connector[] | null; settings: ConnectorSettings } // null = auto-place
  | { type: 'coupon'; connector: ConnectorType; radius: number; depth: number }
  | { type: 'pack'; meshes: IndexedMesh[]; bed: Vec3; gap: number; margin: number }
  | { type: 'autosplit'; bed: Vec3; margin: number; minPart: number; reserve: number };

export type Response =
  | { type: 'loaded'; mesh: IndexedMesh; bbox: BBox; volume: number; triangles: number; scale: number; rawMax: number }
  | { type: 'cut'; parts: Part[]; pins: Part[]; connectors: Connector[]; applied: string[]; skipped: number; ms: number }
  | { type: 'coupon'; parts: { name: string; mesh: IndexedMesh }[] }
  | { type: 'pack'; result: PackResult; ms: number }
  | { type: 'autosplit'; result: AutoSplitResult; ms: number }
  | { type: 'error'; message: string };
