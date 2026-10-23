# SplitSTL

Free STL splitter for 3D printing: cuts large models to fit your printer, adds pegs, dowels or dovetails, and lays the parts out on plates for Bambu Studio, OrcaSlicer and PrusaSlicer.

Browser-based tool that splits large STLs into printable parts with connectors. Everything runs client-side; geometry is done by [manifold-3d](https://github.com/elalish/manifold) (WASM) in a Web Worker.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # headless geometry test (Node)
npm run build      # static site in dist/
```

## Deploy (home server)

```bash
docker build -t splitstl .
docker run -d --name splitstl -p 8090:80 --restart unless-stopped splitstl
```

## Layout

| Path | What |
|---|---|
| `src/core/mesh.ts` | Indexed mesh type, bbox, vertex welding (STL soup → indexed) |
| `src/core/stl.ts` | STL read (binary + ASCII) and binary write |
| `src/core/ops.ts` | Manifold conversion, multi-plane cut + split into bodies, plane math |
| `src/core/layout.ts` | Bed-fit check, simple plate layout |
| `src/core/threemf.ts` | 3MF writer |
| `src/core/autosplit.ts` | Bed-fit grid + cut placement from cross-section profiles |
| `src/core/orient.ts` | Print orientation candidates |
| `src/core/pack.ts` | Multi-plate footprint packing |
| `src/core/printers.ts` | Printer presets and slicer list |
| `src/core/slicers.ts` | Slicer-native multi-plate 3MF (plate grids from Orca `PartPlate.cpp` / Prusa `MultipleBeds.cpp`) |
| `src/core/connectors.ts` | Connector placement, peg/dowel/dovetail booleans, test coupon |
| `src/worker/` | Geometry worker + promise RPC client |
| `src/Viewer.tsx` | r3f scene: model, cut plane preview, exploded parts, bed |
| `src/App.tsx` | Side panel and state |

## Status

- [x] v0.1 — load STL, one cut plane (axis + 2 tilts), split into bodies, explode view, bed-fit badges, export 3MF / STL zip
- [x] v0.2 — Auto-split: grid sized to bed (minus margin), cuts slide to small cross-sections away from feature edges (DP over a sampled profile)
- [x] Multiple planes, editable list (axis, position, tilt) — viewport dragging still to do
- [x] v0.3 — Connectors: pegs, dowels (+ loose pins), dovetails; auto placement per cut face; per-connector type/size/depth/clearance edit
- [x] Clearance: per-type defaults, per-connector override, test-coupon export
- [x] v0.4 — Orientation: best flat face down (contact vs overhang vs height), stable alternates; packing on real footprints (2 mm raster, nesting, 4 rotations, several orders), export one 3MF per plate
- [x] v0.5 — Printer presets (bed size + default slicer, remembered per browser); native multi-plate project export for Bambu Studio, OrcaSlicer and PrusaSlicer 2.9+, per-plate zip for Cura/others
- [ ] Drag cut planes in the viewport
