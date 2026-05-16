import type { Entity, IR, Ref } from '@ascii-erd/parser';
import type { EntityPositions } from './positions.js';
import { type RowSizing, rowSize } from './size.js';
import type { EdgeRoute, EdgeSegment, Placement, Port, StripSizing } from './types.js';

interface BasePlannedEdge {
  ref: Ref;
  parentColStrip: number;
  childColStrip: number;
  parentRowStrip: number;
  childRowStrip: number;
  // Row index within the entity box (3 = top border + name + separator).
  parentRowOffset: number;
  childRowOffset: number;
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
  const numRowStrips = placements.reduce((m, p) => Math.max(m, p.rowStrip), -1) + 1;

  const planned: PlannedEdge[] = [];
  const skippedRefs: Ref[] = [];
  for (const ref of ir.refs) {
    const fit = tryPlan(ref, placementByEntity, entityByName, numRowStrips);
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
  numRowStrips: number,
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
  // Parent must be to the left of child. (Rank assignment guarantees this for
  // one-to-many; same-col edges (cycles) and reverse edges aren't supported.)
  if (colDiff <= 0) return null;

  const base: BasePlannedEdge = {
    ref,
    parentColStrip: parentP.colStrip,
    childColStrip: childP.colStrip,
    parentRowStrip: parentP.rowStrip,
    childRowStrip: childP.rowStrip,
    parentRowOffset: 3 + parentColIdx,
    childRowOffset: 3 + childColIdx,
  };

  if (colDiff === 1) {
    return {
      kind: 'single',
      ...base,
      channelIndex: parentP.colStrip,
      track: -1,
    };
  }

  // Multi-hop. Try the row-channel just below the higher of parent/child
  // first; if that row-channel doesn't exist (both at the last row strip),
  // fall back to the row-channel just above the lower of the two. Skip
  // only when neither direction has a row-channel available.
  const minRow = Math.min(parentP.rowStrip, childP.rowStrip);
  const maxRow = Math.max(parentP.rowStrip, childP.rowStrip);
  let detourRowChannel: number;
  if (minRow < numRowStrips - 1) {
    detourRowChannel = minRow;
  } else if (maxRow > 0) {
    detourRowChannel = maxRow - 1;
  } else {
    return null;
  }

  return {
    kind: 'multi',
    ...base,
    parentChannelIndex: parentP.colStrip,
    childChannelIndex: childP.colStrip - 1,
    detourRowChannel,
    parentTrack: -1,
    childTrack: -1,
    detourTrack: -1,
  };
}

// Pack multi-hop H2 segments into row-channel y-tracks via interval scheduling
// on col-strip ranges. Top-of-channel flush: track 0 = topmost y.
function packRowChannels(planned: PlannedEdge[]): Map<number, number> {
  const byChannel = new Map<number, MultiHopPlannedEdge[]>();
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    let bucket = byChannel.get(edge.detourRowChannel);
    if (!bucket) {
      bucket = [];
      byChannel.set(edge.detourRowChannel, bucket);
    }
    bucket.push(edge);
  }

  const counts = new Map<number, number>();
  for (const [channel, edges] of byChannel) {
    counts.set(channel, packRowChannel(edges));
  }
  return counts;
}

function packRowChannel(edges: MultiHopPlannedEdge[]): number {
  // parentColStrip asc + span desc tiebreak (same heuristic as col-channel
  // packing — longer-spanning H2's get earlier y-tracks).
  edges.sort((a, b) => {
    const xMinDiff = a.parentColStrip - b.parentColStrip;
    if (xMinDiff !== 0) return xMinDiff;
    return b.childColStrip - b.parentColStrip - (a.childColStrip - a.parentColStrip);
  });
  const trackEnds: number[] = [];
  for (const edge of edges) {
    let assigned = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t]! < edge.parentColStrip) {
        trackEnds[t] = edge.childColStrip;
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackEnds.push(edge.childColStrip);
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

  for (const edge of planned) {
    if (edge.kind === 'single') {
      const py = absoluteY(edge.parentRowStrip, edge.parentRowOffset, rowSizing);
      const cy = absoluteY(edge.childRowStrip, edge.childRowOffset, rowSizing);
      if (py === cy) continue; // straight: no V segment
      add(edge.channelIndex, {
        yMin: Math.min(py, cy),
        yMax: Math.max(py, cy),
        assign: (t) => {
          edge.track = t;
        },
      });
    } else {
      const py = absoluteY(edge.parentRowStrip, edge.parentRowOffset, rowSizing);
      const cy = absoluteY(edge.childRowStrip, edge.childRowOffset, rowSizing);
      const dy = rowChannelStartY(edge.detourRowChannel, rowSizing) + Math.max(0, edge.detourTrack);
      add(edge.parentChannelIndex, {
        yMin: Math.min(py, dy),
        yMax: Math.max(py, dy),
        assign: (t) => {
          edge.parentTrack = t;
        },
      });
      add(edge.childChannelIndex, {
        yMin: Math.min(dy, cy),
        yMax: Math.max(dy, cy),
        assign: (t) => {
          edge.childTrack = t;
        },
      });
    }
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

  const parentRightX = parentBox.x + parentBox.width - 1;
  const childLeftX = childBox.x;
  const parentPortY = parentBox.y + p.parentRowOffset;
  const childPortY = childBox.y + p.childRowOffset;
  const channelStartX = parentRightX + 1;

  const parentPort: Port = { x: parentRightX, y: parentPortY, side: 'right' };
  const childPort: Port = { x: childLeftX, y: childPortY, side: 'left' };

  let segments: EdgeSegment[];
  if (parentPortY === childPortY) {
    segments = [
      {
        kind: 'horizontal',
        x1: channelStartX,
        y1: parentPortY,
        x2: childLeftX - 1,
        y2: parentPortY,
      },
    ];
  } else {
    // Asymmetric flush-to-parent-side: bend at channelStart + track.
    const bendX = channelStartX + Math.max(0, p.track);
    segments = [
      { kind: 'horizontal', x1: channelStartX, y1: parentPortY, x2: bendX, y2: parentPortY },
      { kind: 'vertical', x1: bendX, y1: parentPortY, x2: bendX, y2: childPortY },
      { kind: 'horizontal', x1: bendX, y1: childPortY, x2: childLeftX - 1, y2: childPortY },
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

  const parentRightX = parentBox.x + parentBox.width - 1;
  const childLeftX = childBox.x;
  const parentPortY = parentBox.y + p.parentRowOffset;
  const childPortY = childBox.y + p.childRowOffset;

  // V1 sits in the parent-side col-channel, flush to the parent border.
  const parentChannelStartX = parentRightX + 1;
  const v1X = parentChannelStartX + Math.max(0, p.parentTrack);

  // V2 sits in the child-side col-channel, also flush to its left edge.
  const v2ChannelStartX = colChannelStartX(sizing, p.childChannelIndex);
  const v2X = v2ChannelStartX + Math.max(0, p.childTrack);

  // H2 sits at top-of-channel y + detourTrack.
  const detourChannelStartY = rowChannelStartYFromSizing(sizing, p.detourRowChannel);
  const detourY = detourChannelStartY + Math.max(0, p.detourTrack);

  const parentPort: Port = { x: parentRightX, y: parentPortY, side: 'right' };
  const childPort: Port = { x: childLeftX, y: childPortY, side: 'left' };

  const segments: EdgeSegment[] = [
    { kind: 'horizontal', x1: parentChannelStartX, y1: parentPortY, x2: v1X, y2: parentPortY },
    { kind: 'vertical', x1: v1X, y1: parentPortY, x2: v1X, y2: detourY },
    { kind: 'horizontal', x1: v1X, y1: detourY, x2: v2X, y2: detourY },
    { kind: 'vertical', x1: v2X, y1: detourY, x2: v2X, y2: childPortY },
    { kind: 'horizontal', x1: v2X, y1: childPortY, x2: childLeftX - 1, y2: childPortY },
  ];

  return { ref: p.ref, parentPort, childPort, segments };
}

function stripOffset(strips: number[], channels: number[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += strips[i]!;
    if (i < channels.length) offset += channels[i]!;
  }
  return offset;
}

function colChannelStartX(sizing: StripSizing, channelIndex: number): number {
  let x = 0;
  for (let i = 0; i <= channelIndex; i++) {
    x += sizing.colStripWidths[i] ?? 0;
    if (i < channelIndex) x += sizing.channelColWidths[i] ?? 0;
  }
  return x;
}

function rowChannelStartYFromSizing(sizing: StripSizing, channelIndex: number): number {
  let y = 0;
  for (let i = 0; i <= channelIndex; i++) {
    y += sizing.rowStripHeights[i] ?? 0;
    if (i < channelIndex) y += sizing.channelRowHeights[i] ?? 0;
  }
  return y;
}
