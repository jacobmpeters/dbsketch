import type { Column, IR } from '@dbsketch/parser';
import type { RouteStats } from './stats.js';

// Per-entity greedy search over column orderings. For each entity with
// scattered FK columns (or just multiple candidates worth trying), we
// run the layout twice — once with declared order, once with PK-FK-other
// reorder — and pick whichever produced lower crossings (tie-break:
// lower totalVLength, then declared order for stability).
//
// Decisions are local to each entity but accumulate: later entities see
// the previous winners baked into the IR they're tested against, which
// catches some cascade effects (an entity's reorder shifting a sibling's
// barycenter and changing its target's port row).
//
// Determinism: same input → same chosen orderings. Entities visit in
// declared order; ties prefer declared.
export function optimizeColumns(ir: IR, evaluate: (ir: IR) => RouteStats): IR {
  // Global preserve_order short-circuits the whole pass — every entity
  // stays at declared order.
  if (ir.hints.preserveOrder.global) return ir;

  const preserveSet = new Set(ir.hints.preserveOrder.entities);
  const candidates = ir.entities.filter(
    (e) => !preserveSet.has(e.name) && hasReorderCandidate(e, ir),
  );
  if (candidates.length === 0) return ir;

  let bestIr = ir;
  let bestStats = evaluate(ir);

  for (const entity of candidates) {
    const reordered = pkFkOtherOrdering(entity, ir);
    const altIr = replaceEntity(bestIr, entity.name, reordered);
    const altStats = evaluate(altIr);
    if (isBetter(altStats, bestStats)) {
      bestIr = altIr;
      bestStats = altStats;
    }
  }

  return bestIr;
}

// "Interesting" candidate: entity has at least one FK column AND at
// least one non-FK non-PK column. If FK columns are already contiguous
// at the start (after the PK), the reorder is a no-op and we skip the
// search. Hub-style entities (many FKs scattered between non-FKs) are
// where this fires.
function hasReorderCandidate(entity: { columns: Column[]; name: string }, ir: IR): boolean {
  const fkColumns = new Set<string>();
  for (const ref of ir.refs) {
    if (ref.child.entity === entity.name) fkColumns.add(ref.child.column);
  }
  if (fkColumns.size === 0) return false;

  let hasNonFkAfterPk = false;
  let hasFk = false;
  let sawNonFkBeforeFk = false;
  for (const col of entity.columns) {
    if (col.pk) continue;
    if (fkColumns.has(col.name)) {
      hasFk = true;
      if (hasNonFkAfterPk) sawNonFkBeforeFk = true;
    } else {
      hasNonFkAfterPk = true;
    }
  }
  // Skip when FKs are already at the top after PK (declared = reorder).
  return hasFk && sawNonFkBeforeFk;
}

function pkFkOtherOrdering(entity: { columns: Column[]; name: string }, ir: IR): Column[] {
  const fkColumns = new Set<string>();
  for (const ref of ir.refs) {
    if (ref.child.entity === entity.name) fkColumns.add(ref.child.column);
  }
  const pks: Column[] = [];
  const fks: Column[] = [];
  const others: Column[] = [];
  for (const c of entity.columns) {
    if (c.pk) pks.push(c);
    else if (fkColumns.has(c.name)) fks.push(c);
    else others.push(c);
  }
  return [...pks, ...fks, ...others];
}

function replaceEntity(ir: IR, name: string, columns: Column[]): IR {
  return {
    ...ir,
    entities: ir.entities.map((e) => (e.name === name ? { ...e, columns } : e)),
  };
}

// Lower crossings wins; tie-break on lower totalVLength. When both
// match the declared baseline, the baseline is preferred (this function
// only returns true for a strict improvement).
function isBetter(a: RouteStats, b: RouteStats): boolean {
  if (a.crossings !== b.crossings) return a.crossings < b.crossings;
  return a.totalVLength < b.totalVLength;
}
