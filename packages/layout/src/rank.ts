import type { CenterHint, IR } from '@ascii-erd/parser';

// Assigns each entity to a col-strip. Two strategies:
//   - hub-distance ranking (when centers are provided): the hub sits in a
//     center col with related entities fanning out on both sides by FK
//     distance. Breaks the parent-left invariant intentionally.
//   - balanced layering (default): Sugiyama-style left-to-right by FK
//     direction with a width cap to control aspect ratio.
//
// For Phase 2 only single-hub centering is wired up; multiple centers
// fall back to balanced layering (multi-hub is Phase 4).
export function rank(ir: IR, centers: CenterHint[] = []): Map<string, number> {
  if (centers.length === 1) return hubDistanceRank(ir, centers[0]!);
  return balancedRank(ir);
}

// Width target W is the *smaller* of two natural choices:
//   - ceil(N / longestPath): entities-per-col averaged over the depth.
//     Tends to under-fill wide-and-shallow schemas.
//   - ceil(sqrt(N)): aspect-ratio-balanced "square" target. Keeps star
//     schemas (one fact + many dims) from collapsing into a thin tall
//     diagram.
// Floor of 3 preserves hub-and-spoke groupings — three children of one
// parent stay in one col rather than getting split.
function balancedRank(ir: IR): Map<string, number> {
  const parents = buildParents(ir);
  const longestPath = computeLongestPath(ir, parents);
  const N = ir.entities.length;
  const byDepth = Math.ceil(N / Math.max(1, longestPath));
  const bySqrt = Math.ceil(Math.sqrt(N));
  const W = Math.max(3, Math.min(byDepth, bySqrt));
  return balancedLayering(ir, parents, W);
}

// Hub-distance ranking: BFS undirected FK graph from the hub. Each entity
// gets (distance, side). Direct neighbors split alphabetically between
// left/right unless the center hint pre-assigns specific entities; further
// neighbors inherit the side of their BFS predecessor. Col = hubCol +
// side * distance, where hubCol = max left-side distance so col indices
// stay non-negative.
//
// Unreachable entities (no FK path to hub) get cols after the rightmost,
// in alphabetical order. Rare in practice but keeps the function total.
function hubDistanceRank(ir: IR, center: CenterHint): Map<string, number> {
  const adj = buildUndirectedAdj(ir);
  const hub = center.entity;

  const dist = new Map<string, number>();
  const bfsParent = new Map<string, string>();
  dist.set(hub, 0);
  const queue: string[] = [hub];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    const neighbors = [...(adj.get(cur) ?? [])].sort();
    for (const n of neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      bfsParent.set(n, cur);
      queue.push(n);
    }
  }

  // Side: -1 left, 0 hub, +1 right. Pre-assigned (user bias) first, then
  // remaining direct neighbors balanced alphabetically to even the counts.
  const side = new Map<string, number>();
  side.set(hub, 0);
  const leftSet = new Set(center.left);
  const rightSet = new Set(center.right);
  const directNeighbors = [...(adj.get(hub) ?? [])].sort();
  let leftCount = leftSet.size;
  let rightCount = rightSet.size;
  for (const n of directNeighbors) {
    if (leftSet.has(n) || rightSet.has(n)) continue;
    if (leftCount <= rightCount) {
      leftSet.add(n);
      leftCount++;
    } else {
      rightSet.add(n);
      rightCount++;
    }
  }
  for (const n of leftSet) side.set(n, -1);
  for (const n of rightSet) side.set(n, +1);

  // Indirect neighbors inherit side from their BFS ancestor at distance 1.
  for (const e of ir.entities) {
    if (side.has(e.name)) continue;
    if (!dist.has(e.name)) continue;
    let cur: string | undefined = e.name;
    while (cur !== undefined && side.get(cur) === undefined) {
      cur = bfsParent.get(cur);
    }
    if (cur !== undefined) {
      const s = side.get(cur)!;
      side.set(e.name, s === 0 ? +1 : s);
    }
  }

  let leftDepth = 0;
  let rightDepth = 0;
  for (const [name, d] of dist) {
    const s = side.get(name) ?? 0;
    if (s < 0) leftDepth = Math.max(leftDepth, d);
    else if (s > 0) rightDepth = Math.max(rightDepth, d);
  }

  const hubCol = leftDepth;
  const cols = new Map<string, number>();
  for (const [name, d] of dist) {
    const s = side.get(name) ?? 0;
    cols.set(name, hubCol + s * d);
  }

  let nextCol = hubCol + rightDepth + 1;
  const unreachable = ir.entities
    .map((e) => e.name)
    .filter((n) => !cols.has(n))
    .sort();
  for (const n of unreachable) {
    cols.set(n, nextCol);
    nextCol++;
  }

  return cols;
}

function buildUndirectedAdj(ir: IR): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of ir.entities) adj.set(e.name, new Set());
  for (const ref of ir.refs) {
    if (ref.cardinality === 'many-to-many') continue;
    if (ref.parent.entity === ref.child.entity) continue;
    adj.get(ref.parent.entity)?.add(ref.child.entity);
    adj.get(ref.child.entity)?.add(ref.parent.entity);
  }
  return adj;
}

// child entity → set of parent entities (via one-to-many). Symmetric refs
// don't impose direction so they don't constrain col placement.
function buildParents(ir: IR): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>();
  for (const e of ir.entities) parents.set(e.name, new Set());
  for (const ref of ir.refs) {
    if (ref.cardinality !== 'one-to-many') continue;
    parents.get(ref.child.entity)?.add(ref.parent.entity);
  }
  return parents;
}

// Longest path from any root to any entity. Cycle-safe: nodes currently in
// the recursion stack contribute depth 0.
function computeLongestPath(ir: IR, parents: Map<string, Set<string>>): number {
  const memo = new Map<string, number>();

  function depth(name: string, visiting: Set<string>): number {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return 0;
    visiting.add(name);
    let d = 0;
    for (const parent of parents.get(name) ?? []) {
      if (parent === name) continue;
      d = Math.max(d, depth(parent, visiting) + 1);
    }
    visiting.delete(name);
    memo.set(name, d);
    return d;
  }

  let max = 0;
  for (const e of ir.entities) max = Math.max(max, depth(e.name, new Set()));
  return max + 1;
}

// Place entities in topological order. For each, the minimum col is one
// past the maximum already-placed parent col. Push to later col if the
// minimum col is already at the width limit.
function balancedLayering(
  ir: IR,
  parents: Map<string, Set<string>>,
  W: number,
): Map<string, number> {
  const topo = topologicalSort(ir, parents);
  const cols = new Map<string, number>();
  const sizes: number[] = [];

  for (const name of topo) {
    let minCol = 0;
    for (const parent of parents.get(name) ?? []) {
      if (parent === name) continue;
      const pc = cols.get(parent);
      if (pc !== undefined) minCol = Math.max(minCol, pc + 1);
    }
    let target = minCol;
    while ((sizes[target] ?? 0) >= W) target++;
    cols.set(name, target);
    sizes[target] = (sizes[target] ?? 0) + 1;
  }

  return cols;
}

function topologicalSort(ir: IR, parents: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const alpha = ir.entities.map((e) => e.name).sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    for (const p of parents.get(name) ?? []) {
      if (p !== name) visit(p);
    }
    result.push(name);
  }

  for (const name of alpha) visit(name);
  return result;
}
