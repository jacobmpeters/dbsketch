import type { IR } from '@ascii-erd/parser';
import { place } from './place.js';
import { rank } from './rank.js';
import { materializeEdges, planRoutes } from './route.js';
import { size } from './size.js';
import type { Layout } from './types.js';

export function layout(ir: IR): Layout {
  const ranks = rank(ir);
  const placements = place(ir, ranks);
  const planResult = planRoutes(ir, placements);
  const sizing = size(ir, placements, planResult.channelTrackCounts);
  const edges = materializeEdges(planResult.planned, placements, sizing);
  return {
    ir,
    placements,
    sizing,
    edges,
    skippedRefs: planResult.skippedRefs,
  };
}
