import type { Layout } from '@ascii-erd/layout';
import { drawEntity } from './box.js';
import { Canvas } from './canvas.js';
import { drawEdge } from './edges.js';
import { ASCII, type Glyphs, UNICODE } from './glyphs.js';

export interface RenderOptions {
  glyphs?: 'ascii' | 'unicode';
}

export function render(layout: Layout, options: RenderOptions = {}): string {
  const glyphs: Glyphs = options.glyphs === 'ascii' ? ASCII : UNICODE;
  const { sizing, ir, placements } = layout;

  const totalWidth = sum(sizing.colStripWidths) + sum(sizing.channelColWidths);
  const totalHeight = sum(sizing.rowStripHeights) + sum(sizing.channelRowHeights);

  const canvas = new Canvas(totalWidth, totalHeight);
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));

  for (const placement of placements) {
    const entity = entitiesByName.get(placement.entity);
    if (!entity) continue;
    const x = stripOffset(sizing.colStripWidths, sizing.channelColWidths, placement.colStrip);
    const y = stripOffset(sizing.rowStripHeights, sizing.channelRowHeights, placement.rowStrip);
    const width = sizing.colStripWidths[placement.colStrip]!;
    drawEntity(canvas, entity, x, y, width, glyphs);
  }

  // Edges drawn after entities so port markers and channel lines can overwrite
  // border characters where they connect.
  for (const edge of layout.edges) {
    drawEdge(canvas, edge, glyphs);
  }

  return canvas.toString();
}

function sum(arr: number[]): number {
  return arr.reduce((s, n) => s + n, 0);
}

// Cumulative offset: sum of strip widths and intervening channels for indices
// strictly less than `index`. Channels live between strips, so channel[i] sits
// between strip[i] and strip[i+1].
function stripOffset(strips: number[], channels: number[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += strips[i]!;
    if (i < channels.length) offset += channels[i]!;
  }
  return offset;
}
