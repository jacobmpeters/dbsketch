import type { Entity, IR, Ref } from '@dbsketch/parser';
import type { EntityPositions } from './positions.js';
import { type RowSizing, rowSize } from './size.js';
import type { EdgeRoute, EdgeSegment, Placement, Port, Side, StripSizing } from './types.js';

interface BasePlannedEdge {
  ref: Ref;
  parentColStrip: number;
  childColStrip: number;
  parentRowStrip: number;
  childRowStrip: number;
  // Row index within the entity box (3 = top border + name + separator).
  parentRowOffset: number;
  childRowOffset: number;
  // +1 if child is to the right of parent (standard left-to-right flow),
  // -1 if to the left (only possible with center placement). All routing
  // mirrors based on this sign.
  direction: 1 | -1;
}

export interface SingleHopPlannedEdge extends BasePlannedEdge {
  kind: 'single';
  channelIndex: number;
  // -1 means straight (parent and child port at the same absolute y, no bend).
  track: number;
}

export interface MultiHopPlannedEdge extends BasePlannedEdge {
  kind: 'multi';
  // The two col-channels the path enters and exits through.
  parentChannelIndex: number;
  childChannelIndex: number;
  // The row-channel the H2 segment travels through.
  detourRowChannel: number;
  // x-track for V1 in the parent-side col-channel.
  parentTrack: number;
  // x-track for V2 in the child-side col-channel.
  childTrack: number;
  // y-track for H2 in the detour row-channel.
  detourTrack: number;
}

export type PlannedEdge = SingleHopPlannedEdge | MultiHopPlannedEdge;

export interface RoutePlan {
  planned: PlannedEdge[];
  skippedRefs: Ref[];
  channelTrackCounts: Map<number, number>;
  rowChannelTrackCounts: Map<number, number>;
}

// Multi-phase planning:
//   1. Classify each ref (single-hop, multi-hop, or skip).
//   2. Pack multi-hop H2 segments into row-channel y-tracks. Uses col-strip
//      indices for overlap so it doesn't need absolute coords.
//   3. Re-compute row sizing with the row-channel heights from step 2.
//   4. Pack all V segments (single-hop V plus multi-hop V1, V2) into
//      col-channel x-tracks using absolute y from step 3.
export function planRoutes(ir: IR, placements: Placement[]): RoutePlan {
  const placementByEntity = new Map(placements.map((p) => [p.entity, p]));
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));

  const planned: PlannedEdge[] = [];
  const skippedRefs: Ref[] = [];
  for (const ref of ir.refs) {
    const fit = tryPlan(ref, placementByEntity, entityByName);
    if (fit) planned.push(fit);
    else skippedRefs.push(ref);
  }

  const rowChannelTrackCounts = packRowChannels(planned);
  const rowSizing = rowSize(ir, placements, rowChannelTrackCounts);
  const channelTrackCounts = packColChannels(planned, rowSizing);

  return { planned, skippedRefs, channelTrackCounts, rowChannelTrackCounts };
}

function tryPlan(
  ref: Ref,
  placementByEntity: Map<string, Placement>,
  entityByName: Map<string, Entity>,
): PlannedEdge | null {
  if (ref.cardinality === 'many-to-many') return null;

  const parentP = placementByEntity.get(ref.parent.entity);
  const childP = placementByEntity.get(ref.child.entity);
  if (!parentP || !childP) return null;

  const parentEntity = entityByName.get(ref.parent.entity);
  const childEntity = entityByName.get(ref.child.entity);
  if (!parentEntity || !childEntity) return null;

  const parentColIdx = parentEntity.columns.findIndex((c) => c.name === ref.parent.column);
  const childColIdx = childEntity.columns.findIndex((c) => c.name === ref.child.column);
  if (parentColIdx === -1 || childColIdx === -1) return null;

  const colDiff = childP.colStrip - parentP.colStrip;
  // Same-col edges (cycles) and zero-distance refs aren't routable.
  if (colDiff === 0) return null;
  const direction: 1 | -1 = colDiff > 0 ? 1 : -1;
  const absDiff = Math.abs(colDiff);

  const base: BasePlannedEdge = {
    ref,
    parentColStrip: parentP.colStrip,
    childColStrip: childP.colStrip,
    parentRowStrip: parentP.rowStrip,
    childRowStrip: childP.rowStrip,
    parentRowOffset: 3 + parentColIdx,
    childRowOffset: 3 + childColIdx,
    direction,
  };

  if (absDiff === 1) {
    // Channel between adjacent cols, regardless of direction.
    const channelIndex = Math.min(parentP.colStrip, childP.colStrip);
    return {
      kind: 'single',
      ...base,
      channelIndex,
      track: -1,
    };
  }

  // Multi-hop: V1 in the channel adjacent to parent on the child side,
  // V2 in the channel adjacent to child on the parent side, H2 in top margin.
  const parentChannelIndex = direction > 0 ? parentP.colStrip : parentP.colStrip - 1;
  const childChannelIndex = direction > 0 ? childP.colStrip - 1 : childP.colStrip;
  return {
    kind: 'multi',
    ...base,
    parentChannelIndex,
    childChannelIndex,
    detourRowChannel: -1,
    parentTrack: -1,
    childTrack: -1,
    detourTrack: -1,
  };
}

// Pack multi-hop H2 segments into y-tracks within the shared top margin.
// All multi-hops use the same logical channel (the top margin), so they
// share track allocation via interval scheduling on x-ranges (col-strip
// indices).
function packRowChannels(planned: PlannedEdge[]): Map<number, number> {
  const multiHops: MultiHopPlannedEdge[] = [];
  for (const edge of planned) {
    if (edge.kind === 'multi') multiHops.push(edge);
  }
  const counts = new Map<number, number>();
  if (multiHops.length > 0) {
    counts.set(-1, packRowChannel(multiHops));
  }
  return counts;
}

function packRowChannel(edges: MultiHopPlannedEdge[]): number {
  // xMin asc + span desc tiebreak. With center placement edges can run
  // either direction, so compare on min/max col rather than parent/child.
  const range = (e: MultiHopPlannedEdge): [number, number] => {
    const a = Math.min(e.parentColStrip, e.childColStrip);
    const b = Math.max(e.parentColStrip, e.childColStrip);
    return [a, b];
  };
  edges.sort((a, b) => {
    const [aMin, aMax] = range(a);
    const [bMin, bMax] = range(b);
    if (aMin !== bMin) return aMin - bMin;
    return bMax - bMin - (aMax - aMin);
  });
  const trackEnds: number[] = [];
  for (const edge of edges) {
    const [xMin, xMax] = range(edge);
    let assigned = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t]! < xMin) {
        trackEnds[t] = xMax;
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackEnds.push(xMax);
      assigned = trackEnds.length - 1;
    }
    edge.detourTrack = assigned;
  }
  return trackEnds.length;
}

interface VEntry {
  yMin: number;
  yMax: number;
  assign: (track: number) => void;
}

// Pack V segments into col-channel x-tracks. Each PlannedEdge contributes:
//   single-hop: one V (parent_y ↔ child_y) in channelIndex
//   multi-hop:  V1 (parent_y ↔ detour_y) in parentChannelIndex AND
//               V2 (detour_y ↔ child_y) in childChannelIndex
//
// Single-hop edges that share (parent_entity, parent_column, channel,
// direction) are *bundled*: they emit one VEntry whose y-range spans the
// union of all member intervals, and whose assign() sets the track on
// every member. The result is a single trunk V shared by all branches.
// Channel width = distinct bundle groups + standalone edges, instead of
// edge count — a clear win wherever a PK is referenced by multiple FKs
// in the same target col.
function packColChannels(planned: PlannedEdge[], rowSizing: RowSizing): Map<number, number> {
  const byChannel = new Map<number, VEntry[]>();
  const add = (channel: number, entry: VEntry): void => {
    let bucket = byChannel.get(channel);
    if (!bucket) {
      bucket = [];
      byChannel.set(channel, bucket);
    }
    bucket.push(entry);
  };

  // First pass: group single-hop edges by bundle key.
  const singleBundles = new Map<string, SingleHopPlannedEdge[]>();
  for (const edge of planned) {
    if (edge.kind !== 'single') continue;
    const py = absoluteY(edge.parentRowStrip, edge.parentRowOffset, rowSizing);
    const cy = absoluteY(edge.childRowStrip, edge.childRowOffset, rowSizing);
    if (py === cy) continue; // straight: no V segment, no track needed
    const key = `${edge.channelIndex}|${edge.direction}|${edge.ref.parent.entity}|${edge.ref.parent.column}`;
    let bucket = singleBundles.get(key);
    if (!bucket) {
      bucket = [];
      singleBundles.set(key, bucket);
    }
    bucket.push(edge);
  }

  for (const edges of singleBundles.values()) {
    const channel = edges[0]!.channelIndex;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const edge of edges) {
      const py = absoluteY(edge.parentRowStrip, edge.parentRowOffset, rowSizing);
      const cy = absoluteY(edge.childRowStrip, edge.childRowOffset, rowSizing);
      yMin = Math.min(yMin, py, cy);
      yMax = Math.max(yMax, py, cy);
    }
    add(channel, {
      yMin,
      yMax,
      assign: (t) => {
        for (const edge of edges) edge.track = t;
      },
    });
  }

  // Multi-hop: V1 (parent-side) bundles by the same rule as single-hop.
  // V2 (child-side) doesn't bundle in practice — each multi-hop has its
  // own child column (no shared child port).
  const multiV1Bundles = new Map<string, MultiHopPlannedEdge[]>();
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    const key = `${edge.parentChannelIndex}|${edge.direction}|${edge.ref.parent.entity}|${edge.ref.parent.column}`;
    let bucket = multiV1Bundles.get(key);
    if (!bucket) {
      bucket = [];
      multiV1Bundles.set(key, bucket);
    }
    bucket.push(edge);
  }
  for (const edges of multiV1Bundles.values()) {
    const channel = edges[0]!.parentChannelIndex;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const edge of edges) {
      const py = absoluteY(edge.parentRowStrip, edge.parentRowOffset, rowSizing);
      const dy = rowChannelStartY(edge.detourRowChannel, rowSizing) + Math.max(0, edge.detourTrack);
      yMin = Math.min(yMin, py, dy);
      yMax = Math.max(yMax, py, dy);
    }
    add(channel, {
      yMin,
      yMax,
      assign: (t) => {
        for (const edge of edges) edge.parentTrack = t;
      },
    });
  }
  // V2 segments are independent per edge.
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    const cy = absoluteY(edge.childRowStrip, edge.childRowOffset, rowSizing);
    const dy = rowChannelStartY(edge.detourRowChannel, rowSizing) + Math.max(0, edge.detourTrack);
    add(edge.childChannelIndex, {
      yMin: Math.min(dy, cy),
      yMax: Math.max(dy, cy),
      assign: (t) => {
        edge.childTrack = t;
      },
    });
  }

  const counts = new Map<number, number>();
  for (const [channel, entries] of byChannel) {
    counts.set(channel, packVEntries(entries));
  }
  return counts;
}

function packVEntries(entries: VEntry[]): number {
  // yMin asc gives optimal track count (standard interval scheduling).
  // Within ties on yMin, longer-spanning V's get earlier tracks: their H's
  // sit at the y-extremes (which other V's are less likely to span across),
  // so fewer H × V crossings result.
  entries.sort((a, b) => {
    const yMinDiff = a.yMin - b.yMin;
    if (yMinDiff !== 0) return yMinDiff;
    return b.yMax - b.yMin - (a.yMax - a.yMin);
  });
  const trackEnds: number[] = [];
  for (const e of entries) {
    let assigned = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t]! < e.yMin) {
        trackEnds[t] = e.yMax;
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackEnds.push(e.yMax);
      assigned = trackEnds.length - 1;
    }
    e.assign(assigned);
  }
  return trackEnds.length;
}

function absoluteY(rowStrip: number, rowOffset: number, rowSizing: RowSizing): number {
  let y = rowOffset;
  for (let i = 0; i < rowStrip; i++) {
    y += rowSizing.rowStripHeights[i] ?? 0;
    if (i < rowSizing.channelRowHeights.length) {
      y += rowSizing.channelRowHeights[i] ?? 0;
    }
  }
  return y;
}

function rowChannelStartY(channelIndex: number, rowSizing: RowSizing): number {
  let y = 0;
  for (let i = 0; i <= channelIndex; i++) {
    y += rowSizing.rowStripHeights[i] ?? 0;
    if (i < channelIndex) {
      y += rowSizing.channelRowHeights[i] ?? 0;
    }
  }
  return y;
}

export function materializeEdges(
  planned: PlannedEdge[],
  placements: Placement[],
  sizing: StripSizing,
  entityPositions: EntityPositions,
): EdgeRoute[] {
  return planned.map((p) =>
    p.kind === 'single'
      ? materializeSingleHop(p, sizing, entityPositions)
      : materializeMultiHop(p, sizing, entityPositions),
  );
}

function materializeSingleHop(
  p: SingleHopPlannedEdge,
  sizing: StripSizing,
  entityPositions: EntityPositions,
): EdgeRoute {
  const parentBox = entityPositions.get(p.ref.parent.entity)!;
  const childBox = entityPositions.get(p.ref.child.entity)!;

  // For forward edges (direction +1): parent's right port → child's left port.
  // For backward edges (-1): parent's left port → child's right port. The
  // channel sits between them either way; bend tracks pack flush to parent.
  const parentPortX = p.direction > 0 ? parentBox.x + parentBox.width - 1 : parentBox.x;
  const childPortX = p.direction > 0 ? childBox.x : childBox.x + childBox.width - 1;
  const parentPortY = parentBox.y + p.parentRowOffset;
  const childPortY = childBox.y + p.childRowOffset;
  const parentSide: Side = p.direction > 0 ? 'right' : 'left';
  const childSide: Side = p.direction > 0 ? 'left' : 'right';

  const parentPort: Port = { x: parentPortX, y: parentPortY, side: parentSide };
  const childPort: Port = { x: childPortX, y: childPortY, side: childSide };

  let segments: EdgeSegment[];
  if (parentPortY === childPortY) {
    // Straight horizontal segment between the two port columns.
    const xLo = Math.min(parentPortX, childPortX);
    const xHi = Math.max(parentPortX, childPortX);
    segments = [{ kind: 'horizontal', x1: xLo + 1, y1: parentPortY, x2: xHi - 1, y2: parentPortY }];
  } else {
    // V tracks pack from the channel's left edge regardless of edge
    // direction. With mixed forward + backward edges in the same channel,
    // anchoring each to its own parent would map distinct track indices
    // to the same X cell (collision); a single anchor side avoids that.
    // Forward edges keep their original "flush to parent" placement;
    // backward edges land further from their parent than ideal but never
    // overlap a forward edge.
    const channelLeftX = colChannelStartX(sizing, p.channelIndex);
    const bendX = channelLeftX + Math.max(0, p.track);
    // H1/H2 include the port cells. drawPortMarker repaints those cells
    // at the end, so the horizontal glyph there is invisible. The benefit:
    // x1 always conveys travel direction (x2-x1 has a sign), so corner
    // selection works for backward edges without separate direction hints.
    segments = [
      { kind: 'horizontal', x1: parentPortX, y1: parentPortY, x2: bendX, y2: parentPortY },
      { kind: 'vertical', x1: bendX, y1: parentPortY, x2: bendX, y2: childPortY },
      { kind: 'horizontal', x1: bendX, y1: childPortY, x2: childPortX, y2: childPortY },
    ];
  }
  return { ref: p.ref, parentPort, childPort, segments };
}

function materializeMultiHop(
  p: MultiHopPlannedEdge,
  sizing: StripSizing,
  entityPositions: EntityPositions,
): EdgeRoute {
  const parentBox = entityPositions.get(p.ref.parent.entity)!;
  const childBox = entityPositions.get(p.ref.child.entity)!;

  const parentPortX = p.direction > 0 ? parentBox.x + parentBox.width - 1 : parentBox.x;
  const childPortX = p.direction > 0 ? childBox.x : childBox.x + childBox.width - 1;
  const parentPortY = parentBox.y + p.parentRowOffset;
  const childPortY = childBox.y + p.childRowOffset;
  const parentSide: Side = p.direction > 0 ? 'right' : 'left';
  const childSide: Side = p.direction > 0 ? 'left' : 'right';

  // V1 and V2 both pack from their channel's left edge (track grows right),
  // regardless of edge direction. See materializeSingleHop for the rationale:
  // mixed forward/backward edges in one channel must use a single anchor
  // side to avoid track-index collisions.
  const v1ChannelLeftX = colChannelStartX(sizing, p.parentChannelIndex);
  const v1X = v1ChannelLeftX + Math.max(0, p.parentTrack);
  const v2ChannelLeftX = colChannelStartX(sizing, p.childChannelIndex);
  const v2X = v2ChannelLeftX + Math.max(0, p.childTrack);

  // H2 routes through the top margin (compact-layout mode). detourTrack is
  // the y-position within the margin (0 = topmost row).
  const detourY = Math.max(0, p.detourTrack);

  const parentPort: Port = { x: parentPortX, y: parentPortY, side: parentSide };
  const childPort: Port = { x: childPortX, y: childPortY, side: childSide };

  // H1/H5 include the port cells so x2-x1 has a sign that directionAtEnd
  // can read; drawPortMarker repaints them. Same trick as single-hop.
  const segments: EdgeSegment[] = [
    { kind: 'horizontal', x1: parentPortX, y1: parentPortY, x2: v1X, y2: parentPortY },
    { kind: 'vertical', x1: v1X, y1: parentPortY, x2: v1X, y2: detourY },
    { kind: 'horizontal', x1: v1X, y1: detourY, x2: v2X, y2: detourY },
    { kind: 'vertical', x1: v2X, y1: detourY, x2: v2X, y2: childPortY },
    { kind: 'horizontal', x1: v2X, y1: childPortY, x2: childPortX, y2: childPortY },
  ];

  return { ref: p.ref, parentPort, childPort, segments };
}

function colChannelStartX(sizing: StripSizing, channelIndex: number): number {
  let x = 0;
  for (let i = 0; i <= channelIndex; i++) {
    x += sizing.colStripWidths[i] ?? 0;
    if (i < channelIndex) x += sizing.channelColWidths[i] ?? 0;
  }
  return x;
}
