import type { IR, LayoutHints } from '@ascii-erd/parser';
import { place } from './place.js';
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
  const ranks = rank(ir);
  applyColPins(ranks, ir.hints, ir);
  validateColPins(ranks, ir);

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
  const edges = materializeEdges(planResult.planned, placements, sizing);
  return {
    ir,
    placements,
    sizing,
    edges,
    skippedRefs: planResult.skippedRefs,
  };
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
