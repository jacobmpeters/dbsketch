import type { Entity, IR } from '@dbsketch/parser';
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

// Barycenter Y-offset passes after greedy packing. Each pass walks every
// col-strip and pulls entities toward port-row alignment with their
// neighbors, then re-packs the col under order + min-gap constraints.
// Alternating direction (L→R then R→L) converges quickly; 4 passes is
// enough on schemas we've measured.
const BARYCENTER_PASSES = 4;

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
//
// After the greedy + centered pack, runs a barycenter Y-offset pass that
// pulls each entity toward port-row alignment with its neighbors — dissolves
// short V trunks that would otherwise produce confusing glyph fusion at the
// channel boundary. Ordering within col and min-gap constraints are
// preserved.
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

  const colHeights = computeColHeights(byCol, entityByName);
  let totalHeight = 0;
  for (const h of colHeights.values()) totalHeight = Math.max(totalHeight, h);

  // Greedy + centered initial pack.
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

  // Barycenter Y-offset pass: pull entities toward port-row alignment with
  // neighbors. May shift a col's entities up or down within its envelope
  // (and slightly past it, if PAVA's preferred Y demands). Total canvas
  // height after the pass is the max of (col's last entity bottom + 1).
  adjustYsByBarycenter(ir, placements, byCol, entityByName, ys);
  let adjustedTotalHeight = 0;
  for (const [, bucket] of byCol) {
    for (const p of bucket) {
      const entity = entityByName.get(p.entity);
      if (!entity) continue;
      const bottom = (ys.get(p.entity) ?? 0) + entityHeight(entity);
      adjustedTotalHeight = Math.max(adjustedTotalHeight, bottom);
    }
  }
  return { ys, totalHeight: Math.max(totalHeight, adjustedTotalHeight) };
}

function computeColHeights(
  byCol: Map<number, Placement[]>,
  entityByName: Map<string, Entity>,
): Map<number, number> {
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
  return colHeights;
}

// Adjust per-col Ys to pull each entity toward port-row alignment with
// neighbors in other cols. Iterates `BARYCENTER_PASSES` times, alternating
// direction (L→R then R→L) so each col's ideal sees the latest neighbor Ys.
// Within a col, order and min-gap-1 are preserved by PAVA-constrained
// packing.
//
// Iterative averaging will gradually shift the whole layout downward
// (each entity's ideal includes its neighbor's current Y, and rounding
// half-up biases the drift positive). To keep the canvas anchored, the
// last step normalizes so min Y = 0. This preserves relative alignment
// — which is all the barycenter cares about — while keeping the topmost
// entity flush with the top of the canvas.
function adjustYsByBarycenter(
  ir: IR,
  placements: Placement[],
  byCol: Map<number, Placement[]>,
  entityByName: Map<string, Entity>,
  ys: Map<string, number>,
): void {
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  if (cols.length <= 1) return;

  // Pre-index refs by entity so idealYFor is O(degree) instead of O(all-refs).
  // Mirrors the else-if logic in idealYFor: for a self-ref, only the parent
  // branch fires, so only one entry per self-ref is added.
  const refsByEntity = new Map<string, { thisCol: string; other: { entity: string; column: string } }[]>();
  const pushRef = (name: string, thisCol: string, other: { entity: string; column: string }) => {
    let list = refsByEntity.get(name);
    if (!list) { list = []; refsByEntity.set(name, list); }
    list.push({ thisCol, other });
  };
  for (const ref of ir.refs) {
    pushRef(ref.parent.entity, ref.parent.column, ref.child);
    if (ref.child.entity !== ref.parent.entity) {
      pushRef(ref.child.entity, ref.child.column, ref.parent);
    }
  }

  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    const order = pass % 2 === 0 ? cols : [...cols].reverse();
    for (const col of order) {
      repackColTowardIdeals(col, byCol, entityByName, refsByEntity, ys);
    }
  }

  let minY = Number.POSITIVE_INFINITY;
  for (const y of ys.values()) minY = Math.min(minY, y);
  if (minY > 0) {
    for (const [name, y] of ys) ys.set(name, y - minY);
  }
}

// PAVA-constrained 1D pack: given ideal Ys and entity heights in col order,
// returns Ys that (1) preserve order, (2) keep ≥1-cell gap, (3) stay ≥0,
// and (4) minimize sum (y_i - ideal_i)^2 under those constraints. Pool
// Adjacent Violators on the relative-target transform gives the L2-optimal
// monotone solution; rounding to integers happens at the end with a
// monotonicity re-check.
function pavaPack(ideals: number[], heights: number[]): number[] {
  const n = ideals.length;
  if (n === 0) return [];
  const targets: number[] = [];
  let cum = 0;
  for (let i = 0; i < n; i++) {
    targets.push(ideals[i]! - cum);
    cum += heights[i]! + STACK_GAP;
  }
  type Block = { start: number; count: number; sum: number };
  const blocks: Block[] = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ start: i, count: 1, sum: targets[i]! });
    while (blocks.length >= 2) {
      const b1 = blocks[blocks.length - 2]!;
      const b0 = blocks[blocks.length - 1]!;
      if (b1.sum / b1.count <= b0.sum / b0.count) break;
      blocks.pop();
      b1.count += b0.count;
      b1.sum += b0.sum;
    }
  }
  const z = new Array<number>(n);
  for (const b of blocks) {
    const avg = b.sum / b.count;
    for (let i = 0; i < b.count; i++) z[b.start + i] = avg;
  }
  const out = new Array<number>(n);
  let cum2 = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(0, Math.round(z[i]! + cum2));
    cum2 += heights[i]! + STACK_GAP;
  }
  for (let i = 1; i < n; i++) {
    const floor = out[i - 1]! + heights[i - 1]! + STACK_GAP;
    if (out[i]! < floor) out[i] = floor;
  }
  return out;
}

function repackColTowardIdeals(
  col: number,
  byCol: Map<number, Placement[]>,
  entityByName: Map<string, Entity>,
  refsByEntity: Map<string, { thisCol: string; other: { entity: string; column: string } }[]>,
  ys: Map<string, number>,
): void {
  const bucket = byCol.get(col);
  if (!bucket || bucket.length === 0) return;
  const heights: number[] = [];
  const ideals: number[] = [];
  for (const p of bucket) {
    const entity = entityByName.get(p.entity);
    if (!entity) {
      heights.push(0);
      ideals.push(ys.get(p.entity) ?? 0);
      continue;
    }
    heights.push(entityHeight(entity));
    const ideal = idealYFor(entity, refsByEntity, ys, entityByName);
    // Isolated entities (no edges) keep their current Y so they don't
    // drift from the centered baseline just because col-mates moved.
    ideals.push(ideal !== null ? ideal : (ys.get(p.entity) ?? 0));
  }
  const newYs = pavaPack(ideals, heights);
  for (let i = 0; i < bucket.length; i++) {
    ys.set(bucket[i]!.entity, newYs[i]!);
  }
}

// Mean of (neighbor.Y + neighbor.portRow − this.portRow) across all refs
// touching this entity. The target Y at which this entity's top would line
// up its FK ports with the corresponding ports on each neighbor. Returns
// null if the entity has no resolvable refs.
function idealYFor(
  entity: Entity,
  refsByEntity: Map<string, { thisCol: string; other: { entity: string; column: string } }[]>,
  ys: Map<string, number>,
  entityByName: Map<string, Entity>,
): number | null {
  let sum = 0;
  let count = 0;
  for (const { thisCol, other } of refsByEntity.get(entity.name) ?? []) {
    const thatY = ys.get(other.entity);
    if (thatY === undefined) continue;
    const thatEnt = entityByName.get(other.entity);
    if (!thatEnt) continue;
    const thisPort = portRow(entity, thisCol);
    const thatPort = portRow(thatEnt, other.column);
    if (thisPort === null || thatPort === null) continue;
    sum += thatY + thatPort - thisPort;
    count++;
  }
  if (count === 0) return null;
  return sum / count;
}

// Port row offset within an entity's box. 3 accounts for the top border,
// name row, and separator before the first column. Returns null for
// compact (zero-column) entities where every ref attaches at the name row.
function portRow(entity: Entity, column: string): number | null {
  if (entity.columns.length === 0) return 1;
  const idx = entity.columns.findIndex((c) => c.name === column);
  if (idx < 0) return null;
  return 3 + idx;
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
