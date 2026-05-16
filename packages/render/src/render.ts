import type { Layout } from '@dbsketch/layout';
import { drawEntity } from './box.js';
import { Canvas } from './canvas.js';
import { drawEdge } from './edges.js';
import { ASCII, type Glyphs, UNICODE } from './glyphs.js';

export interface RenderOptions {
  glyphs?: 'ascii' | 'unicode';
}

export function render(layout: Layout, options: RenderOptions = {}): string {
  const glyphs: Glyphs = options.glyphs === 'ascii' ? ASCII : UNICODE;
  const { ir, entityPositions } = layout;

  // Canvas dimensions: the rightmost cell + 1 in each axis, derived from
  // entity positions (and edge segments — edges may extend slightly beyond
  // entity bounds, but in practice all stay within the entity bounding box
  // plus channel widths). Use sizing for the total to be safe.
  const totalWidth = canvasExtentX(layout);
  const totalHeight = canvasExtentY(layout);

  const canvas = new Canvas(totalWidth, totalHeight);
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));

  for (const [name, box] of entityPositions) {
    const entity = entitiesByName.get(name);
    if (!entity) continue;
    drawEntity(canvas, entity, box.x, box.y, box.width, glyphs);
  }

  // Edges drawn after entities so port markers and channel lines can overwrite
  // border characters where they connect.
  for (const edge of layout.edges) {
    drawEdge(canvas, edge, glyphs);
  }

  return canvas.toString();
}

// Canvas extent = max (entity right edge, edge segment right edge) + 1.
function canvasExtentX(layout: Layout): number {
  let max = 0;
  for (const box of layout.entityPositions.values()) {
    max = Math.max(max, box.x + box.width);
  }
  for (const edge of layout.edges) {
    for (const seg of edge.segments) {
      max = Math.max(max, seg.x1 + 1, seg.x2 + 1);
    }
  }
  return max;
}

function canvasExtentY(layout: Layout): number {
  let max = 0;
  for (const box of layout.entityPositions.values()) {
    max = Math.max(max, box.y + box.height);
  }
  for (const edge of layout.edges) {
    for (const seg of edge.segments) {
      max = Math.max(max, seg.y1 + 1, seg.y2 + 1);
    }
  }
  return max;
}
