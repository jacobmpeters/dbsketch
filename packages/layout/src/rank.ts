import type { IR } from '@ascii-erd/parser';

// Assigns each entity to a col-strip via balanced layering. Spreads wide
// ranks across more cols to reduce canvas height. Constraints preserved:
// parent col < child col for every one-to-many ref. Self-FKs and cycles
// are tolerated — they don't constrain placement.
//
// Width target W is the *smaller* of two natural choices:
//   - ceil(N / longestPath): entities-per-col averaged over the depth.
//     Tends to under-fill wide-and-shallow schemas.
//   - ceil(sqrt(N)): aspect-ratio-balanced "square" target. Keeps star
//     schemas (one fact + many dims) from collapsing into a thin tall
//     diagram.
// Floor of 3 preserves hub-and-spoke groupings — three children of one
// parent stay in one col rather than getting split.
export function rank(ir: IR): Map<string, number> {
  const parents = buildParents(ir);
  const longestPath = computeLongestPath(ir, parents);
  const N = ir.entities.length;
  const byDepth = Math.ceil(N / Math.max(1, longestPath));
  const bySqrt = Math.ceil(Math.sqrt(N));
  const W = Math.max(3, Math.min(byDepth, bySqrt));
  return balancedLayering(ir, parents, W);
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
