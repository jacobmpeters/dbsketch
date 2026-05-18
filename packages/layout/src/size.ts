import type { Entity, IR } from '@dbsketch/parser';
import type { Placement, StripSizing } from './types.js';

// Visual-separation floor for channels, applied before any routing demand.
// Without this, adjacent boxes would touch and the diagram becomes unreadable.
const MIN_COL_CHANNEL = 2;
const MIN_ROW_CHANNEL = 1;

export type RowSizing = Pick<StripSizing, 'rowStripHeights' | 'channelRowHeights'>;

// Row sizing depends on entity heights and (optionally) the row-channel track
// counts produced by multi-hop H2 packing. Both are knowable before col widths
// are finalized — col-channel track counts depend on absolute y, which depend
// on row sizing.
export function rowSize(
  ir: IR,
  placements: Placement[],
  rowChannelTrackCounts: Map<number, number> = new Map(),
): RowSizing {
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));
  const numRowStrips = placements.reduce((m, p) => Math.max(m, p.rowStrip + 1), 0);
  const rowStripHeights = new Array<number>(numRowStrips).fill(0);
  for (const p of placements) {
    const entity = entitiesByName.get(p.entity);
    if (!entity) continue;
    rowStripHeights[p.rowStrip] = Math.max(rowStripHeights[p.rowStrip]!, entityHeight(entity));
  }
  const channelRowHeights = Array.from({ length: Math.max(0, numRowStrips - 1) }, (_, i) =>
    Math.max(MIN_ROW_CHANNEL, rowChannelTrackCounts.get(i) ?? 0),
  );
  return { rowStripHeights, channelRowHeights };
}

export function size(
  ir: IR,
  placements: Placement[],
  channelTrackCounts: Map<number, number> = new Map(),
  rowChannelTrackCounts: Map<number, number> = new Map(),
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
    ...rowSize(ir, placements, rowChannelTrackCounts),
  };
}

// Box-drawn entity: │ <inner> │ where inner = max(name, max(col_name + ' ' + col_type)).
// Total width = inner + 4 (left border, space, content, space, right border).
// Empty col.type (used when --no-types strips them) skips the joining space.
function entityWidth(entity: Entity): number {
  let inner = entity.name.length;
  for (const col of entity.columns) {
    const contentLen = col.type ? col.name.length + 1 + col.type.length : col.name.length;
    inner = Math.max(inner, contentLen);
  }
  return inner + 4;
}

// Compact entities (columns stripped via showColumns:false) are 3 rows:
// top border, name, bottom border. No header separator since there's no
// body. Regular entities: top + header + separator + N column rows + bottom.
export function entityHeight(entity: Entity): number {
  if (entity.columns.length === 0) return 3;
  return 4 + entity.columns.length;
}
