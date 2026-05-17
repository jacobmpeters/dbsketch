import type { Layout, StripSizing } from './types.js';

// Routing-density predicates. Each fires when the rendered output puts
// distinct routing glyphs (bends, passes-through, ports) so close together
// that they visually fuse — `╮╮`, `╭│┤`, etc. These don't affect
// correctness; they're regression metrics for proposed channel-padding
// optimizations.
export interface RouteStats {
  // Two bend cells in the same col-channel at the same y with adjacent
  // x (|∆x| = 1). Produces fused corner clusters like `╮╮`/`╭╯`.
  bendAdjacent: number;
  // A V segment in a col-channel whose y-range covers a row where another
  // edge has a port on an entity adjacent to that channel. Produces
  // `╭│┤`-style clusters at port boundaries.
  portAdjacent: number;
}

interface ChannelRange {
  start: number;
  end: number;
}

// A "trunk" is the unique rendered V at (channel, x). When bundling fuses
// multiple planned edges onto the same track, they collapse into one trunk
// here; edgeIdxs holds the set of member edges so we can recognize a port
// as belonging to "this trunk's own bundle" vs. a foreign edge.
interface VInfo {
  channel: number;
  x: number;
  yMin: number;
  yMax: number;
  edgeIdxs: Set<number>;
}

interface PortInfo {
  edgeIdx: number;
  channel: number;
  // Cell x of the entity border the port sits on; used to measure how close
  // a passing V is to the visible boundary.
  x: number;
  y: number;
}

// A V at track 0 or 1 is 1–2 cells from the entity border — close enough
// that its glyph visually fuses with the port. Beyond that, the gap reads
// as breathing room and the eye no longer registers the convergence.
const PORT_PROXIMITY = 2;

export function routeStats(layout: Layout): RouteStats {
  const channelRanges = computeChannelRanges(layout.sizing);
  const colStripByEntity = new Map<string, number>();
  for (const p of layout.placements) colStripByEntity.set(p.entity, p.colStrip);

  // Bundled edges share one rendered V trunk at the same (channel, x). Group
  // each edge's V segments into a single trunk, unioning y-range and the set
  // of member edge indices, so each trunk counts once and a member's own port
  // doesn't get flagged as "another edge's port" against its own trunk.
  const trunks = new Map<string, VInfo>();
  const ports: PortInfo[] = [];

  for (let i = 0; i < layout.edges.length; i++) {
    const edge = layout.edges[i]!;
    const parentCol = colStripByEntity.get(edge.ref.parent.entity);
    const childCol = colStripByEntity.get(edge.ref.child.entity);
    if (parentCol === undefined || childCol === undefined) continue;

    ports.push({
      edgeIdx: i,
      channel: edge.parentPort.side === 'right' ? parentCol : parentCol - 1,
      x: edge.parentPort.x,
      y: edge.parentPort.y,
    });
    ports.push({
      edgeIdx: i,
      channel: edge.childPort.side === 'right' ? childCol : childCol - 1,
      x: edge.childPort.x,
      y: edge.childPort.y,
    });

    for (const seg of edge.segments) {
      if (seg.kind !== 'vertical') continue;
      const channel = findChannelByX(channelRanges, seg.x1);
      if (channel < 0) continue;
      const yMin = Math.min(seg.y1, seg.y2);
      const yMax = Math.max(seg.y1, seg.y2);
      const key = `${channel}|${seg.x1}`;
      const existing = trunks.get(key);
      if (existing) {
        existing.yMin = Math.min(existing.yMin, yMin);
        existing.yMax = Math.max(existing.yMax, yMax);
        existing.edgeIdxs.add(i);
      } else {
        trunks.set(key, { channel, x: seg.x1, yMin, yMax, edgeIdxs: new Set([i]) });
      }
    }
  }

  const trunkList = [...trunks.values()];
  return {
    bendAdjacent: countBendAdjacent(trunkList),
    portAdjacent: countPortAdjacent(trunkList, ports),
  };
}

function countBendAdjacent(trunks: VInfo[]): number {
  const bendXsByKey = new Map<string, Set<number>>();
  for (const t of trunks) {
    for (const y of [t.yMin, t.yMax]) {
      const key = `${t.channel}|${y}`;
      const bucket = bendXsByKey.get(key);
      if (bucket) bucket.add(t.x);
      else bendXsByKey.set(key, new Set([t.x]));
    }
  }
  let count = 0;
  for (const xs of bendXsByKey.values()) {
    if (xs.size < 2) continue;
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! === 1) count++;
    }
  }
  return count;
}

function countPortAdjacent(trunks: VInfo[], ports: PortInfo[]): number {
  const portsByChannel = new Map<number, PortInfo[]>();
  for (const p of ports) {
    const bucket = portsByChannel.get(p.channel);
    if (bucket) bucket.push(p);
    else portsByChannel.set(p.channel, [p]);
  }
  let count = 0;
  for (const t of trunks) {
    const channelPorts = portsByChannel.get(t.channel);
    if (!channelPorts) continue;
    for (const p of channelPorts) {
      if (t.edgeIdxs.has(p.edgeIdx)) continue;
      if (p.y < t.yMin || p.y > t.yMax) continue;
      if (Math.abs(t.x - p.x) > PORT_PROXIMITY) continue;
      count++;
    }
  }
  return count;
}

function computeChannelRanges(sizing: StripSizing): ChannelRange[] {
  const ranges: ChannelRange[] = [];
  let x = 0;
  for (let i = 0; i < sizing.colStripWidths.length; i++) {
    x += sizing.colStripWidths[i]!;
    if (i < sizing.colStripWidths.length - 1) {
      const w = sizing.channelColWidths[i] ?? 0;
      ranges.push({ start: x, end: x + w });
      x += w;
    }
  }
  return ranges;
}

function findChannelByX(ranges: ChannelRange[], x: number): number {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (x >= r.start && x < r.end) return i;
  }
  return -1;
}
