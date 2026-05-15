import type { Entity, IR, Ref } from '@ascii-erd/parser';
import type { EdgeRoute, EdgeSegment, Placement, Port, StripSizing } from './types.js';

export interface PlannedEdge {
  ref: Ref;
  parentColStrip: number;
  childColStrip: number;
  rowStrip: number;
  // Row index within the entity box (3 = top border + name + separator).
  parentRowOffset: number;
  childRowOffset: number;
  channelIndex: number;
  // -1 means straight (parent and child port at the same row, no bend).
  track: number;
}

export interface RoutePlan {
  planned: PlannedEdge[];
  skippedRefs: Ref[];
  channelTrackCounts: Map<number, number>;
}

// V1 routes only refs between adjacent col-strips in the same row-strip with
// asymmetric (one-to-one or one-to-many) cardinality. Multi-hop, vertical, and
// many-to-many edges go to skippedRefs and are surfaced in the Layout — the
// user sees them rather than the tool silently dropping relationships.
export function planRoutes(ir: IR, placements: Placement[]): RoutePlan {
  const placementByEntity = new Map(placements.map((p) => [p.entity, p]));
  const entityByName = new Map(ir.entities.map((e) => [e.name, e]));

  const planned: PlannedEdge[] = [];
  const skippedRefs: Ref[] = [];
  for (const ref of ir.refs) {
    const fit = tryPlan(ref, placementByEntity, entityByName);
    if (fit) {
      planned.push(fit);
    } else {
      skippedRefs.push(ref);
    }
  }

  const channelTrackCounts = packAllChannels(planned);
  return { planned, skippedRefs, channelTrackCounts };
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

  if (parentP.rowStrip !== childP.rowStrip) return null;
  if (childP.colStrip !== parentP.colStrip + 1) return null;

  const parentEntity = entityByName.get(ref.parent.entity);
  const childEntity = entityByName.get(ref.child.entity);
  if (!parentEntity || !childEntity) return null;

  const parentColIdx = parentEntity.columns.findIndex((c) => c.name === ref.parent.column);
  const childColIdx = childEntity.columns.findIndex((c) => c.name === ref.child.column);
  if (parentColIdx === -1 || childColIdx === -1) return null;

  return {
    ref,
    parentColStrip: parentP.colStrip,
    childColStrip: childP.colStrip,
    rowStrip: parentP.rowStrip,
    parentRowOffset: 3 + parentColIdx,
    childRowOffset: 3 + childColIdx,
    channelIndex: parentP.colStrip,
    track: -1,
  };
}

// Pack each (channel, row-strip) group via greedy interval scheduling on the
// vertical span of each Z-shape's bend. Different row-strips never overlap on
// the y-axis, so they share the channel's x-tracks freely; the channel's total
// track count is the max across its row-strips.
function packAllChannels(planned: PlannedEdge[]): Map<number, number> {
  const byChannel = new Map<number, PlannedEdge[]>();
  for (const e of planned) {
    let bucket = byChannel.get(e.channelIndex);
    if (!bucket) {
      bucket = [];
      byChannel.set(e.channelIndex, bucket);
    }
    bucket.push(e);
  }

  const counts = new Map<number, number>();
  for (const [channel, edges] of byChannel) {
    const byRowStrip = new Map<number, PlannedEdge[]>();
    for (const e of edges) {
      let bucket = byRowStrip.get(e.rowStrip);
      if (!bucket) {
        bucket = [];
        byRowStrip.set(e.rowStrip, bucket);
      }
      bucket.push(e);
    }
    let maxTracks = 0;
    for (const groupEdges of byRowStrip.values()) {
      maxTracks = Math.max(maxTracks, packGroup(groupEdges));
    }
    counts.set(channel, maxTracks);
  }
  return counts;
}

function packGroup(edges: PlannedEdge[]): number {
  // Straight edges (no vertical bend) don't compete for x-tracks — they sit at
  // their port row with no width contribution.
  const bending = edges.filter((e) => e.parentRowOffset !== e.childRowOffset);
  bending.sort((a, b) => yMin(a) - yMin(b));

  const trackEnds: number[] = [];
  for (const e of bending) {
    let assigned = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t]! < yMin(e)) {
        trackEnds[t] = yMax(e);
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackEnds.push(yMax(e));
      assigned = trackEnds.length - 1;
    }
    e.track = assigned;
  }
  return trackEnds.length;
}

function yMin(e: PlannedEdge): number {
  return Math.min(e.parentRowOffset, e.childRowOffset);
}

function yMax(e: PlannedEdge): number {
  return Math.max(e.parentRowOffset, e.childRowOffset);
}

export function materializeEdges(
  planned: PlannedEdge[],
  placements: Placement[],
  sizing: StripSizing,
): EdgeRoute[] {
  const placementByEntity = new Map(placements.map((p) => [p.entity, p]));

  return planned.map((p) => {
    const parentP = placementByEntity.get(p.ref.parent.entity)!;
    const childP = placementByEntity.get(p.ref.child.entity)!;

    const parentX = stripOffset(sizing.colStripWidths, sizing.channelColWidths, parentP.colStrip);
    const parentY = stripOffset(sizing.rowStripHeights, sizing.channelRowHeights, parentP.rowStrip);
    const childX = stripOffset(sizing.colStripWidths, sizing.channelColWidths, childP.colStrip);
    const childY = stripOffset(sizing.rowStripHeights, sizing.channelRowHeights, childP.rowStrip);
    const parentWidth = sizing.colStripWidths[parentP.colStrip]!;

    const parentRightX = parentX + parentWidth - 1;
    const childLeftX = childX;
    const parentPortY = parentY + p.parentRowOffset;
    const childPortY = childY + p.childRowOffset;

    const parentPort: Port = { x: parentRightX, y: parentPortY, side: 'right' };
    const childPort: Port = { x: childLeftX, y: childPortY, side: 'left' };

    const channelStartX = parentRightX + 1;

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
      // Asymmetric flush-to-parent-side: the bend's x sits at (channelStart + track).
      // This packs all routing tracks against the parent border, leaving the
      // visual-separation padding on the child side. CLAUDE.md: a future
      // symmetric mode would split padding evenly.
      const bendX = channelStartX + Math.max(0, p.track);
      segments = [
        { kind: 'horizontal', x1: channelStartX, y1: parentPortY, x2: bendX, y2: parentPortY },
        { kind: 'vertical', x1: bendX, y1: parentPortY, x2: bendX, y2: childPortY },
        { kind: 'horizontal', x1: bendX, y1: childPortY, x2: childLeftX - 1, y2: childPortY },
      ];
    }

    return { ref: p.ref, parentPort, childPort, segments };
  });
}

function stripOffset(strips: number[], channels: number[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += strips[i]!;
    if (i < channels.length) offset += channels[i]!;
  }
  return offset;
}
