import type { Column, IR } from '@dbsketch/parser';
import type { Layout } from './types.js';
import { routeStats } from './stats.js';

// Per-entity greedy search over column orderings. For each entity with
// scattered FK columns (or just multiple candidates worth trying), we
// run the layout up to three times — declared order, PK-FK-other, and
// barycenter-sorted FKs — and pick whichever produced lower crossings
// (tie-break: lower totalVLength, then declared order for stability).
//
// Decisions are local to each entity but accumulate: later entities see
// the previous winners baked into the IR they're tested against, which
// catches some cascade effects (an entity's reorder shifting a sibling's
// barycenter and changing its target's port row).
//
// Determinism: same input → same chosen orderings. Entities visit in
// declared order; ties prefer declared.
export function optimizeColumns(ir: IR, evaluate: (ir: IR) => Layout): IR {
  // Global preserve_order short-circuits the whole pass — every entity
  // stays at declared order.
  if (ir.hints.preserveOrder.global) return ir;

  const preserveSet = new Set(ir.hints.preserveOrder.entities);
  const candidates = ir.entities.filter(
    (e) => !preserveSet.has(e.name) && hasReorderCandidate(e, ir),
  );
  if (candidates.length === 0) return ir;

  let bestIr = ir;
  let bestLayout = evaluate(ir);
  let bestStats = routeStats(bestLayout);

  // Entities with 2+ FK columns are also candidates for barycenter sorting
  // even when the FK group is already contiguous at the top.
  const barycentreCandidates = ir.entities.filter(
    (e) => !preserveSet.has(e.name) && hasBarycentreCandidate(e, ir),
  );

  for (const entity of candidates) {
    if (bestStats.crossings === 0) break;

    // Candidate 1: PK → FK → other (declared order within each group)
    const pkFkCols = pkFkOtherOrdering(entity, ir);
    const altIr1 = replaceEntity(bestIr, entity.name, pkFkCols);
    const altLayout1 = evaluate(altIr1);
    const altStats1 = routeStats(altLayout1);
    if (isBetter(altStats1, bestStats)) {
      bestIr = altIr1;
      bestLayout = altLayout1;
      bestStats = altStats1;
    }

    if (bestStats.crossings === 0) break;

    // Candidate 2: PK → FK sorted by target row (barycenter) → other
    const barycentreCols = barycentreFkOrdering(entity, bestIr, bestLayout);
    if (barycentreCols !== null) {
      const altIr2 = replaceEntity(bestIr, entity.name, barycentreCols);
      const altLayout2 = evaluate(altIr2);
      const altStats2 = routeStats(altLayout2);
      if (isBetter(altStats2, bestStats)) {
        bestIr = altIr2;
        bestLayout = altLayout2;
        bestStats = altStats2;
      }
    }
  }

  // Barycenter pass for entities with 2+ contiguous FK columns — not covered
  // by the scattered-FK loop above but still benefit from port-row alignment.
  for (const entity of barycentreCandidates) {
    if (candidates.includes(entity)) continue; // already handled above

    const barycentreCols = barycentreFkOrdering(entity, bestIr, bestLayout);
    if (barycentreCols !== null) {
      const altIr = replaceEntity(bestIr, entity.name, barycentreCols);
      const altLayout = evaluate(altIr);
      const altStats = routeStats(altLayout);
      if (isBetter(altStats, bestStats)) {
        bestIr = altIr;
        bestLayout = altLayout;
        bestStats = altStats;
      }
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

// Any entity with 2+ FK columns is a candidate for barycenter FK ordering,
// even when they're already contiguous at the top. Internal FK ordering
// still affects crossings regardless of group position.
function hasBarycentreCandidate(entity: { columns: Column[]; name: string }, ir: IR): boolean {
  let fkCount = 0;
  for (const ref of ir.refs) {
    if (ref.child.entity === entity.name) fkCount++;
  }
  return fkCount >= 2;
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

// Sort FK columns by the rowStrip of their target (parent) entity.
// Returns null when there are fewer than 2 FK columns with known targets
// (no reordering possible) or when the result equals pkFkOther (already tried).
function barycentreFkOrdering(
  entity: { columns: Column[]; name: string },
  ir: IR,
  layout: Layout,
): Column[] | null {
  const rowByEntity = new Map(layout.placements.map((p) => [p.entity, p.rowStrip]));

  // FK column → rowStrip of its parent entity (average if a column refs
  // multiple parents, though that's uncommon).
  const fkRow = new Map<string, number>();
  for (const ref of ir.refs) {
    if (ref.child.entity !== entity.name) continue;
    const row = rowByEntity.get(ref.parent.entity);
    if (row === undefined) continue;
    const prev = fkRow.get(ref.child.column);
    fkRow.set(ref.child.column, prev === undefined ? row : (prev + row) / 2);
  }

  if (fkRow.size < 2) return null;

  const pks: Column[] = [];
  const fks: Column[] = [];
  const others: Column[] = [];
  for (const c of entity.columns) {
    if (c.pk) pks.push(c);
    else if (fkRow.has(c.name)) fks.push(c);
    else others.push(c);
  }

  // Sort FK columns by ascending target rowStrip; stable sort preserves
  // declared order for columns with equal target rows.
  fks.sort((a, b) => (fkRow.get(a.name) ?? 0) - (fkRow.get(b.name) ?? 0));

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
function isBetter(
  a: ReturnType<typeof routeStats>,
  b: ReturnType<typeof routeStats>,
): boolean {
  if (a.crossings !== b.crossings) return a.crossings < b.crossings;
  return a.totalVLength < b.totalVLength;
}
