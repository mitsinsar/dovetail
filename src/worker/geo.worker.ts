/// <reference lib="webworker" />
import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { weld, bboxOf } from '../core/mesh';
import { parseSTL } from '../core/stl';
import { toManifold, fromManifold, cutBodies, toParts, type Plane } from '../core/ops';
import { placeConnectors, applyConnectors, makeCoupon } from '../core/connectors';
import { autoSplit } from '../core/autosplit';
import { packPlates } from '../core/pack';
import type { Request, Response } from './protocol';

let wasmP: Promise<ManifoldToplevel> | null = null;
function getWasm() {
  wasmP ??= Module({ locateFile: () => wasmUrl }).then((w) => { w.setup(); return w; });
  return wasmP;
}

let model: Manifold | null = null;
let soup: Float32Array | null = null; // last parsed file, unscaled

/** STL has no units. A part over 3 m is almost certainly in micrometers (Shapr3D, some CAD). */
function autoScale(maxDim: number) {
  return maxDim > 3000 ? 0.001 : 1;
}

async function handle(req: Request): Promise<Response> {
  const wasm = await getWasm();
  switch (req.type) {
    case 'load': {
      if (req.file) soup = parseSTL(req.file);
      if (!soup) return { type: 'error', message: 'No file loaded' };
      const raw = bboxOf(soup);
      const rawMax = Math.max(...raw.max.map((v, k) => v - raw.min[k]));
      const scale = req.scale ?? autoScale(rawMax);
      const scaled = scale === 1 ? soup : soup.map((v) => v * scale);
      const welded = weld(scaled);
      model?.delete();
      model = null;
      try {
        model = toManifold(wasm, welded);
      } catch (e) {
        return { type: 'error', message: `Mesh is not watertight, so it can't be cut cleanly. Repair it first (e.g. in PrusaSlicer or Meshmixer). (${String(e)})` };
      }
      // send back manifold's own mesh so the view matches what gets cut
      const mesh = fromManifold(model);
      return { type: 'loaded', mesh, bbox: bboxOf(mesh.positions), volume: model.volume(), triangles: mesh.indices.length / 3, scale, rawMax };
    }
    case 'cut': {
      if (!model) return { type: 'error', message: 'No model loaded' };
      const t0 = performance.now();
      const planes = req.planes as Plane[];
      let skipped = 0;
      let connectors = req.connectors;
      if (!connectors) ({ connectors, skipped } = placeConnectors(model, planes, req.settings));
      const bodies = cutBodies(model, planes);
      const applied = applyConnectors(wasm, bodies, planes, connectors, req.settings.clearance);
      const parts = toParts(applied.bodies);
      const pins = toParts(applied.pins, 'pin');
      return { type: 'cut', parts, pins, connectors, applied: [...applied.used], skipped, ms: performance.now() - t0 };
    }
    case 'coupon': {
      const parts = makeCoupon(wasm, req.connector, req.radius, req.depth).map(({ name, solid }) => {
        const mesh = fromManifold(solid); solid.delete(); return { name, mesh };
      });
      return { type: 'coupon', parts };
    }
    case 'pack': {
      const t0 = performance.now();
      const result = packPlates(req.meshes, req.bed, req.gap, req.margin);
      return { type: 'pack', result, ms: performance.now() - t0 };
    }
    case 'autosplit': {
      if (!model) return { type: 'error', message: 'No model loaded' };
      const t0 = performance.now();
      const result = autoSplit(model, { bed: req.bed, margin: req.margin, minPart: req.minPart, reserve: req.reserve });
      return { type: 'autosplit', result, ms: performance.now() - t0 };
    }
  }
}

self.onmessage = async (ev: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = ev.data;
  let res: Response;
  try {
    res = await handle(req);
  } catch (e) {
    res = { type: 'error', message: String(e) };
  }
  const transfer: Transferable[] = [];
  if (res.type === 'loaded') transfer.push(res.mesh.positions.buffer, res.mesh.indices.buffer);
  if (res.type === 'pack') for (const p of res.result.placed) transfer.push(p.mesh.positions.buffer);
  if (res.type === 'cut') for (const p of [...res.parts, ...res.pins]) transfer.push(p.mesh.positions.buffer, p.mesh.indices.buffer);
  (self as DedicatedWorkerGlobalScope).postMessage({ id, res }, transfer);
};
