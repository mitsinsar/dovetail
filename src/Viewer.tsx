import { useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Html } from '@react-three/drei';
import type { BBox, IndexedMesh } from './core/mesh';
import type { Part, Plane, Vec3 } from './core/ops';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // printers are Z-up

export const PART_COLORS = ['#4fb3bf', '#e8a33d', '#9b7fd1', '#6cbf5a', '#e06c75', '#56a0e0', '#d6c35a', '#c77dba'];

function useGeometry(mesh: IndexedMesh) {
  return useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
}

function MeshView({ mesh, color, offset = [0, 0, 0], opacity = 1 }:
  { mesh: IndexedMesh; color: string; offset?: [number, number, number]; opacity?: number }) {
  const geo = useGeometry(mesh);
  return (
    <mesh geometry={geo} position={offset}>
      <meshStandardMaterial color={color} flatShading metalness={0.05} roughness={0.7}
        transparent={opacity < 1} opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

function PlaneView({ plane, size, active, center }: { plane: Plane; size: number; active: boolean; center: Vec3 }) {
  const { position, quaternion } = useMemo(() => {
    const n = new THREE.Vector3(...plane.normal);
    const c = new THREE.Vector3(...center);
    return {
      // centre the square on the model: project the model centre onto the plane
      position: c.clone().addScaledVector(n, plane.offset - n.dot(c)),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n),
    };
  }, [plane, center]);
  return (
    <group position={position} quaternion={quaternion}>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={active ? '#ff5a36' : '#5aa9ff'} transparent opacity={active ? 0.3 : 0.12} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
        <lineBasicMaterial color={active ? '#ff5a36' : '#5aa9ff'} />
      </lineSegments>
    </group>
  );
}

/** Plane square big enough to cover the model's cross-section, not the whole diagonal. */
function planeSize(bbox: BBox | null, pl: Plane) {
  if (!bbox) return 200;
  const s = bbox.max.map((v, k) => v - bbox.min[k]);
  const ax = pl.normal.map(Math.abs).indexOf(Math.max(...pl.normal.map(Math.abs)));
  const other = s.filter((_, k) => k !== ax);
  return Math.max(...other) * 1.15;
}

const centerOf = (p: Part): Vec3 => p.bbox.min.map((v, k) => (v + p.bbox.max[k]) / 2) as Vec3;

/** Explode offset for a point; points lying on a plane stay centred on it (pins, markers). */
function explodeAt(pt: Vec3, planes: Plane[], amount: number, centreOnPlane: boolean): Vec3 {
  const o: Vec3 = [0, 0, 0];
  for (const pl of planes) {
    const d = pt[0] * pl.normal[0] + pt[1] * pl.normal[1] + pt[2] * pl.normal[2] - pl.offset;
    if (centreOnPlane && Math.abs(d) < 0.5) continue;
    const side = Math.sign(d) || 1;
    for (let k = 0; k < 3; k++) o[k] += side * amount * pl.normal[k];
  }
  return o;
}

/** Ring highlighting the selected connector. */
function Marker({ at, normal, radius, offset }: { at: Vec3; normal: Vec3; radius: number; offset: Vec3 }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal)), [normal]);
  return (
    <mesh position={[at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]]} quaternion={q} renderOrder={10}>
      <torusGeometry args={[radius + 2, 0.6, 12, 48]} />
      <meshBasicMaterial color="#ff5a36" depthTest={false} transparent />
    </mesh>
  );
}

/** Push each part away from every cut plane, toward its own side. */
function explodeOffset(part: Part, planes: Plane[], amount: number): [number, number, number] {
  const c = part.bbox.min.map((v, k) => (v + part.bbox.max[k]) / 2);
  const o: [number, number, number] = [0, 0, 0];
  for (const pl of planes) {
    const side = Math.sign(c[0] * pl.normal[0] + c[1] * pl.normal[1] + c[2] * pl.normal[2] - pl.offset) || 1;
    for (let k = 0; k < 3; k++) o[k] += side * amount * pl.normal[k];
  }
  return o;
}

export interface ViewerProps {
  model: IndexedMesh | null;
  bbox: BBox | null;
  bed: [number, number, number];
  previewPlanes: Plane[];
  activePlane: number | null;
  parts: Part[] | null;
  cutPlanes: Plane[];
  explode: number;
  selected: number | null;
  pins: Part[];
  marker: { at: Vec3; normal: Vec3; radius: number } | null;
}

export function Viewer({ model, bbox, bed, previewPlanes, activePlane, parts, cutPlanes, explode, selected, pins, marker }: ViewerProps) {
  const diag = bbox ? Math.hypot(...bbox.max.map((v, k) => v - bbox.min[k])) : 200;
  const center = bbox ? bbox.min.map((v, k) => (v + bbox.max[k]) / 2) as [number, number, number] : [0, 0, 0] as [number, number, number];
  const camPos: [number, number, number] = [center[0] + diag, center[1] - diag * 1.2, center[2] + diag * 0.8];

  return (
    <Canvas camera={{ position: camPos, fov: 40, near: diag / 1000, far: diag * 50 }}>
      <color attach="background" args={['#14171c']} />
      <hemisphereLight args={['#ffffff', '#30343c', 1.1]} />
      <directionalLight position={[diag, -diag, diag * 2]} intensity={1.6} />
      <OrbitControls target={center} makeDefault />

      {/* bed footprint, centered under the model */}
      <group position={[center[0], center[1], bbox ? bbox.min[2] : 0]}>
        <gridHelper args={[Math.max(bed[0], bed[1]), Math.max(bed[0], bed[1]) / 16, '#3a4150', '#252a33']} rotation={[Math.PI / 2, 0, 0]} />
        <lineSegments position={[0, 0, bed[2] / 2]}>
          <edgesGeometry args={[new THREE.BoxGeometry(bed[0], bed[1], bed[2])]} />
          <lineBasicMaterial color="#3d6b8a" transparent opacity={0.5} />
        </lineSegments>
      </group>

      {parts
        ? parts.map((p, i) => (
            <MeshView key={i} mesh={p.mesh} color={PART_COLORS[i % PART_COLORS.length]}
              offset={explodeOffset(p, cutPlanes, explode)}
              opacity={selected === null || selected === i ? 1 : 0.25} />
          ))
        : model && <MeshView mesh={model} color="#b9c2cf" />}

      {parts && pins.map((p, i) => (
        <MeshView key={`pin${i}`} mesh={p.mesh} color="#d9dde3" offset={explodeAt(centerOf(p), cutPlanes, explode, true)} />
      ))}

      {marker && <Marker {...marker} offset={explodeAt(marker.at, cutPlanes, explode, true)} />}

      {previewPlanes.map((pl, i) => (!parts || activePlane === i) && (
        <PlaneView key={i} plane={pl} active={activePlane === i} size={planeSize(bbox, pl)} center={center} />
      ))}

      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport labelColor="white" axisHeadScale={0.9} />
      </GizmoHelper>
    </Canvas>
  );
}

export interface PlatesViewProps {
  bed: [number, number, number];
  plates: number;
  placed: { mesh: IndexedMesh; plate: number; color: string; fits: boolean }[];
  highlight: number | null; // index into placed
}

/** All plates side by side, parts in their print orientation. */
export function PlatesView({ bed, plates, placed, highlight }: PlatesViewProps) {
  const step = bed[0] + 40;
  const cols = Math.min(plates, 4);
  const rows = Math.ceil(plates / cols);
  const at = (i: number): [number, number] => [(i % cols) * step, -Math.floor(i / cols) * (bed[1] + 40)];
  const w = cols * step, h = rows * (bed[1] + 40);
  const center: [number, number, number] = [w / 2 - 20, -h / 2 + bed[1] / 2 + 20, 0];
  const dist = Math.max(w, h);
  return (
    <Canvas camera={{ position: [center[0], center[1] - dist * 0.9, dist * 0.9], fov: 40, near: 1, far: dist * 20 }}>
      <color attach="background" args={['#14171c']} />
      <hemisphereLight args={['#ffffff', '#30343c', 1.1]} />
      <directionalLight position={[w, -h, dist]} intensity={1.6} />
      <OrbitControls target={center} makeDefault />
      {Array.from({ length: plates }, (_, i) => {
        const [x, y] = at(i);
        return (
          <group key={i} position={[x, y, 0]}>
            <mesh position={[bed[0] / 2, bed[1] / 2, -0.6]}>
              <boxGeometry args={[bed[0], bed[1], 1.2]} />
              <meshStandardMaterial color="#232830" roughness={0.9} />
            </mesh>
            <gridHelper args={[bed[0], 16, '#3a4150', '#2b313b']} rotation={[Math.PI / 2, 0, 0]} position={[bed[0] / 2, bed[1] / 2, 0.05]} />
            <Html position={[0, -6, 0]} style={{ color: '#7f8896', font: '600 12px Inter, system-ui', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              PLATE {i + 1}
            </Html>
          </group>
        );
      })}
      {placed.map((p, i) => {
        const [x, y] = at(p.plate);
        return (
          <MeshView key={i} mesh={p.mesh} color={p.fits ? p.color : '#e06c75'} offset={[x, y, 0]}
            opacity={highlight === null || highlight === i ? 1 : 0.3} />
        );
      })}
    </Canvas>
  );
}
