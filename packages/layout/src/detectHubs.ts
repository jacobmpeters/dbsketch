import type { CenterHint, IR } from '@ascii-erd/parser';

// Hub auto-detection: find tables that look like layout centers (fact tables,
// junction tables with many incoming FKs, etc.) and emit synthetic @center
// hints. User-provided centers always take precedence and are returned
// unchanged; auto-detection only fills in entities the user hasn't already
// pinned with @col or @center.
//
// Metric: total degree (count of one-to-many refs the entity participates in,
// either as parent or child). Captures fact tables (high FK-out count) and
// referenced hubs (high in-count) with a single number.
// Threshold: degree >= 3 (absolute floor — anything less isn't a hub by any
// reasonable definition).
// Cap: K=3 hubs per IR (top-K by degree). The cap keeps later passes
// (hub permutation) brute-forceable and prevents low-signal hubs from
// fragmenting the layout. Combined with the floor, snowflake-style schemas
// pick up their regional hubs (each dim subtree's anchor) alongside the
// primary fact table.
//
// Returns the merged hints.centers array. If the user provided any
// @center hints, auto-detection is suppressed entirely — the user
// being explicit means they've thought about it. Otherwise, auto picks
// up to K=3 hubs by degree.
export function detectHubs(ir: IR): CenterHint[] {
  const userCenters = ir.hints.centers.filter((c) => c.source === 'user');
  if (userCenters.length > 0) return [...userCenters];

  const claimed = new Set<string>();
  for (const pin of ir.hints.pins) {
    if (pin.col !== null) claimed.add(pin.entity);
  }

  const degree = computeDegree(ir);
  const threshold = 3;
  const cap = 3;

  const candidates = ir.entities
    .map((e) => ({ entity: e.name, deg: degree.get(e.name) ?? 0 }))
    .filter((c) => c.deg >= threshold && !claimed.has(c.entity));

  // Sequential pick: first hub by degree desc (alpha tiebreak); subsequent
  // hubs prefer candidates closest to already-selected hubs. This favors
  // intermediate "fact-table-adjacent" entities over peripheral leaves
  // that happen to have the same degree — e.g., for snowflake at degree 3,
  // picks product_dim (1 hop from sales_fact) over country_dim (3 hops).
  const adj = buildUndirectedAdjLight(ir);
  const distFromSelected = new Map<string, number>();
  const selected: typeof candidates = [];

  while (selected.length < cap && candidates.length > selected.length) {
    let best: (typeof candidates)[0] | undefined;
    for (const c of candidates) {
      if (selected.some((s) => s.entity === c.entity)) continue;
      if (best === undefined) {
        best = c;
        continue;
      }
      if (selected.length > 0) {
        const cDist = distFromSelected.get(c.entity) ?? Number.POSITIVE_INFINITY;
        const bDist = distFromSelected.get(best.entity) ?? Number.POSITIVE_INFINITY;
        if (cDist !== bDist) {
          if (cDist < bDist) best = c;
          continue;
        }
      }
      if (c.deg !== best.deg) {
        if (c.deg > best.deg) best = c;
        continue;
      }
      if (c.entity.localeCompare(best.entity) < 0) best = c;
    }
    if (!best) break;
    selected.push(best);
    // Refresh distances from the newly added hub.
    const bfs = bfsDist(adj, best.entity);
    for (const [entity, d] of bfs) {
      const prev = distFromSelected.get(entity);
      if (prev === undefined || d < prev) distFromSelected.set(entity, d);
    }
  }

  return selected.map((c) => ({
    entity: c.entity,
    left: [],
    right: [],
    source: 'auto' as const,
  }));
}

function buildUndirectedAdjLight(ir: IR): Map<string, Set<string>> {
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

function bfsDist(adj: Map<string, Set<string>>, source: string): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(source, 0);
  const queue: string[] = [source];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const n of [...(adj.get(cur) ?? [])].sort()) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

function computeDegree(ir: IR): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of ir.entities) counts.set(e.name, 0);
  for (const ref of ir.refs) {
    if (ref.cardinality === 'many-to-many') continue;
    if (ref.parent.entity === ref.child.entity) continue;
    counts.set(ref.parent.entity, (counts.get(ref.parent.entity) ?? 0) + 1);
    counts.set(ref.child.entity, (counts.get(ref.child.entity) ?? 0) + 1);
  }
  return counts;
}
