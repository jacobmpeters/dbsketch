import type { IR } from '@ascii-erd/parser';
import type { Placement } from './types.js';

// Sugiyama-style crossing minimization typically converges in 2-3 iterations
// of forward + backward sweeps. Four covers most real schemas comfortably.
const BARYCENTER_PASSES = 4;

// Place each entity at (rank, row-within-rank). Within each rank, entities are
// ordered by barycenter — the mean row position of their FK neighbors — so
// connected entities cluster together. This translates directly to fewer edge
// crossings, shorter routing tracks, and more straight (no-bend) edges.
//
// `pinnedRows` overrides positions for specific entities. Pinned entities go
// to their pinned row; non-pinned entities sort by barycenter (which sees
// the pinned positions) and get assigned to remaining rows in order.
export function place(
  ir: IR,
  ranks: Map<string, number>,
  pinnedRows: Map<string, number> = new Map(),
): Placement[] {
  const byRank = groupByRank(ir, ranks);
  const positions = initialPositions(byRank);
  const adjacency = buildAdjacency(ir);

  // Apply pinned rows up front so barycenter sees them as fixed.
  for (const [name, row] of pinnedRows) {
    positions.set(name, row);
  }

  const ranksList = [...byRank.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    const order = pass % 2 === 0 ? ranksList : [...ranksList].reverse();
    for (const r of order) {
      reorderRank(r, byRank, positions, adjacency, pinnedRows);
    }
  }

  // Float each rank's entities to cluster around their average barycenter.
  // Pinned entities skip floating — their position is already fixed.
  floatPositions(byRank, positions, adjacency, pinnedRows);

  return ir.entities
    .map((e) => ({
      entity: e.name,
      colStrip: ranks.get(e.name) ?? 0,
      rowStrip: positions.get(e.name) ?? 0,
    }))
    .sort((a, b) => {
      if (a.colStrip !== b.colStrip) return a.colStrip - b.colStrip;
      if (a.rowStrip !== b.rowStrip) return a.rowStrip - b.rowStrip;
      return a.entity.localeCompare(b.entity);
    });
}

function groupByRank(ir: IR, ranks: Map<string, number>): Map<number, string[]> {
  const byRank = new Map<number, string[]>();
  for (const e of ir.entities) {
    const r = ranks.get(e.name) ?? 0;
    let bucket = byRank.get(r);
    if (!bucket) {
      bucket = [];
      byRank.set(r, bucket);
    }
    bucket.push(e.name);
  }
  // Alphabetical within rank gives a stable initial state — barycenter then
  // refines from there, falling back to this order on ties.
  for (const bucket of byRank.values()) bucket.sort();
  return byRank;
}

function initialPositions(byRank: Map<number, string[]>): Map<string, number> {
  const positions = new Map<string, number>();
  for (const bucket of byRank.values()) {
    bucket.forEach((name, i) => positions.set(name, i));
  }
  return positions;
}

// Adjacency is undirected — both parent→child and child→parent contribute to
// barycenter. Includes refs the router can't currently route (multi-hop,
// many-to-many) because they still represent semantic connections worth
// honoring in placement.
function buildAdjacency(ir: IR): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of ir.entities) adj.set(e.name, new Set());
  for (const ref of ir.refs) {
    adj.get(ref.parent.entity)?.add(ref.child.entity);
    adj.get(ref.child.entity)?.add(ref.parent.entity);
  }
  return adj;
}

function reorderRank(
  rank: number,
  byRank: Map<number, string[]>,
  positions: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  pinnedRows: Map<string, number>,
): void {
  const inRank = byRank.get(rank);
  if (!inRank || inRank.length <= 1) return;

  // Pinned entities keep their pinned position. Non-pinned entities sort by
  // barycenter and fill the remaining rows in order, skipping pinned rows.
  const nonPinned = inRank.filter((n) => !pinnedRows.has(n));
  if (nonPinned.length === 0) return;

  const barys = computeBarycenters(nonPinned, positions, adjacency);
  const reordered = [...nonPinned].sort((a, b) => {
    const diff = barys.get(a)! - barys.get(b)!;
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  const usedRows = new Set<number>();
  for (const name of inRank) {
    if (pinnedRows.has(name)) usedRows.add(pinnedRows.get(name)!);
  }
  let nextRow = 0;
  for (const name of reordered) {
    while (usedRows.has(nextRow)) nextRow++;
    positions.set(name, nextRow);
    nextRow++;
  }

  // Refresh the bucket order to match new positions (pinned + non-pinned by row).
  byRank.set(
    rank,
    [...inRank].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0)),
  );
}

// One-shot float pass after barycenter sweeps. Restricted to single-entity
// ranks: those are the cases where the default "row 0 always" placement is
// most clearly wrong (think: a fact table at the top with 30 lines of empty
// space below it). Multi-entity ranks are left alone — full floating tends
// to spread well-grouped entities apart and create new orphans.
//
// Pinned entities skip the float — their position is already fixed.
//
// Processed in rank order so later ranks see the updated positions of any
// earlier single-entity ranks that floated.
function floatPositions(
  byRank: Map<number, string[]>,
  positions: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  pinnedRows: Map<string, number>,
): void {
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const rank of ranks) {
    const entities = byRank.get(rank);
    if (!entities || entities.length !== 1) continue;
    const name = entities[0]!;
    if (pinnedRows.has(name)) continue;
    const bary = computeBarycenters(entities, positions, adjacency).get(name)!;
    positions.set(name, Math.max(0, Math.round(bary)));
  }
}

function computeBarycenters(
  entities: string[],
  positions: Map<string, number>,
  adjacency: Map<string, Set<string>>,
): Map<string, number> {
  const barys = new Map<string, number>();
  for (const name of entities) {
    const neighbors = adjacency.get(name) ?? new Set<string>();
    let sum = 0;
    let count = 0;
    for (const neighbor of neighbors) {
      const pos = positions.get(neighbor);
      if (pos !== undefined) {
        sum += pos;
        count++;
      }
    }
    // Isolated entities keep their current position so they don't drift.
    barys.set(name, count > 0 ? sum / count : (positions.get(name) ?? 0));
  }
  return barys;
}
