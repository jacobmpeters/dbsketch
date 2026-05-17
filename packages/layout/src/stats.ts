import type { EdgeSegment, Layout } from './types.js';

// Quality metrics for the rendered routing. Both are load-bearing —
// crossings is the structural intersection count; totalVLength captures
// how compact the routing is (shorter V's = fewer rows bent through,
// less visual weight, less chance of unrelated crossings).
//
// Earlier adjacency predicates (bendAdjacent, portAdjacent) measured
// visual clustering rather than structural cost and were dropped: they
// didn't move when reorder shortened V's, and an optimization that
// drove them down (channel padding) added dead space without reducing
// crossings.
export interface RouteStats {
  // Pairs (H of edge A, V of edge B, edges in different bundles) where
  // A's H runs at y=Y and B's V passes through y=Y strictly inside A's
  // H range. Bundled trunks dedupe by exact endpoints so a single
  // rendered crossing on a shared trunk isn't counted per bundle member.
  crossings: number;
  // Sum of |yMax - yMin| across unique V trunks (deduped by x). Straight
  // edges contribute 0; the longer a V, the more rows it visually bends
  // through and the more likely it is to be crossed by some H. A direct
  // measure of routing compactness.
  totalVLength: number;
}

interface HTrunk {
  y: number;
  xMin: number;
  xMax: number;
  edgeIdxs: Set<number>;
}

interface VTrunk {
  x: number;
  yMin: number;
  yMax: number;
  edgeIdxs: Set<number>;
}

interface Trunks {
  h: HTrunk[];
  v: VTrunk[];
}

export function routeStats(layout: Layout): RouteStats {
  const trunks = collectTrunks(layout);
  return {
    crossings: countCrossings(trunks),
    totalVLength: countTotalVLength(trunks),
  };
}

// Dedupe segments by exact endpoints. Parent-side bundling produces
// identical H1's (port → shared trunk) for every bundle member, and a
// shared V trunk is recorded once per member; without dedup we'd count
// a single rendered glyph N times where N is the bundle size.
function collectTrunks(layout: Layout): Trunks {
  const hMap = new Map<string, HTrunk>();
  const vMap = new Map<string, VTrunk>();
  for (let i = 0; i < layout.edges.length; i++) {
    for (const s of layout.edges[i]!.segments) {
      addSegment(s, i, hMap, vMap);
    }
  }
  return { h: [...hMap.values()], v: [...vMap.values()] };
}

function addSegment(
  s: EdgeSegment,
  edgeIdx: number,
  hMap: Map<string, HTrunk>,
  vMap: Map<string, VTrunk>,
): void {
  if (s.kind === 'horizontal') {
    const xMin = Math.min(s.x1, s.x2);
    const xMax = Math.max(s.x1, s.x2);
    const key = `${s.y1}|${xMin}|${xMax}`;
    const existing = hMap.get(key);
    if (existing) existing.edgeIdxs.add(edgeIdx);
    else hMap.set(key, { y: s.y1, xMin, xMax, edgeIdxs: new Set([edgeIdx]) });
  } else {
    const yMin = Math.min(s.y1, s.y2);
    const yMax = Math.max(s.y1, s.y2);
    const key = `${s.x1}|${yMin}|${yMax}`;
    const existing = vMap.get(key);
    if (existing) existing.edgeIdxs.add(edgeIdx);
    else vMap.set(key, { x: s.x1, yMin, yMax, edgeIdxs: new Set([edgeIdx]) });
  }
}

function countCrossings({ h: hTrunks, v: vTrunks }: Trunks): number {
  let count = 0;
  for (const h of hTrunks) {
    for (const v of vTrunks) {
      // Skip when H and V share any edge — the H is part of the same edge
      // as the V (its own corner), or part of the same bundle (no rendered
      // crossing since they share the trunk).
      let sameBundle = false;
      for (const idx of h.edgeIdxs) {
        if (v.edgeIdxs.has(idx)) {
          sameBundle = true;
          break;
        }
      }
      if (sameBundle) continue;
      // Strict interior on both axes. Endpoints of an H sit on corner cells
      // where a perpendicular V terminates; touching there is a corner, not
      // a crossing.
      if (v.x <= h.xMin || v.x >= h.xMax) continue;
      if (h.y <= v.yMin || h.y >= v.yMax) continue;
      count++;
    }
  }
  return count;
}

function countTotalVLength({ v: vTrunks }: Trunks): number {
  let total = 0;
  for (const v of vTrunks) total += v.yMax - v.yMin;
  return total;
}
