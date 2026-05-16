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
// Threshold: degree >= max(3, ceil(sqrt(N))) where N = entity count.
// Cap: K=3 hubs per IR (top-K by degree). The cap keeps later passes
// (hub permutation) brute-forceable and prevents low-signal hubs from
// fragmenting the layout.
//
// Returns the merged hints.centers array — user entries first, then auto
// entries that don't conflict with user centers or with @col pins.
export function detectHubs(ir: IR): CenterHint[] {
  const merged: CenterHint[] = [...ir.hints.centers];
  const claimed = new Set(merged.map((c) => c.entity));
  for (const pin of ir.hints.pins) {
    if (pin.col !== null) claimed.add(pin.entity);
  }

  const degree = computeDegree(ir);
  const n = ir.entities.length;
  const threshold = Math.max(3, Math.ceil(Math.sqrt(n)));
  const cap = 3;

  const candidates = ir.entities
    .map((e) => ({ entity: e.name, deg: degree.get(e.name) ?? 0 }))
    .filter((c) => c.deg >= threshold && !claimed.has(c.entity))
    .sort((a, b) => {
      if (b.deg !== a.deg) return b.deg - a.deg;
      // Stable secondary sort by name keeps detection deterministic across
      // platforms (Map iteration order vs entity declaration order can differ
      // in subtle ways, and snapshot tests must be byte-identical).
      return a.entity.localeCompare(b.entity);
    });

  const autoSlots = cap - merged.filter((c) => c.source === 'auto').length;
  for (const cand of candidates.slice(0, autoSlots)) {
    merged.push({ entity: cand.entity, left: [], right: [], source: 'auto' });
  }
  return merged;
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
