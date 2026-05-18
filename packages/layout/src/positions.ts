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

// Per-col vertical stacking: each col independently packs its entities from
// the top, with a single-row gap between them. Canvas height becomes the
// max-col-cumulative-height rather than sum-of-row-strip-heights.
//
// This breaks the "row index R is at the same y in every col" invariant.
// Same-row cross-col edges that used to be straight now bend by the height
// difference between earlier entities in each col. The win: tall entities
// (fact tables) no longer make every other col waste vertical space.
const STACK_GAP = 1;

export function computeEntityPositions(
  ir: IR,
  placements: Placement[],
  sizing: StripSizing,
  topMarginHeight: number,
): EntityPositions {
  const positions: EntityPositions = new Map();
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));

  // Group by col, sorted within col by row index (preserves the placement
  // order that pins and barycenter chose).
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

  // Entities start below the top margin (which holds multi-hop H2 routing
  // tracks). If no multi-hops, the margin is 0 and entities start at y=0.
  const yBase = topMarginHeight > 0 ? topMarginHeight + TOP_MARGIN_GAP : 0;

  for (const [col, colPlacements] of byCol) {
    const x = stripOffset(sizing.colStripWidths, sizing.channelColWidths, col);
    const width = sizing.colStripWidths[col] ?? 0;
    let y = yBase;
    for (const p of colPlacements) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      const height = entityHeight(entity);
      positions.set(p.entity, { x, y, width, height });
      y += height + STACK_GAP;
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

// Per-col-stacked Y position of each entity, ignoring top margin (so the
// values are relative). Routing uses this for V-interval packing so track
// assignment reflects the actual rendered Y positions rather than the
// strip-derived approximation (which inflates intervals when entities
// stack tighter than the row-strip layout assumed).
export function relativeEntityYs(ir: IR, placements: Placement[]): Map<string, number> {
  const ys = new Map<string, number>();
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
    let y = 0;
    for (const p of bucket) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      ys.set(p.entity, y);
      y += entityHeight(entity) + STACK_GAP;
    }
  }
  return ys;
}
