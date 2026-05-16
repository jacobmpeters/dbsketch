import type { IR } from '@ascii-erd/parser';
import type { Placement, StripSizing } from './types.js';

// Absolute position and dimensions of an entity box on the canvas.
export interface EntityBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EntityPositions = Map<string, EntityBox>;

// Compute each entity's absolute (x, y) position and dimensions. Currently
// uses row-strip-aligned y (top of row strip, entity top-aligned within
// strip) — the existing layout semantics. Stage 2 will swap this for per-col
// vertical stacking, and route/render shouldn't notice anywhere except here.
export function computeEntityPositions(
  ir: IR,
  placements: Placement[],
  sizing: StripSizing,
): EntityPositions {
  const positions: EntityPositions = new Map();
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));
  for (const p of placements) {
    const entity = entityByName.get(p.entity);
    if (!entity) continue;
    positions.set(p.entity, {
      x: stripOffset(sizing.colStripWidths, sizing.channelColWidths, p.colStrip),
      y: stripOffset(sizing.rowStripHeights, sizing.channelRowHeights, p.rowStrip),
      width: sizing.colStripWidths[p.colStrip] ?? 0,
      height: 4 + entity.columns.length,
    });
  }
  return positions;
}

function stripOffset(strips: number[], channels: number[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += strips[i] ?? 0;
    if (i < channels.length) offset += channels[i] ?? 0;
  }
  return offset;
}
