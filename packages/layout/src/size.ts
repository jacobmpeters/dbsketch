import type { Entity, IR } from '@ascii-erd/parser';
import type { Placement, StripSizing } from './types.js';

// Visual-separation floor for channels, applied before any routing demand.
// Without this, adjacent boxes would touch and the diagram becomes unreadable.
const MIN_COL_CHANNEL = 2;
const MIN_ROW_CHANNEL = 1;

export type RowSizing = Pick<StripSizing, 'rowStripHeights' | 'channelRowHeights'>;

// Row sizing is independent of routing tracks — it only depends on entity
// heights. Splitting it out lets the router compute absolute y positions for
// edge endpoints before col widths are finalized.
export function rowSize(ir: IR, placements: Placement[]): RowSizing {
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));
  const numRowStrips = placements.reduce((m, p) => Math.max(m, p.rowStrip + 1), 0);
  const rowStripHeights = new Array<number>(numRowStrips).fill(0);
  for (const p of placements) {
    const entity = entitiesByName.get(p.entity);
    if (!entity) continue;
    rowStripHeights[p.rowStrip] = Math.max(rowStripHeights[p.rowStrip]!, entityHeight(entity));
  }
  const channelRowHeights = new Array<number>(Math.max(0, numRowStrips - 1)).fill(MIN_ROW_CHANNEL);
  return { rowStripHeights, channelRowHeights };
}

export function size(
  ir: IR,
  placements: Placement[],
  channelTrackCounts: Map<number, number> = new Map(),
): StripSizing {
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));
  const numColStrips = placements.reduce((m, p) => Math.max(m, p.colStrip + 1), 0);

  const colStripWidths = new Array<number>(numColStrips).fill(0);
  for (const p of placements) {
    const entity = entitiesByName.get(p.entity);
    if (!entity) continue;
    colStripWidths[p.colStrip] = Math.max(colStripWidths[p.colStrip]!, entityWidth(entity));
  }

  // Each routing track is one cell wide. Channel = max(visual floor, tracks).
  const channelColWidths = Array.from({ length: Math.max(0, numColStrips - 1) }, (_, i) =>
    Math.max(MIN_COL_CHANNEL, channelTrackCounts.get(i) ?? 0),
  );

  return {
    colStripWidths,
    channelColWidths,
    ...rowSize(ir, placements),
  };
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
