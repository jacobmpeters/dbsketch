import type { IR, Ref } from '@ascii-erd/parser';

export interface Placement {
  entity: string;
  colStrip: number;
  rowStrip: number;
}

// Sizes are in character cells. Channel arrays have length (strip count - 1):
// channels live between adjacent node strips. Outer channels are deferred.
export interface StripSizing {
  colStripWidths: number[];
  channelColWidths: number[];
  rowStripHeights: number[];
  channelRowHeights: number[];
}

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Port {
  x: number;
  y: number;
  side: Side;
}

export interface EdgeSegment {
  kind: 'horizontal' | 'vertical';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface EdgeRoute {
  ref: Ref;
  parentPort: Port;
  childPort: Port;
  segments: EdgeSegment[];
}

export interface Layout {
  ir: IR;
  placements: Placement[];
  sizing: StripSizing;
  edges: EdgeRoute[];
  // Per-entity absolute position. Render and route consume this rather than
  // computing y from strip offsets directly — lets Stage 2 (per-col stacking)
  // change the y semantics without touching consumers.
  entityPositions: Map<string, { x: number; y: number; width: number; height: number }>;
  // Refs the v1 router can't handle yet — surfaced so consumers can see them
  // rather than silently swallowing relationships.
  skippedRefs: Ref[];
}
