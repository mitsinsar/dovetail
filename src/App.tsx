import { useCallback, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { Viewer, PlatesView, PART_COLORS } from './Viewer';
import { call } from './worker/client';
import { sizeOf, type BBox, type IndexedMesh } from './core/mesh';
import { planeFrom, type Part, type Plane, type Vec3 } from './core/ops';
import { writeSTL } from './core/stl';
import { write3MF } from './core/threemf';
import { fitOf, layoutOnPlate, type Fit } from './core/layout';
import type { PackResult } from './core/pack';
import { PRINTERS, SLICERS, CUSTOM_PRINTER, type SlicerId } from './core/printers';
import { exportForSlicer } from './core/slicers';
import { download } from './download';

// remembered per browser; storage can be unavailable (private mode), so never rely on it
const STORE_KEY = 'stl-splitter:printer';
function loadPrinterPrefs(): { printer: string; slicer: SlicerId; bed: Vec3 } {
  const fallback = { printer: 'bambu-p1', slicer: 'bambu' as SlicerId, bed: [256, 256, 256] as Vec3 };
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (v && Array.isArray(v.bed) && v.bed.length === 3 && SLICERS.some((s) => s.id === v.slicer)) return v;
  } catch { /* ignore */ }
  return fallback;
}
function savePrinterPrefs(v: { printer: string; slicer: SlicerId; bed: Vec3 }) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
const BRANDS = [...new Set(PRINTERS.map((p) => p.brand))];
import { DEFAULT_CLEARANCE, COUPON_CLEARANCES, protrusionReserve, type Connector, type ConnectorSettings, type ConnectorType } from './core/connectors';

const CONN_TYPES: { id: ConnectorType | 'none'; label: string }[] = [
  { id: 'peg', label: 'Peg' }, { id: 'dowel', label: 'Dowel' }, { id: 'dovetail', label: 'Dovetail' }, { id: 'none', label: 'None' },
];

type Axis = 0 | 1 | 2;
const AXES = ['X', 'Y', 'Z'] as const;

interface Loaded { name: string; mesh: IndexedMesh; bbox: BBox; volume: number; triangles: number; scale: number; rawMax: number }

/** A cut plane as the user edits it: axis, absolute position (mm), two tilts (deg). */
interface PlaneSpec { axis: Axis; pos: number; tiltA: number; tiltB: number }

// STL has no units: the file's numbers are multiplied by this to get mm.
const UNITS = [
  { label: 'mm', scale: 1 },
  { label: 'cm', scale: 10 },
  { label: 'inch', scale: 25.4 },
  { label: 'µm', scale: 0.001 },
] as const;

const otherAxes = (a: Axis) => [0, 1, 2].filter((k) => k !== a) as [Axis, Axis];

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadCount, setLoadCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [prefs] = useState(loadPrinterPrefs);
  const [bed, setBed] = useState<Vec3>(prefs.bed);
  const [printerId, setPrinterId] = useState(prefs.printer);
  const [slicer, setSlicer] = useState<SlicerId>(prefs.slicer);
  const [margin, setMargin] = useState(2);
  const [minPart, setMinPart] = useState(20);

  const [specs, setSpecs] = useState<PlaneSpec[]>([]);
  const [active, setActive] = useState<number | null>(null);

  const [parts, setParts] = useState<Part[] | null>(null);
  const [cutPlanes, setCutPlanes] = useState<Plane[]>([]);
  const [explode, setExplode] = useState(15);
  const [hovered, setHovered] = useState<number | null>(null);
  const [gap, setGap] = useState(4);
  const [layout, setLayout] = useState<PackResult | null>(null);
  const [view, setView] = useState<'assembly' | 'plates'>('assembly');
  const packTimer = useRef<number>();

  const [connType, setConnType] = useState<ConnectorType | 'none'>('peg');
  const [clearance, setClearance] = useState<Record<ConnectorType, number>>(DEFAULT_CLEARANCE);
  const [connectors, setConnectors] = useState<Connector[] | null>(null); // null = auto-place on next cut
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [pins, setPins] = useState<Part[]>([]);
  const [activeConn, setActiveConn] = useState<string | null>(null);
  const recutTimer = useRef<number>();

  const center = useMemo<Vec3>(() => {
    if (!loaded) return [0, 0, 0];
    const { min, max } = loaded.bbox;
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  }, [loaded]);

  const planes = useMemo(() => specs.map((s) => {
    const pt: Vec3 = [...center];
    pt[s.axis] = s.pos;
    return planeFrom(s.axis, s.tiltA, s.tiltB, pt);
  }), [specs, center]);

  // any edit to the planes invalidates the last cut
  const editSpecs = (next: PlaneSpec[]) => {
    setSpecs(next); setParts(null); setPins([]); setConnectors(null); setActiveConn(null); setLayout(null); setView('assembly');
  };

  const settingsFor = (type = connType, clr = clearance): ConnectorSettings =>
    ({ type, clearance: clr, maxPerFace: 4, minPart });

  const load = useCallback(async (name: string, file?: ArrayBuffer, scale?: number) => {
    setError(null); setInfo(null); setParts(null); setSpecs([]); setActive(null); setBusy('Loading…');
    const res = await call<'loaded'>({ type: 'load', file, scale }, file ? [file] : []);
    setBusy(null);
    if (res.type === 'error') { setError(res.message); setLoaded(null); return; }
    setLoaded({ name, ...res });
    setLoadCount((n) => n + 1);
  }, []);

  const onFile = useCallback(async (file: File) => {
    load(file.name.replace(/\.stl$/i, ''), await file.arrayBuffer());
  }, [load]);

  const doAutoSplit = async () => {
    setBusy('Finding cut positions…'); setError(null);
    const res = await call<'autosplit'>({ type: 'autosplit', bed, margin, minPart, reserve: protrusionReserve(connType, minPart) });
    setBusy(null);
    if (res.type === 'error') { setError(res.message); return; }
    const next = res.result.cuts.map((c) => ({ axis: c.axis, pos: c.pos, tiltA: 0, tiltB: 0 }));
    editSpecs(next); setActive(null);
    setInfo(next.length ? `${next.length} cuts placed in ${res.ms.toFixed(0)} ms` : 'Already fits the bed; no cuts needed');
    if (next.length) doCut(next);
  };

  const doCut = async (from: PlaneSpec[] = specs, conns: Connector[] | null = null, settings = settingsFor()) => {
    const pl = from.map((s) => { const pt: Vec3 = [...center]; pt[s.axis] = s.pos; return planeFrom(s.axis, s.tiltA, s.tiltB, pt); });
    setBusy(conns ? 'Updating connectors…' : 'Cutting…'); setError(null);
    const res = await call<'cut'>({ type: 'cut', planes: pl, connectors: conns, settings });
    setBusy(null);
    if (res.type === 'error') { setError(res.message); return; }
    setParts(res.parts); setPins(res.pins); setCutPlanes(pl); setHovered(null);
    doPack(res.parts, res.pins);
    setConnectors(res.connectors); setApplied(new Set(res.applied));
    if (!conns && res.skipped) setInfo(`${res.skipped} cut face(s) too thin for a connector`);
  };

  /** Orient every part and pack onto plates (in the worker). */
  const doPack = async (ps: Part[], pn: Part[], b = bed, g = gap, m = margin) => {
    setLayout(null);
    const res = await call<'pack'>({ type: 'pack', meshes: [...ps, ...pn].map((p) => p.mesh), bed: b, gap: g, margin: m });
    if (res.type === 'error') { setError(res.message); return; }
    setLayout(res.result);
  };
  const repackSoon = (b = bed, g = gap, m = margin) => {
    if (!parts) return;
    window.clearTimeout(packTimer.current);
    packTimer.current = window.setTimeout(() => doPack(parts, pins, b, g, m), 400);
  };

  const choosePrinter = (id: string) => {
    setPrinterId(id);
    const pr = PRINTERS.find((p) => p.id === id);
    if (!pr) { savePrinterPrefs({ printer: id, slicer, bed }); return; }
    setBed(pr.bed); setSlicer(pr.slicer);
    savePrinterPrefs({ printer: id, slicer: pr.slicer, bed: pr.bed });
    repackSoon(pr.bed);
    if (parts && loaded) {
      const big = parts.some((p) => fitOf(sizeOf(p.bbox), pr.bed) === 'too-big');
      if (big) setInfo('Some parts are too big for this printer — run Auto-split again');
    }
  };
  const chooseSlicer = (id: SlicerId) => { setSlicer(id); savePrinterPrefs({ printer: printerId, slicer: id, bed }); };
  const editBed = (b: Vec3) => {
    setBed(b); setPrinterId(CUSTOM_PRINTER);
    savePrinterPrefs({ printer: CUSTOM_PRINTER, slicer, bed: b });
    repackSoon(b);
  };

  /** Re-cut shortly after the last edit, so sliders stay responsive. */
  const recutSoon = (conns: Connector[] | null, settings = settingsFor()) => {
    window.clearTimeout(recutTimer.current);
    recutTimer.current = window.setTimeout(() => doCut(specs, conns, settings), 350);
  };

  const changeConnType = (t: ConnectorType | 'none') => {
    setConnType(t); setActiveConn(null);
    if (parts) doCut(specs, null, settingsFor(t));
  };

  const changeClearance = (t: ConnectorType, v: number) => {
    const next = { ...clearance, [t]: v };
    setClearance(next);
    if (parts) recutSoon(connectors, settingsFor(connType, next));
  };

  const updateConn = (id: string, patch: Partial<Connector>) => {
    if (!connectors) return;
    const next = connectors.map((c) => (c.id === id ? { ...c, ...patch } : c));
    setConnectors(next);
    recutSoon(next);
  };

  const removeConn = (id: string) => {
    if (!connectors) return;
    const next = connectors.filter((c) => c.id !== id);
    setConnectors(next); setActiveConn(null);
    doCut(specs, next);
  };

  const exportCoupon = async () => {
    const type = connType === 'none' ? 'peg' : connType;
    const radii = (connectors ?? []).filter((c) => c.type === type).map((c) => c.radius).sort((a, b) => a - b);
    const depths = (connectors ?? []).filter((c) => c.type === type).map((c) => c.depth).sort((a, b) => a - b);
    const radius = radii.length ? radii[Math.floor(radii.length / 2)] : 4;
    const depth = depths.length ? depths[Math.floor(depths.length / 2)] : 8;
    const res = await call<'coupon'>({ type: 'coupon', connector: type, radius, depth });
    if (res.type === 'error') { setError(res.message); return; }
    const placed = layoutOnPlate(res.parts.map((p) => p.mesh), bed);
    const note = await download(write3MF(placed.map((mesh, i) => ({ name: res.parts[i].name, mesh }))), `coupon_${type}.3mf`, 'model/3mf');
    if (note) { setInfo(note); return; }
    setInfo(`Coupon: holes 1–${COUPON_CLEARANCES.length} = ${COUPON_CLEARANCES.join(' / ')} mm (count the notches)`);
  };

  const addPlane = () => {
    if (!loaded) return;
    // longest axis is the most likely to need another cut
    const s = sizeOf(loaded.bbox);
    const axis = s.indexOf(Math.max(...s)) as Axis;
    editSpecs([...specs, { axis, pos: center[axis], tiltA: 0, tiltB: 0 }]);
    setActive(specs.length);
  };

  const updateActive = (patch: Partial<PlaneSpec>) => {
    if (active === null) return;
    editSpecs(specs.map((s, i) => (i === active ? { ...s, ...patch } : s)));
  };

  const removeActive = () => {
    if (active === null) return;
    editSpecs(specs.filter((_, i) => i !== active));
    setActive(null);
  };

  const partName = (i: number) => `${loaded?.name ?? 'part'}_${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`;

  const objName = (i: number) => (parts && i >= parts.length ? `${loaded!.name}_pin${i - parts.length + 1}` : partName(i));

  /** Every part + pin, oriented and placed on its plate (falls back to a simple layout while packing). */
  const allExports = () => {
    if (!parts) return [];
    if (layout) return layout.placed.map((p) => ({ name: objName(p.index), mesh: p.mesh, plate: p.plate }));
    const meshes = [...parts, ...pins].map((p) => p.mesh);
    return layoutOnPlate(meshes, bed).map((mesh, i) => ({ name: objName(i), mesh, plate: 0 }));
  };

  const slicerInfo = SLICERS.find((x) => x.id === slicer)!;

  /** Project for the chosen slicer: one multi-plate file, or a zip of per-plate files. */
  const exportForChosenSlicer = () => {
    if (!layout) return;
    const objs = allExports();
    const out = exportForSlicer(slicer, objs, layout.plates, bed, loaded!.name, slicerInfo.maxPlates);
    download(out.data, out.filename, out.kind === 'zip' ? 'application/zip' : 'model/3mf').then((note) => note && setInfo(note));
    if (out.kind === 'zip' && slicer !== 'generic') setInfo(`${slicerInfo.label} supports up to ${slicerInfo.maxPlates} plates; exported one file per plate instead`);
  };

  const exportZip = () => {
    const files: Record<string, Uint8Array> = {};
    for (const p of allExports()) files[`${p.name}.stl`] = new Uint8Array(writeSTL(p.mesh, p.name));
    download(zipSync(files), `${loaded!.name}_parts.zip`, 'application/zip').then((note) => note && setInfo(note));
  };

  const modelSize = loaded ? sizeOf(loaded.bbox) : null;
  const act = active !== null ? specs[active] : null;
  const aConn = connectors?.find((c) => c.id === activeConn) ?? null;
  const connLabel = (c: Connector) => `${AXES[specs[c.plane]?.axis ?? 0]} ${specs[c.plane]?.pos.toFixed(0) ?? ''}`;
  const tooBig = parts?.filter((p) => fitOf(sizeOf(p.bbox), bed) === 'too-big').length ?? 0;

  return (
    <div className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <aside className="panel">
        <header>
          <h1>Dovetail</h1>
          <span className="tag">v0.5</span>
        </header>

        <section>
          <label className="file">
            <input type="file" accept=".stl" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            {loaded ? `↺ ${loaded.name}.stl` : 'Open or drop an STL'}
          </label>
          {loaded && modelSize && (
            <div className="meta">
              <span>{fmt3(modelSize)} mm</span>
              <span>{loaded.triangles.toLocaleString()} tris</span>
              <FitBadge fit={fitOf(modelSize, bed)} />
            </div>
          )}
          {loaded && (
            <>
              <div className="seg units">
                {UNITS.map((u) => (
                  <button key={u.label} className={loaded.scale === u.scale ? 'on' : ''}
                    onClick={() => loaded.scale !== u.scale && load(loaded.name, undefined, u.scale)}>{u.label}</button>
                ))}
              </div>
              <RealSize key={`${loadCount}-${loaded.scale}`} current={loaded.rawMax * loaded.scale}
                onSet={(mm) => load(loaded.name, undefined, mm / loaded.rawMax)} />
              {loaded.rawMax > 3000 && (
                <p className="hint">STL files carry no units. If the size above is wrong, type the real length of the longest side.</p>
              )}
            </>
          )}
        </section>

        <section>
          <h2>Printer</h2>
          <select className="select" value={printerId} onChange={(e) => choosePrinter(e.target.value)}>
            {BRANDS.map((b) => (
              <optgroup key={b} label={b}>
                {PRINTERS.filter((p) => p.brand === b).map((p) => (
                  <option key={p.id} value={p.id}>{p.brand} {p.model} ({p.bed[0]}×{p.bed[1]})</option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM_PRINTER}>Custom bed size</option>
          </select>
          <label className="slicer">
            <span>Slicer</span>
            <select className="select" value={slicer} onChange={(e) => chooseSlicer(e.target.value as SlicerId)}>
              {SLICERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div className="row3">
            {AXES.map((a, k) => (
              <label key={a} className="num">
                <span>{a}</span>
                <input type="number" min={20} value={bed[k]}
                  onChange={(e) => { const b = [...bed] as Vec3; b[k] = +e.target.value || 0; editBed(b); }} />
              </label>
            ))}
          </div>
          <div className="row3 settings">
            <label className="num"><span>Gap</span>
              <input type="number" min={0} value={gap} onChange={(e) => { const g = Math.max(0, +e.target.value || 0); setGap(g); repackSoon(bed, g); }} /></label>
            <label className="num"><span>Margin</span>
              <input type="number" min={0} value={margin} onChange={(e) => { const m = Math.max(0, +e.target.value || 0); setMargin(m); repackSoon(bed, gap, m); }} /></label>
            <label className="num"><span>Min part</span>
              <input type="number" min={1} value={minPart} onChange={(e) => setMinPart(+e.target.value || 1)} /></label>
          </div>
        </section>

        <section className={!loaded ? 'disabled' : ''}>
          <h2>Cuts {specs.length > 0 && <span className="count">{specs.length}</span>}</h2>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="primary" onClick={doAutoSplit} disabled={!loaded || !!busy}>Auto-split</button>
            <button onClick={addPlane} disabled={!loaded || !!busy}>+ Plane</button>
          </div>

          {specs.length > 0 && (
            <ul className="planes">
              {specs.map((s, i) => (
                <li key={i} className={active === i ? 'sel' : ''} onClick={() => setActive(active === i ? null : i)}>
                  <b>{AXES[s.axis]}</b>
                  <span>{s.pos.toFixed(1)} mm{(s.tiltA || s.tiltB) ? ` · ${s.tiltA}° / ${s.tiltB}°` : ''}</span>
                </li>
              ))}
            </ul>
          )}

          {act && loaded && (
            <div className="editor">
              <div className="seg">
                {AXES.map((a, k) => (
                  <button key={a} className={act.axis === k ? 'on' : ''}
                    onClick={() => updateActive({ axis: k as Axis, pos: center[k] })}>{a}</button>
                ))}
              </div>
              <Slider label="Position" value={act.pos}
                min={loaded.bbox.min[act.axis]} max={loaded.bbox.max[act.axis]} step={0.5}
                display={`${act.pos.toFixed(1)} mm`} onChange={(v) => updateActive({ pos: v })} />
              <Slider label={`Tilt ${AXES[otherAxes(act.axis)[0]]}`} value={act.tiltA} min={-60} max={60} step={1}
                display={`${act.tiltA}°`} onChange={(v) => updateActive({ tiltA: v })} />
              <Slider label={`Tilt ${AXES[otherAxes(act.axis)[1]]}`} value={act.tiltB} min={-60} max={60} step={1}
                display={`${act.tiltB}°`} onChange={(v) => updateActive({ tiltB: v })} />
              <button className="link danger" onClick={removeActive}>Remove plane</button>
            </div>
          )}

          {specs.length > 0 && (
            <div className="actions">
              <button className="primary" onClick={() => doCut()} disabled={!!busy || !!parts}>{parts ? 'Cut ✓' : 'Cut'}</button>
              <button onClick={() => { editSpecs([]); setActive(null); setInfo(null); }}>Clear</button>
            </div>
          )}
        </section>

        <section className={!loaded ? 'disabled' : ''}>
          <h2>Connectors {connectors && connectors.length > 0 && <span className="count">{applied.size}</span>}</h2>
          <div className="seg four">
            {CONN_TYPES.map((t) => (
              <button key={t.id} className={connType === t.id ? 'on' : ''} onClick={() => changeConnType(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="clr">
            <span>Clearance per side (mm)</span>
            {(['peg', 'dowel', 'dovetail'] as ConnectorType[]).map((t) => (
              <label key={t} className={`num ${connType === t ? 'hl' : ''}`} title={`${t} clearance per side (mm)`}>
                <span>{t}</span>
                <input type="number" min={0} max={1} step={0.05} value={clearance[t]}
                  onChange={(e) => changeClearance(t, Math.max(0, +e.target.value))} />
              </label>
            ))}
          </div>
          <button className="link" onClick={exportCoupon} disabled={!!busy}>
            ↓ Test coupon for {connType === 'none' ? 'peg' : connType} ({COUPON_CLEARANCES[0]}–{COUPON_CLEARANCES[COUPON_CLEARANCES.length - 1]} mm)
          </button>

          {parts && connectors && connectors.length > 0 && (
            <ul className="planes conns">
              {connectors.map((c, i) => (
                <li key={c.id} className={`${activeConn === c.id ? 'sel' : ''} ${applied.has(c.id) ? '' : 'unused'}`}
                  onClick={() => setActiveConn(activeConn === c.id ? null : c.id)}>
                  <b>{i + 1}</b>
                  <span>{connLabel(c)} · {c.type} ⌀{(c.radius * 2).toFixed(1)} × {c.depth.toFixed(0)}
                    {c.clearance !== undefined ? ` · ${c.clearance}` : ''}{applied.has(c.id) ? '' : ' · not applied'}</span>
                </li>
              ))}
            </ul>
          )}

          {aConn && (
            <div className="editor">
              <div className="seg">
                {(['peg', 'dowel', 'dovetail'] as ConnectorType[]).map((t) => (
                  <button key={t} className={aConn.type === t ? 'on' : ''} onClick={() => updateConn(aConn.id, { type: t })}>{t}</button>
                ))}
              </div>
              <Slider label={aConn.type === 'dovetail' ? 'Width' : 'Diameter'} value={aConn.radius * 2} min={2} max={30} step={0.5}
                display={`${(aConn.radius * 2).toFixed(1)} mm`} onChange={(v) => updateConn(aConn.id, { radius: v / 2 })} />
              <Slider label="Depth" value={aConn.depth} min={2} max={30} step={0.5}
                display={`${aConn.depth.toFixed(1)} mm`} onChange={(v) => updateConn(aConn.id, { depth: v })} />
              <label className="num override">
                <span>Clearance override</span>
                <input type="number" min={0} step={0.05} placeholder={String(clearance[aConn.type])}
                  value={aConn.clearance ?? ''}
                  onChange={(e) => updateConn(aConn.id, { clearance: e.target.value === '' ? undefined : Math.max(0, +e.target.value) })} />
              </label>
              <button className="link danger" onClick={() => removeConn(aConn.id)}>Remove connector</button>
            </div>
          )}

          {parts && connectors && (
            <button className="link" onClick={() => { setActiveConn(null); doCut(specs, null); }} disabled={!!busy}>↺ Re-place automatically</button>
          )}
        </section>

        {parts && (
          <section>
            <h2>Parts <span className="count">{parts.length}</span>
              {pins.length > 0 && <span className="count" style={{ marginLeft: 4 }}>+{pins.length} pins</span>}
              {tooBig > 0 && <span className="fit too-big" style={{ marginLeft: 6 }}>{tooBig} too big</span>}</h2>
            <div className="seg">
              <button className={view === 'assembly' ? 'on' : ''} onClick={() => setView('assembly')}>Assembly</button>
              <button className={view === 'plates' ? 'on' : ''} onClick={() => setView('plates')} disabled={!layout}>
                {layout ? `Plates · ${layout.plates}` : 'Packing…'}
              </button>
            </div>
            {view === 'assembly' && (
              <Slider label="Explode" value={explode} min={0} max={80} step={1} display={`${explode} mm`} onChange={setExplode} />
            )}
            <ul className="parts">
              {parts.map((p, i) => (
                <li key={i} className={hovered === i ? 'sel' : ''}
                  onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                  <i style={{ background: PART_COLORS[i % PART_COLORS.length] }} />
                  <b>{partName(i).split('_').pop()}</b>
                  <span>{fmt3(sizeOf(p.bbox))}</span>
                  {layout && <em className="plate-no">P{(layout.placed.find((x) => x.index === i)?.plate ?? 0) + 1}</em>}
                  <FitBadge fit={fitOf(sizeOf(p.bbox), bed)} />
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="primary" onClick={exportForChosenSlicer} disabled={!layout} title={slicerInfo.note}>
                {layout ? `Export for ${slicerInfo.label.split(' / ')[0]}` : 'Packing…'}
              </button>
              <button onClick={exportZip}>STL zip</button>
            </div>
            {layout && <p className="export-note">{slicerInfo.note}{layout.plates > slicerInfo.maxPlates ? ` — over ${slicerInfo.maxPlates} plates, so one file per plate` : ''}</p>}
          </section>
        )}

        <footer>
          {busy && <div className="busy">{busy}</div>}
          {!busy && info && <div className="info">{info}</div>}
          {error && <div className="error">{error}</div>}
          <p className="next">Next up: drag cut planes in the viewport</p>
        </footer>
      </aside>

      <main className="view">
        {loaded && view === 'plates' && layout ? (
          <PlatesView key={`p${loadCount}`} bed={bed} plates={layout.plates} highlight={hovered === null ? null : layout.placed.findIndex((x) => x.index === hovered)}
            placed={layout.placed.map((p) => ({
              mesh: p.mesh, plate: p.plate, fits: p.fits,
              color: parts && p.index < parts.length ? PART_COLORS[p.index % PART_COLORS.length] : '#d9dde3',
            }))} />
        ) : loaded ? (
          <Viewer key={loadCount} model={loaded.mesh} bbox={loaded.bbox} bed={bed}
            previewPlanes={planes} activePlane={active} parts={parts} cutPlanes={cutPlanes}
            explode={explode} selected={hovered} pins={pins}
            marker={aConn && cutPlanes[aConn.plane] ? { at: aConn.at, normal: cutPlanes[aConn.plane].normal, radius: aConn.radius } : null} />
        ) : (
          <div className="empty">Drop an STL anywhere</div>
        )}
      </main>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, onChange }:
  { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span><em>{display}</em>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

/** "Longest side = N mm" field; committing it rescales the model to that size. */
function RealSize({ current, onSet }: { current: number; onSet: (mm: number) => void }) {
  const [text, setText] = useState(current.toFixed(1));
  const commit = () => {
    const v = parseFloat(text);
    if (v > 0 && Math.abs(v - current) > 1e-3) onSet(v); else setText(current.toFixed(1));
  };
  return (
    <label className="num realsize">
      <span>Longest side</span>
      <input type="number" min={0.1} step="any" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span>mm</span>
    </label>
  );
}

function FitBadge({ fit }: { fit: Fit }) {
  const text = { fits: 'fits', rotate: 'fits rotated', 'too-big': 'too big' }[fit];
  return <span className={`fit ${fit}`}>{text}</span>;
}

const fmt3 = (s: number[]) => s.map((v) => v.toFixed(0)).join(' × ');

