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
// Passes alternate direction (left→right, then right→left) so position
// changes in one rank propagate to its neighbors in subsequent passes.
// Entities with no FK neighbors fall back to alphabetical ordering for
// determinism.
export function place(ir: IR, ranks: Map<string, number>): Placement[] {
  const byRank = groupByRank(ir, ranks);
  const positions = initialPositions(byRank);
  const adjacency = buildAdjacency(ir);

  const ranksList = [...byRank.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    const order = pass % 2 === 0 ? ranksList : [...ranksList].reverse();
    for (const r of order) {
      reorderRank(r, byRank, positions, adjacency);
    }
  }

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
): void {
  const inRank = byRank.get(rank);
  if (!inRank || inRank.length <= 1) return;

  const barycenters = new Map<string, number>();
  for (const name of inRank) {
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
    barycenters.set(name, count > 0 ? sum / count : (positions.get(name) ?? 0));
  }

  const reordered = [...inRank].sort((a, b) => {
    const diff = barycenters.get(a)! - barycenters.get(b)!;
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  reordered.forEach((name, i) => positions.set(name, i));
  byRank.set(rank, reordered);
}
