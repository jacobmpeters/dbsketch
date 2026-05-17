import type { IR, LayoutHints } from '@dbsketch/parser';
import { detectHubs } from './detectHubs.js';
import { place } from './place.js';
import { computeEntityPositions } from './positions.js';
import { rank } from './rank.js';
import { materializeEdges, planRoutes } from './route.js';
import { size } from './size.js';
import type { Layout } from './types.js';

export class HintConflictError extends Error {
  constructor(message: string) {
    super(`hint: ${message}`);
  }
}

export function layout(ir: IR): Layout {
  validateHintCombos(ir);
  const centers = detectHubs(ir);
  const ranks = rank(ir, centers);
  applyColPins(ranks, ir.hints, ir);
  // With center placement the parent-col < child-col invariant is
  // intentionally relaxed (the whole point is fanning edges to both
  // sides of the hub), so skip that validation when centers exist.
  if (centers.length === 0) validateColPins(ranks, ir);

  const pinnedRows = collectPinnedRows(ir.hints);
  validatePinPositions(ir.hints);

  const placements = place(ir, ranks, pinnedRows);

  const planResult = planRoutes(ir, placements);
  const sizing = size(
    ir,
    placements,
    planResult.channelTrackCounts,
    planResult.rowChannelTrackCounts,
  );
  const topMarginHeight = planResult.rowChannelTrackCounts.get(-1) ?? 0;
  const entityPositions = computeEntityPositions(ir, placements, sizing, topMarginHeight);
  const edges = materializeEdges(planResult.planned, placements, sizing, entityPositions);
  return {
    ir,
    placements,
    sizing,
    edges,
    entityPositions,
    skippedRefs: planResult.skippedRefs,
  };
}

// A user-provided @center on an entity also constrains its col (the hub
// sits at a center col chosen by the ranker). Mixing with @col on the same
// entity sends conflicting signals and produces broken layouts, so reject
// up front with a clear message.
function validateHintCombos(ir: IR): void {
  const pinnedCols = new Map<string, number>();
  for (const p of ir.hints.pins) {
    if (p.col !== null) pinnedCols.set(p.entity, p.col);
  }
  for (const c of ir.hints.centers) {
    if (c.source !== 'user') continue;
    if (pinnedCols.has(c.entity)) {
      throw new HintConflictError(
        `entity '${c.entity}' has both @center and a @col pin — these constrain the same axis`,
      );
    }
  }
}

// Override col-strip assignment for any entity with a col pin. Mutates the
// ranks map. Validation happens separately.
function applyColPins(ranks: Map<string, number>, hints: LayoutHints, ir: IR): void {
  const entityNames = new Set(ir.entities.map((e) => e.name));
  for (const pin of hints.pins) {
    if (!entityNames.has(pin.entity)) {
      throw new HintConflictError(`pin references unknown entity '${pin.entity}'`);
    }
    if (pin.col !== null) {
      ranks.set(pin.entity, pin.col);
    }
  }
}

// Verify the parent col < child col invariant still holds after col pins.
// A pin that puts a child at or before its parent is rejected with a clear
// error pointing at the conflicting entities.
function validateColPins(ranks: Map<string, number>, ir: IR): void {
  for (const ref of ir.refs) {
    if (ref.cardinality !== 'one-to-many') continue;
    // Self-FKs are already skipped by the router (they'd need col-distance > 0)
    // and they trivially fail the parent-col < child-col check, so exclude
    // them here to avoid spurious conflict errors.
    if (ref.parent.entity === ref.child.entity) continue;
    const parentCol = ranks.get(ref.parent.entity);
    const childCol = ranks.get(ref.child.entity);
    if (parentCol === undefined || childCol === undefined) continue;
    if (parentCol >= childCol) {
      throw new HintConflictError(
        `pin places ${ref.child.entity} (col ${childCol}) at or before its parent ${ref.parent.entity} (col ${parentCol})`,
      );
    }
  }
}

function collectPinnedRows(hints: LayoutHints): Map<string, number> {
  const rows = new Map<string, number>();
  for (const pin of hints.pins) {
    if (pin.row !== null) rows.set(pin.entity, pin.row);
  }
  return rows;
}

// Two fully-specified pins (col + row both set) at the same position is
// always a conflict. Partial pins that might collide after placement are
// detected by place() — it skips pinned rows when assigning others.
function validatePinPositions(hints: LayoutHints): void {
  const seen = new Map<string, string>();
  for (const pin of hints.pins) {
    if (pin.col === null || pin.row === null) continue;
    const key = `${pin.col}:${pin.row}`;
    const existing = seen.get(key);
    if (existing) {
      throw new HintConflictError(
        `pins on '${existing}' and '${pin.entity}' both target (col ${pin.col}, row ${pin.row})`,
      );
    }
    seen.set(key, pin.entity);
  }
}
