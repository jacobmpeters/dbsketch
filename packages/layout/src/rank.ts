import type { CenterHint, IR } from '@dbsketch/parser';

// Assigns each entity to a col-strip. Two strategies:
//   - hub-distance ranking (when centers are provided): hubs sit in
//     center cols with related entities fanning out by FK distance.
//     For one hub, neighbors split between left and right; for multiple
//     hubs, a spine of hubs is interleaved with bridge cols for
//     entities equidistant to adjacent hubs.
//   - balanced layering (default, no centers): Sugiyama-style left-to-right
//     by FK direction with a width cap to control aspect ratio.
export function rank(ir: IR, centers: CenterHint[] = []): Map<string, number> {
  if (centers.length === 1) return hubDistanceRank(ir, centers[0]!);
  if (centers.length > 1) return multiHubRank(ir, centers);
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

// Multi-hub ranking: arrange hubs along a horizontal spine with bridge
// cols between adjacent hubs for shared neighbors. Each non-hub entity
// is either assigned to its closest hub (fans out exclusive of that hub)
// or, if equidistant to two adjacent hubs, lands in their bridge.
//
// Layout (3 hubs example):
//   [exclusive-L of H0] [H0] [bridge 0-1] [H1] [bridge 1-2] [H2] [exclusive-R of H2]
//
// Side rules:
//   - Entities assigned to leftmost hub  → its LEFT side (exclusive-L)
//   - Entities assigned to rightmost hub → its RIGHT side (exclusive-R)
//   - Middle-hub-exclusive entities go on the LEFT (joins previous bridge area).
//     This is a v1 simplification; middle hubs rarely have purely-exclusive
//     neighbors in practice (otherwise they wouldn't be midway between hubs).
//
// Bridge entity at depth d sits in col (leftHub.col + d) — snaps to the
// left hub. Asymmetric, but keeps the bridge width = max depth instead of
// 2 * max depth.
function multiHubRank(ir: IR, centers: CenterHint[]): Map<string, number> {
  const hubs = centers.map((c) => c.entity);
  const adj = buildUndirectedAdj(ir);

  const distByHub = new Map<string, Map<string, number>>();
  for (const hub of hubs) {
    distByHub.set(hub, bfsDistances(adj, hub));
  }

  const hubOrder = orderHubs(hubs, distByHub);
  const hubIndex = new Map(hubOrder.map((h, i) => [h, i]));
  const K = hubOrder.length;

  interface Assignment {
    hubIdx: number;
    depth: number;
    isBridge: boolean;
  }
  const assignments = new Map<string, Assignment>();
  for (const hub of hubOrder) {
    assignments.set(hub, { hubIdx: hubIndex.get(hub)!, depth: 0, isBridge: false });
  }

  for (const e of ir.entities) {
    if (assignments.has(e.name)) continue;
    let minDist = Number.POSITIVE_INFINITY;
    for (const hub of hubOrder) {
      const d = distByHub.get(hub)?.get(e.name);
      if (d !== undefined) minDist = Math.min(minDist, d);
    }
    if (!Number.isFinite(minDist)) continue;
    const closestIdxs: number[] = [];
    for (let i = 0; i < K; i++) {
      if (distByHub.get(hubOrder[i]!)?.get(e.name) === minDist) closestIdxs.push(i);
    }
    if (closestIdxs.length === 1) {
      assignments.set(e.name, { hubIdx: closestIdxs[0]!, depth: minDist, isBridge: false });
      continue;
    }
    // Multiple hubs equidistant — try bridge between adjacent pair.
    let bridgeLeft = -1;
    for (let i = 0; i < K - 1; i++) {
      if (closestIdxs.includes(i) && closestIdxs.includes(i + 1)) {
        bridgeLeft = i;
        break;
      }
    }
    if (bridgeLeft !== -1) {
      assignments.set(e.name, { hubIdx: bridgeLeft, depth: minDist, isBridge: true });
    } else {
      // Equidistant to non-adjacent hubs (rare). Pick alphabetical hub.
      const pickIdx = closestIdxs.sort((a, b) => hubOrder[a]!.localeCompare(hubOrder[b]!))[0]!;
      assignments.set(e.name, { hubIdx: pickIdx, depth: minDist, isBridge: false });
    }
  }

  // Layout dimensions
  const leftDepth = new Array<number>(K).fill(0); // exclusive depth on a hub's LEFT
  const rightDepth = new Array<number>(K).fill(0); // exclusive depth on a hub's RIGHT
  const bridgeDepth = new Array<number>(Math.max(0, K - 1)).fill(0);

  for (const [, a] of assignments) {
    if (a.depth === 0) continue;
    if (a.isBridge) {
      bridgeDepth[a.hubIdx] = Math.max(bridgeDepth[a.hubIdx]!, a.depth);
      continue;
    }
    if (a.hubIdx === 0) leftDepth[0] = Math.max(leftDepth[0]!, a.depth);
    else if (a.hubIdx === K - 1) rightDepth[K - 1] = Math.max(rightDepth[K - 1]!, a.depth);
    else leftDepth[a.hubIdx] = Math.max(leftDepth[a.hubIdx]!, a.depth);
  }

  const hubCol = new Array<number>(K).fill(0);
  hubCol[0] = leftDepth[0]!;
  for (let i = 1; i < K; i++) {
    // Space between hub i-1 and hub i must hold both the bridge and any
    // left-exclusive entities of hub i (middle-hub case). Both share cols
    // adjacent to each other; reserve enough room for the larger.
    const gap = Math.max(bridgeDepth[i - 1]!, leftDepth[i] ?? 0);
    hubCol[i] = hubCol[i - 1]! + gap + 1;
  }

  const cols = new Map<string, number>();
  for (const [name, a] of assignments) {
    if (a.depth === 0) {
      cols.set(name, hubCol[a.hubIdx]!);
      continue;
    }
    if (a.isBridge) {
      cols.set(name, hubCol[a.hubIdx]! + a.depth);
      continue;
    }
    if (a.hubIdx === 0) {
      cols.set(name, hubCol[0]! - a.depth);
    } else if (a.hubIdx === K - 1) {
      cols.set(name, hubCol[a.hubIdx]! + a.depth);
    } else {
      cols.set(name, hubCol[a.hubIdx]! - a.depth);
    }
  }

  // Unreachable entities → cols after the rightmost.
  let nextCol = (hubCol[K - 1] ?? 0) + (rightDepth[K - 1] ?? 0) + 1;
  const unreachable = ir.entities
    .map((e) => e.name)
    .filter((n) => !cols.has(n))
    .sort();
  for (const n of unreachable) {
    cols.set(n, nextCol);
    nextCol++;
  }

  // Normalize so smallest col is 0 (some configurations leave gaps).
  let minCol = Number.POSITIVE_INFINITY;
  for (const c of cols.values()) minCol = Math.min(minCol, c);
  if (Number.isFinite(minCol) && minCol > 0) {
    for (const [k, v] of cols) cols.set(k, v - minCol);
  }

  return cols;
}

function bfsDistances(adj: Map<string, Set<string>>, source: string): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(source, 0);
  const queue: string[] = [source];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    const neighbors = [...(adj.get(cur) ?? [])].sort();
    for (const n of neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

// Pick the hub permutation that maximizes the total count of entities
// equidistant to adjacent hub pairs (i.e., bridge density). Ties broken
// by lexicographic order on the hub-name tuple for determinism.
//
// K up to 3 → 6 permutations, brute-forced. If K grows we'd need a
// heuristic (barycenter-style), but the cap on hubs keeps us here.
function orderHubs(hubs: string[], distByHub: Map<string, Map<string, number>>): string[] {
  if (hubs.length <= 1) return [...hubs];
  let best: string[] = [...hubs].sort();
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const order of permutations(best)) {
    let score = 0;
    for (let i = 0; i < order.length - 1; i++) {
      const dA = distByHub.get(order[i]!)!;
      const dB = distByHub.get(order[i + 1]!)!;
      for (const [entity, da] of dA) {
        const db = dB.get(entity);
        if (db !== undefined && da === db && da > 0) score++;
      }
    }
    if (score > bestScore || (score === bestScore && lexLess(order, best))) {
      best = order;
      bestScore = score;
    }
  }
  return best;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const sub of permutations(rest)) {
      result.push([items[i]!, ...sub]);
    }
  }
  return result;
}

function lexLess(a: string[], b: string[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = a[i]!.localeCompare(b[i]!);
    if (c !== 0) return c < 0;
  }
  return a.length < b.length;
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
