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
// Auto cap: 1 hub. Single-hub centering is a clear win across schema shapes;
// multi-hub layouts are wider and only help when the schema has genuinely
// distinct subtrees, so they're opt-in via explicit @center hints rather
// than auto-emitted. The ranker still handles multi-hub when the user
// provides 2+ centers — only the detector is conservative.
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
  const cap = 1;

  const candidates = ir.entities
    .map((e) => ({ entity: e.name, deg: degree.get(e.name) ?? 0 }))
    .filter((c) => c.deg >= threshold && !claimed.has(c.entity))
    .sort((a, b) => {
      if (b.deg !== a.deg) return b.deg - a.deg;
      return a.entity.localeCompare(b.entity);
    });

  return candidates.slice(0, cap).map((c) => ({
    entity: c.entity,
    left: [],
    right: [],
    source: 'auto' as const,
  }));
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
