// Public API: the `layout()` entry point plus the types library consumers
// need to inspect a Layout (entities, edges, segments, ports, placement).
// Internal stages (rank, place, route, size, detectHubs) and their working
// types are intentionally not re-exported — they can be imported from their
// source files directly if needed but aren't part of the stable surface.
export { HintConflictError, layout } from './layout.js';
export type { EntityBox, EntityPositions } from './positions.js';
export { routeStats } from './stats.js';
export type { RouteStats } from './stats.js';
export type {
  EdgeRoute,
  EdgeSegment,
  Layout,
  Placement,
  Port,
  Side,
  StripSizing,
} from './types.js';
