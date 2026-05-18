import type { IR } from '@dbsketch/parser';
import { entityHeight } from './size.js';
import type { Placement, StripSizing } from './types.js';

// Absolute position and dimensions of an entity box on the canvas.
export interface EntityBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EntityPositions = Map<string, EntityBox>;

// Vertical gap between the top margin (where multi-hop H2 segments route)
// and the first row of entity boxes.
const TOP_MARGIN_GAP = 1;

// First absolute Y where entity content starts. Equals topMarginHeight +
// TOP_MARGIN_GAP when there's a top margin; 0 otherwise. Exposed so the
// route stage can convert relative spine Y values to absolute Y at
// materialization time.
export function entityYBase(topMarginHeight: number): number {
  return topMarginHeight > 0 ? topMarginHeight + TOP_MARGIN_GAP : 0;
}

// Per-col vertical stacking: each col independently packs its entities with a
// single-row gap between them. Canvas height = the tallest column. Shorter
// columns are vertically centered within that height, so hub-style entities
// that occupy short columns sit mid-diagram rather than at the top — edges
// fan out symmetrically up and down rather than always descending.
//
// This breaks the "row index R is at the same y in every col" invariant.
// Same-row cross-col edges that used to be straight bend by the height
// difference between cols. The win: tall entities (fact tables) no longer
// make every other col waste vertical space, AND hubs are visually central.
const STACK_GAP = 1;

// Per-col Y assignment. Each column packs its entities tightly with one-row
// gaps; columns shorter than the tallest are centered vertically within the
// max-col-height envelope. Returns the Y of every entity in canvas-wide
// coordinates (still excluding any top margin — callers add that). Used by
// both relativeEntityYs (routing) and computeEntityPositions (rendering) so
// the two stay in lockstep.
function assignColumnYs(
  ir: IR,
  placements: Placement[],
): { ys: Map<string, number>; totalHeight: number } {
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));
  const byCol = new Map<number, Placement[]>();
  for (const p of placements) {
    let bucket = byCol.get(p.colStrip);
    if (!bucket) {
      bucket = [];
      byCol.set(p.colStrip, bucket);
    }
    bucket.push(p);
  }
  for (const bucket of byCol.values()) {
    bucket.sort((a, b) => a.rowStrip - b.rowStrip);
  }

  // First pass: compute each column's stacked height (entities + gaps,
  // trailing gap trimmed).
  const colHeights = new Map<number, number>();
  for (const [col, bucket] of byCol) {
    let h = 0;
    for (const p of bucket) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      h += entityHeight(entity) + STACK_GAP;
    }
    if (h > 0) h -= STACK_GAP;
    colHeights.set(col, h);
  }
  let totalHeight = 0;
  for (const h of colHeights.values()) totalHeight = Math.max(totalHeight, h);

  // Second pass: assign Y per entity with each column centered within
  // totalHeight. Floor the offset so coordinates stay integer-aligned.
  const ys = new Map<string, number>();
  for (const [col, bucket] of byCol) {
    const colH = colHeights.get(col) ?? 0;
    const offset = Math.floor((totalHeight - colH) / 2);
    let y = offset;
    for (const p of bucket) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      ys.set(p.entity, y);
      y += entityHeight(entity) + STACK_GAP;
    }
  }
  return { ys, totalHeight };
}

export function computeEntityPositions(
  ir: IR,
  placements: Placement[],
  sizing: StripSizing,
  topMarginHeight: number,
): EntityPositions {
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));
  const { ys } = assignColumnYs(ir, placements);
  const yBase = entityYBase(topMarginHeight);

  const positions: EntityPositions = new Map();
  // Group by col to fetch x/width once per col.
  const byCol = groupByCol(placements);
  for (const [col, colPlacements] of byCol) {
    const x = stripOffset(sizing.colStripWidths, sizing.channelColWidths, col);
    const width = sizing.colStripWidths[col] ?? 0;
    for (const p of colPlacements) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      const y = (ys.get(p.entity) ?? 0) + yBase;
      positions.set(p.entity, { x, y, width, height: entityHeight(entity) });
    }
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

function groupByCol(placements: Placement[]): Map<number, Placement[]> {
  const byCol = new Map<number, Placement[]>();
  for (const p of placements) {
    let bucket = byCol.get(p.colStrip);
    if (!bucket) {
      bucket = [];
      byCol.set(p.colStrip, bucket);
    }
    bucket.push(p);
  }
  for (const bucket of byCol.values()) {
    bucket.sort((a, b) => a.rowStrip - b.rowStrip);
  }
  return byCol;
}

// Per-col-stacked Y position of each entity in canvas-wide coordinates,
// excluding top margin. Routing uses this for V-interval packing so track
// assignment reflects what the renderer will actually produce — including
// the per-col centering offsets that make shorter columns sit mid-canvas.
export function relativeEntityYs(ir: IR, placements: Placement[]): Map<string, number> {
  return assignColumnYs(ir, placements).ys;
}
