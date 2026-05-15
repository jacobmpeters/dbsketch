import type { IR } from '@ascii-erd/parser';

// Rank = longest path from a root in the parent→child DAG built from
// one-to-many refs. Symmetric refs (one-to-one, many-to-many) don't impose
// direction and are ignored. Cycles are broken by treating the first
// already-visiting node as depth 0.
export function rank(ir: IR): Map<string, number> {
  const incoming = new Map<string, Set<string>>();
  for (const entity of ir.entities) incoming.set(entity.name, new Set());

  for (const ref of ir.refs) {
    if (ref.cardinality !== 'one-to-many') continue;
    const set = incoming.get(ref.child.entity);
    if (set) set.add(ref.parent.entity);
  }

  const memo = new Map<string, number>();
  for (const entity of ir.entities) {
    depthFromRoots(entity.name, incoming, memo, new Set());
  }
  return memo;
}

function depthFromRoots(
  name: string,
  incoming: Map<string, Set<string>>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = memo.get(name);
  if (cached !== undefined) return cached;
  if (visiting.has(name)) return 0;

  visiting.add(name);
  let depth = 0;
  for (const parent of incoming.get(name) ?? []) {
    depth = Math.max(depth, depthFromRoots(parent, incoming, memo, visiting) + 1);
  }
  visiting.delete(name);

  memo.set(name, depth);
  return depth;
}
