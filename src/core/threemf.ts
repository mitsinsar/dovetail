import { zipSync, strToU8 } from 'fflate';
import type { IndexedMesh } from './mesh';

export interface Placed {
  name: string;
  mesh: IndexedMesh; // already oriented and placed (z >= 0)
}

/** Object whose mesh is centred on its own origin, placed by a build-item translation. */
export interface ProjectObject extends Placed {
  translate: [number, number, number];
}

export interface Write3MFOptions {
  metadata?: Record<string, string>; // <metadata name=...> in the model file
  extraFiles?: Record<string, Uint8Array>; // e.g. slicer config files
}

/** Build a 3MF: every part is its own object; `translate` (if given) goes in the build item. */
export function write3MF(parts: (Placed | ProjectObject)[], opts: Write3MFOptions = {}): Uint8Array {
  const objects: string[] = [];
  const items: string[] = [];
  parts.forEach((part, i) => {
    const id = i + 1;
    const { positions: p, indices: ix } = part.mesh;
    const verts: string[] = [];
    for (let v = 0; v < p.length; v += 3) {
      verts.push(`<vertex x="${num(p[v])}" y="${num(p[v + 1])}" z="${num(p[v + 2])}"/>`);
    }
    const tris: string[] = [];
    for (let t = 0; t < ix.length; t += 3) {
      tris.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`);
    }
    objects.push(
      `<object id="${id}" name="${escapeXml(part.name)}" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    const t = 'translate' in part ? part.translate : null;
    items.push(t
      ? `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(t[0])} ${num(t[1])} ${num(t[2])}" printable="1"/>`
      : `<item objectid="${id}"/>`);
  });

  const meta = { Application: 'Dovetail', ...opts.metadata };
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
${Object.entries(meta).map(([k, v]) => `<metadata name="${escapeXml(k)}">${escapeXml(v)}</metadata>`).join('\n')}
<resources>${objects.join('')}</resources>
<build>${items.join('')}</build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="text/xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
    ...opts.extraFiles,
  });
}

const num = (v: number) => (Math.abs(v) < 5e-5 ? '0' : v.toFixed(4).replace(/\.?0+$/, ''));

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
