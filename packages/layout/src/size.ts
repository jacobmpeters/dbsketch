import type { Entity, IR } from '@ascii-erd/parser';
import type { Placement, StripSizing } from './types.js';

export function size(ir: IR, placements: Placement[]): StripSizing {
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));

  const numColStrips = placements.reduce((m, p) => Math.max(m, p.colStrip + 1), 0);
  const numRowStrips = placements.reduce((m, p) => Math.max(m, p.rowStrip + 1), 0);

  const colStripWidths = new Array<number>(numColStrips).fill(0);
  const rowStripHeights = new Array<number>(numRowStrips).fill(0);

  for (const p of placements) {
    const entity = entitiesByName.get(p.entity);
    if (!entity) continue;
    colStripWidths[p.colStrip] = Math.max(colStripWidths[p.colStrip]!, entityWidth(entity));
    rowStripHeights[p.rowStrip] = Math.max(rowStripHeights[p.rowStrip]!, entityHeight(entity));
  }

  // Channels grow with routing demand; first slice has no routing, so all zero.
  const channelColWidths = new Array<number>(Math.max(0, numColStrips - 1)).fill(0);
  const channelRowHeights = new Array<number>(Math.max(0, numRowStrips - 1)).fill(0);

  return { colStripWidths, channelColWidths, rowStripHeights, channelRowHeights };
}

// Box-drawn entity: │ <inner> │ where inner = max(name, max(col_name + ' ' + col_type)).
// Total width = inner + 4 (left border, space, content, space, right border).
function entityWidth(entity: Entity): number {
  let inner = entity.name.length;
  for (const col of entity.columns) {
    inner = Math.max(inner, col.name.length + 1 + col.type.length);
  }
  return inner + 4;
}

// Top border + header + separator + N column rows + bottom border.
function entityHeight(entity: Entity): number {
  return 4 + entity.columns.length;
}
