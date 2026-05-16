import type { IR } from '@dbsketch/parser';
import type { Placement } from './types.js';

// Sugiyama-style crossing minimization typically converges in 2-3 iterations
// of forward + backward sweeps. Four covers most real schemas comfortably.
const BARYCENTER_PASSES = 4;

// Each link records which row of the neighbor's box the edge attaches to,
// so siblings that share a single neighbor can be ordered by where they
// connect on that neighbor (instead of all computing the same bary value
// and tie-breaking alphabetically).
interface NeighborLink {
  neighbor: string;
  // 3 + columnIndex on the neighbor's side (3 accounts for the box's top
  // border, name, and separator rows).
  portRowOnNeighbor: number;
  // Total height of the neighbor entity in cells (4 borders + columns).
  // Used to normalize portRowOnNeighbor into a sub-1 tiebreaker.
  neighborHeight: number;
}

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
// barycenter. Each link records the port row on the neighbor's side so star-
// schema siblings (all sharing a single fact-table neighbor) can be ordered
// by where on the fact they attach, rather than ending up with identical
// barycenters and tie-breaking alphabetically. Includes refs the router
// can't route (multi-hop, many-to-many) because they still represent
// semantic connections worth honoring in placement.
function buildAdjacency(ir: IR): Map<string, NeighborLink[]> {
  const adj = new Map<string, NeighborLink[]>();
  for (const e of ir.entities) adj.set(e.name, []);
  const heightOf = new Map(ir.entities.map((e) => [e.name, 4 + e.columns.length]));
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));
  const colIdx = (entity: string, column: string): number => {
    const ent = entityByName.get(entity);
    return ent ? ent.columns.findIndex((c) => c.name === column) : -1;
  };
  for (const ref of ir.refs) {
    const pIdx = colIdx(ref.parent.entity, ref.parent.column);
    const cIdx = colIdx(ref.child.entity, ref.child.column);
    if (pIdx < 0 || cIdx < 0) continue;
    const pHeight = heightOf.get(ref.parent.entity) ?? 4;
    const cHeight = heightOf.get(ref.child.entity) ?? 4;
    adj.get(ref.parent.entity)?.push({
      neighbor: ref.child.entity,
      portRowOnNeighbor: 3 + cIdx,
      neighborHeight: cHeight,
    });
    adj.get(ref.child.entity)?.push({
      neighbor: ref.parent.entity,
      portRowOnNeighbor: 3 + pIdx,
      neighborHeight: pHeight,
    });
  }
  return adj;
}

function reorderRank(
  rank: number,
  byRank: Map<number, string[]>,
  positions: Map<string, number>,
  adjacency: Map<string, NeighborLink[]>,
  pinnedRows: Map<string, number>,
): void {
  const inRank = byRank.get(rank);
  if (!inRank || inRank.length <= 1) return;

  // Pinned entities keep their pinned position. Non-pinned entities sort by
  // barycenter and fill the remaining rows in order, skipping pinned rows.
  const nonPinned = inRank.filter((n) => !pinnedRows.has(n));
  if (nonPinned.length === 0) return;

  const barys = computeBarycenters(nonPinned, positions, adjacency, { usePort: false });
  // Port-row mean: which row of the neighbor each sibling attaches to,
  // averaged across edges. Used as a tiebreaker when raw barys collide
  // (the star-schema case where N dims all share one fact neighbor at
  // one position). Doesn't disturb the integer-aligning behavior of the
  // primary bary value.
  const portTie = computePortRowMeans(nonPinned, positions, adjacency);
  const reordered = [...nonPinned].sort((a, b) => {
    const diff = barys.get(a)! - barys.get(b)!;
    if (diff !== 0) return diff;
    const portDiff = portTie.get(a)! - portTie.get(b)!;
    if (portDiff !== 0) return portDiff;
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
  adjacency: Map<string, NeighborLink[]>,
  pinnedRows: Map<string, number>,
): void {
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  for (const rank of ranks) {
    const entities = byRank.get(rank);
    if (!entities || entities.length !== 1) continue;
    const name = entities[0]!;
    if (pinnedRows.has(name)) continue;
    // Port-row contribution is omitted here — float wants the unbiased
    // integer position, not the sibling-ordering tiebreaker.
    const bary = computeBarycenters([name], positions, adjacency, { usePort: false }).get(name)!;
    positions.set(name, Math.max(0, Math.round(bary)));
  }
}

function computeBarycenters(
  entities: string[],
  positions: Map<string, number>,
  adjacency: Map<string, NeighborLink[]>,
  options: { usePort: boolean },
): Map<string, number> {
  const barys = new Map<string, number>();
  for (const name of entities) {
    const links = adjacency.get(name) ?? [];
    let sum = 0;
    let count = 0;
    for (const link of links) {
      const pos = positions.get(link.neighbor);
      if (pos === undefined) continue;
      const portContribution = options.usePort ? link.portRowOnNeighbor / link.neighborHeight : 0;
      sum += pos + portContribution;
      count++;
    }
    // Isolated entities keep their current position so they don't drift.
    barys.set(name, count > 0 ? sum / count : (positions.get(name) ?? 0));
  }
  return barys;
}

// Average port-row-on-neighbor across an entity's edges. Used purely as a
// sort tiebreaker — siblings whose only neighbor is the same fact table at
// the same row position get differentiated by which row of the fact they
// attach to (e.g., date_dim attaches to fact's date_id row 4, while
// currency_dim attaches to fact's currency_id row 10).
//
// Entities with no edges return +Infinity so they fall through to the
// alphabetical tiebreaker rather than competing with edge-having siblings
// on a meaningless port value.
function computePortRowMeans(
  entities: string[],
  positions: Map<string, number>,
  adjacency: Map<string, NeighborLink[]>,
): Map<string, number> {
  const means = new Map<string, number>();
  for (const name of entities) {
    const links = adjacency.get(name) ?? [];
    let sum = 0;
    let count = 0;
    for (const link of links) {
      if (positions.get(link.neighbor) === undefined) continue;
      sum += link.portRowOnNeighbor;
      count++;
    }
    means.set(name, count > 0 ? sum / count : Number.POSITIVE_INFINITY);
  }
  return means;
}
