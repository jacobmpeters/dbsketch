import type { Entity, IR, Ref } from '@dbsketch/parser';
import { type EntityPositions, entityYBase, relativeEntityYs } from './positions.js';
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
  // -1 if to the left (only possible with center placement),
  // 0 for same-col edges (parent and child in the same col-strip).
  // Routing mirrors based on the sign; materializeSameCol ignores direction.
  direction: 1 | -1 | 0;
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
  // Which margin the H2 routes through. 'top' is the historical default
  // (above all entities); 'bottom' detours below; 'local' uses a spine
  // row close to the parent (an empty row between entities, found
  // opportunistically). Picked per-edge to minimize total V length.
  detourSide: 'top' | 'bottom' | 'local';
  // When detourSide === 'local', the Y (in relative canvas coordinates,
  // matching entityYs) where the H2 trunk runs. Materialize adds yBase
  // to convert to absolute canvas Y.
  detourSpineY?: number;
}

// Same-col edges: parent and child sit in the same col-strip (different
// rows). Covers self-FKs (e.g., departments.parent_dept_id → departments.id)
// and the user-pinned case where two related entities share a column.
// Path: leaves entity on one side, V down/up through the adjacent
// col-channel, returns on the same side. Side is 'right' when there's a
// col-channel to the right of the shared col; falls back to 'left' for
// the rightmost col.
export interface SameColPlannedEdge extends BasePlannedEdge {
  kind: 'same-col';
  channelIndex: number;
  side: 'left' | 'right';
  track: number;
}

export type PlannedEdge = SingleHopPlannedEdge | MultiHopPlannedEdge | SameColPlannedEdge;

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
  // Highest col-strip index in use; needed to decide which side a same-col
  // edge routes around (right by default, left when no channel exists right).
  const maxColStrip = placements.reduce((m, p) => Math.max(m, p.colStrip), 0);

  // Count cross-col edges through each channel so same-col edges can be
  // steered toward the less-congested adjacent side. Same-col refs contribute
  // nothing here (lo === hi, loop body never runs), so the counts reflect
  // only the cross-col load competing for each channel's tracks.
  const channelLoad = new Map<number, number>();
  for (const ref of ir.refs) {
    const pp = placementByEntity.get(ref.parent.entity);
    const cp = placementByEntity.get(ref.child.entity);
    if (!pp || !cp) continue;
    const lo = Math.min(pp.colStrip, cp.colStrip);
    const hi = Math.max(pp.colStrip, cp.colStrip);
    for (let ch = lo; ch < hi; ch++) {
      channelLoad.set(ch, (channelLoad.get(ch) ?? 0) + 1);
    }
  }

  const planned: PlannedEdge[] = [];
  const skippedRefs: Ref[] = [];
  for (const ref of ir.refs) {
    const fit = tryPlan(ref, placementByEntity, entityByName, maxColStrip, channelLoad);
    if (fit) planned.push(fit);
    else skippedRefs.push(ref);
  }

  // V-interval packing uses per-col-stacked Y positions (matching what the
  // renderer will actually produce) instead of strip-derived Y. The two
  // diverge whenever entities in a col are shorter than the strip is tall;
  // strip-derived intervals inflate, producing wrong track assignments.
  const entityYs = relativeEntityYs(ir, placements);
  // Per-multi-hop choice of top vs bottom margin. Decision uses relative Y
  // (entityYs) so it runs before margin sizing — packing then splits by
  // side. Has to come before packRowChannels so each side packs its own
  // tracks independently.
  assignDetourSides(planned, entityYs);
  // Opportunistically replace margin routing with a local spine row close
  // to the parent entity when an empty row exists across the bundle's H2
  // x-range. Bundles that can't find a clear spine keep their assigned
  // top/bottom margin.
  assignLocalSpines(planned, placements, ir, entityYs);
  const rowChannelTrackCounts = packRowChannels(planned);
  const channelTrackCounts = packColChannels(planned, entityYs);

  return { planned, skippedRefs, channelTrackCounts, rowChannelTrackCounts };
}

// Row offset of an FK port within its entity box. Regular entities have
// per-column rows starting at row 3 (top + name + separator); compact
// entities (zero columns, via showColumns:false) collapse every FK to the
// name row (row 1). Returns null if the column name is unknown for a
// non-compact entity — that's a malformed ref the caller should skip.
function compactRowOffset(entity: Entity, columnName: string): number | null {
  if (entity.columns.length === 0) return 1;
  const idx = entity.columns.findIndex((c) => c.name === columnName);
  if (idx === -1) return null;
  return 3 + idx;
}

function tryPlan(
  ref: Ref,
  placementByEntity: Map<string, Placement>,
  entityByName: Map<string, Entity>,
  maxColStrip: number,
  channelLoad: Map<number, number>,
): PlannedEdge | null {
  if (ref.cardinality === 'many-to-many') return null;

  const parentP = placementByEntity.get(ref.parent.entity);
  const childP = placementByEntity.get(ref.child.entity);
  if (!parentP || !childP) return null;

  const parentEntity = entityByName.get(ref.parent.entity);
  const childEntity = entityByName.get(ref.child.entity);
  if (!parentEntity || !childEntity) return null;

  // Compact entities (zero columns) use a fixed name-row port (row offset 1)
  // for every FK, since there are no column rows to attach to. Regular
  // entities look up the column by name and use row offset 3 + colIdx.
  const parentRowOffset = compactRowOffset(parentEntity, ref.parent.column);
  const childRowOffset = compactRowOffset(childEntity, ref.child.column);
  if (parentRowOffset === null || childRowOffset === null) return null;

  const colDiff = childP.colStrip - parentP.colStrip;
  const direction: 1 | -1 | 0 = colDiff > 0 ? 1 : colDiff < 0 ? -1 : 0;
  const absDiff = Math.abs(colDiff);

  const base: BasePlannedEdge = {
    ref,
    parentColStrip: parentP.colStrip,
    childColStrip: childP.colStrip,
    parentRowStrip: parentP.rowStrip,
    childRowStrip: childP.rowStrip,
    parentRowOffset,
    childRowOffset,
    direction,
  };

  if (colDiff === 0) {
    // Same-col edge: parent and child in same col-strip. Self-FKs land here
    // too (parent.entity === child.entity → same Placement). Endpoints must
    // be at different y positions; a ref to the same column of the same
    // entity has nothing to draw.
    if (parentP.rowStrip === childP.rowStrip && parentRowOffset === childRowOffset) {
      return null;
    }
    // Route through whichever adjacent channel has fewer cross-col edges
    // already assigned, keeping same-col edges off the busy side. Fall back
    // to left when no right channel exists, and to right when no left channel.
    const col = parentP.colStrip;
    const leftLoad = col > 0 ? (channelLoad.get(col - 1) ?? 0) : Infinity;
    const rightLoad = col < maxColStrip ? (channelLoad.get(col) ?? 0) : Infinity;
    const side: 'left' | 'right' = leftLoad <= rightLoad ? 'left' : 'right';
    const channelIndex = side === 'right' ? col : col - 1;
    if (channelIndex < 0) return null; // single-col diagram: nowhere to route
    return {
      kind: 'same-col',
      ...base,
      channelIndex,
      side,
      track: -1,
    };
  }

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
  // V2 in the channel adjacent to child on the parent side, H2 in a margin
  // (top or bottom, picked later by assignDetourSides based on entity Y).
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
    detourSide: 'top',
  };
}

// For each multi-hop, pick whichever margin (top or bottom) gives a shorter
// total V (V1 + V2). A multi-hop routes top by default — the historical
// behavior — but flips to bottom when both endpoints sit in the lower half
// of the diagram. The midpoint check uses the entity tops in entityYs (a
// rough proxy for "where the edge's interesting endpoints sit"); the exact
// midpoint of the diagram is the largest entityY (the bottom-most entity's
// top). Tied or empty → top.
// Per-col Y occupancy: for each col-strip index, the set of Y rows occupied
// by any entity in that column. Used by spine-row search to find empty Ys
// where an H2 trunk can route close to its parent entity.
function buildColOccupancy(
  placements: Placement[],
  ir: IR,
  entityYs: Map<string, number>,
): Map<number, Set<number>> {
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));
  const occupancy = new Map<number, Set<number>>();
  for (const p of placements) {
    const entity = entitiesByName.get(p.entity);
    if (!entity) continue;
    const y = entityYs.get(p.entity);
    if (y === undefined) continue;
    const h = entity.columns.length === 0 ? 3 : 4 + entity.columns.length;
    let set = occupancy.get(p.colStrip);
    if (!set) {
      set = new Set();
      occupancy.set(p.colStrip, set);
    }
    for (let row = y; row < y + h; row++) set.add(row);
  }
  return occupancy;
}

// Find a spine Y (an empty row in every col the bundle's H2 spans) close
// to the parent entity. Tries the row just below the parent's bottom
// border first, then just above, then expanding outward by a few rows
// (capped to avoid drifting all the way to a margin). Returns null when
// no clear Y exists within the search window — the bundle falls back to
// its already-assigned top/bottom margin in that case.
//
// claimedRanges records the H2 x-ranges already placed at each spine Y
// by earlier bundles. A candidate Y is rejected if a previous bundle's
// trunk overlaps this bundle's x-range; otherwise the bundle's range is
// added and the Y is reused. This is interval scheduling across Ys,
// letting multiple bundles share spine rows when their H2's don't
// overlap (the symmetric mirror of how margins already pack tracks).
const SPINE_SEARCH_RADIUS = 8;
function findSpineY(
  parentY: number,
  parentHeight: number,
  colRange: { min: number; max: number },
  occupancy: Map<number, Set<number>>,
  claimedRanges: Map<number, Array<{ xMin: number; xMax: number }>>,
): number | null {
  const isClearOfEntities = (y: number): boolean => {
    if (y < 0) return false;
    for (let c = colRange.min; c <= colRange.max; c++) {
      if (occupancy.get(c)?.has(y)) return false;
    }
    return true;
  };
  const isClearOfOtherTrunks = (y: number): boolean => {
    const list = claimedRanges.get(y);
    if (!list) return true;
    for (const r of list) {
      if (r.xMin <= colRange.max && r.xMax >= colRange.min) return false;
    }
    return true;
  };
  // Y values to try, in preference order: just below parent (closest to
  // parent's bottom port), then just above, then expanding by one each
  // direction. Below-first prefers the visual "branches descend" idiom
  // that maps well to a column-strip hub layout.
  const yBelow = parentY + parentHeight;
  const yAbove = parentY - 1;
  for (let d = 0; d < SPINE_SEARCH_RADIUS; d++) {
    const below = yBelow + d;
    if (isClearOfEntities(below) && isClearOfOtherTrunks(below)) return below;
    const above = yAbove - d;
    if (isClearOfEntities(above) && isClearOfOtherTrunks(above)) return above;
  }
  return null;
}

// For each parent-side bundle of multi-hops, attempt to route the H2 through
// a local spine row near the parent entity instead of a global top/bottom
// margin. Bundles whose H2 spans cols where no clear Y exists within the
// search window stay on their assigned margin.
//
// Spine-row tracks aren't currently shared between bundles — each chosen
// spine Y gets used by exactly the bundle that picked it. Two bundles
// converging on the same Y would overlap; we conservatively let only the
// first one claim it.
function assignLocalSpines(
  planned: PlannedEdge[],
  placements: Placement[],
  ir: IR,
  entityYs: Map<string, number>,
): void {
  const occupancy = buildColOccupancy(placements, ir, entityYs);
  const placementByEntity = new Map(placements.map((p) => [p.entity, p]));
  const entitiesByName = new Map(ir.entities.map((e) => [e.name, e]));

  // Group multi-hops by parent-side bundle (same key the parent-side V1
  // bundling uses).
  const bundles = new Map<string, MultiHopPlannedEdge[]>();
  for (const e of planned) {
    if (e.kind !== 'multi') continue;
    const key = `${e.parentChannelIndex}|${e.direction}|${e.ref.parent.entity}|${e.ref.parent.column}`;
    let bucket = bundles.get(key);
    if (!bucket) {
      bucket = [];
      bundles.set(key, bucket);
    }
    bucket.push(e);
  }

  const claimedRanges = new Map<number, Array<{ xMin: number; xMax: number }>>();
  const claim = (
    spineY: number,
    range: { xMin: number; xMax: number },
    target: MultiHopPlannedEdge[],
  ): void => {
    let list = claimedRanges.get(spineY);
    if (!list) {
      list = [];
      claimedRanges.set(spineY, list);
    }
    list.push(range);
    for (const m of target) {
      m.detourSide = 'local';
      m.detourSpineY = spineY;
      m.detourRowChannel = spineY;
    }
  };

  // Pass 1 — bundle-level: try to find one spine Y that works across every
  // member's col-range. When all members share a spine, the H2 renders as
  // a single trunk with V2's branching south — the cleanest output.
  const unclaimed: MultiHopPlannedEdge[] = [];
  for (const [, members] of [...bundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = members[0]!;
    const parent = placementByEntity.get(first.ref.parent.entity);
    const parentEntity = entitiesByName.get(first.ref.parent.entity);
    if (!parent || !parentEntity) {
      unclaimed.push(...members);
      continue;
    }
    const parentY = entityYs.get(first.ref.parent.entity);
    if (parentY === undefined) {
      unclaimed.push(...members);
      continue;
    }
    const parentHeight = parentEntity.columns.length === 0 ? 3 : 4 + parentEntity.columns.length;

    // H2 spans col-strips from leftmost to rightmost across all members.
    let minCol = first.parentColStrip;
    let maxCol = first.parentColStrip;
    for (const m of members) {
      minCol = Math.min(minCol, m.parentColStrip, m.childColStrip);
      maxCol = Math.max(maxCol, m.parentColStrip, m.childColStrip);
    }

    const spineY = findSpineY(
      parentY,
      parentHeight,
      { min: minCol, max: maxCol },
      occupancy,
      claimedRanges,
    );
    if (spineY === null) {
      unclaimed.push(...members);
      continue;
    }
    claim(spineY, { xMin: minCol, xMax: maxCol }, members);
  }

  // Pass 2 — per-edge: for multi-hops whose bundle couldn't find a shared
  // spine (typically because some member's child is far from the bundle's
  // dominant column range), retry individually with each edge's own narrow
  // col-range. The bundle's V1 trunk still consolidates on the parent side
  // — these per-edge spines just exit the trunk at their own Y instead of
  // detouring all the way to a margin.
  for (const edge of unclaimed) {
    const parentEntity = entitiesByName.get(edge.ref.parent.entity);
    if (!parentEntity) continue;
    const parentY = entityYs.get(edge.ref.parent.entity);
    if (parentY === undefined) continue;
    const parentHeight = parentEntity.columns.length === 0 ? 3 : 4 + parentEntity.columns.length;
    const minCol = Math.min(edge.parentColStrip, edge.childColStrip);
    const maxCol = Math.max(edge.parentColStrip, edge.childColStrip);
    const spineY = findSpineY(
      parentY,
      parentHeight,
      { min: minCol, max: maxCol },
      occupancy,
      claimedRanges,
    );
    if (spineY === null) continue;
    claim(spineY, { xMin: minCol, xMax: maxCol }, [edge]);
  }
}

function assignDetourSides(planned: PlannedEdge[], entityYs: Map<string, number>): void {
  let maxY = 0;
  for (const y of entityYs.values()) maxY = Math.max(maxY, y);
  const diagramMid = maxY / 2;
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    const parentY = entityYs.get(edge.ref.parent.entity) ?? 0;
    const childY = entityYs.get(edge.ref.child.entity) ?? 0;
    const edgeMid = (parentY + childY) / 2;
    if (edgeMid > diagramMid) {
      edge.detourSide = 'bottom';
      edge.detourRowChannel = -2;
    }
  }
}

// Pack multi-hop H2 segments into y-tracks within the chosen margin. Each
// margin (top, key -1; bottom, key -2) packs independently. Multi-hops
// using a local spine row (detourSide === 'local') already have a specific
// Y assigned and don't share a margin — their detourTrack stays 0 since
// only one bundle is allowed per spine Y (assignLocalSpines enforces).
function packRowChannels(planned: PlannedEdge[]): Map<number, number> {
  const top: MultiHopPlannedEdge[] = [];
  const bottom: MultiHopPlannedEdge[] = [];
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    if (edge.detourSide === 'local') {
      edge.detourTrack = 0;
      continue;
    }
    (edge.detourSide === 'bottom' ? bottom : top).push(edge);
  }
  const counts = new Map<number, number>();
  if (top.length > 0) counts.set(-1, packRowChannel(top));
  if (bottom.length > 0) counts.set(-2, packRowChannel(bottom));
  return counts;
}

function packRowChannel(edges: MultiHopPlannedEdge[]): number {
  // Group multi-hops by their parent-side bundle key. All members of a
  // group will share a V1 trunk at one x (packColChannels enforces this
  // later via the same key); their H2 segments can therefore share one
  // top-margin track too, rendering as a single H trunk with south-going
  // tees where each V2 branches off. Without grouping, N edges from one
  // parent stack as N rows in the top margin — exactly the OMOP `person`
  // case where 7 outgoing multi-hops produced 7 stacked H's instead of
  // one trunk with 7 branches.
  interface Bundle {
    members: MultiHopPlannedEdge[];
    xMin: number;
    xMax: number;
  }
  const range = (e: MultiHopPlannedEdge): [number, number] => {
    const a = Math.min(e.parentColStrip, e.childColStrip);
    const b = Math.max(e.parentColStrip, e.childColStrip);
    return [a, b];
  };
  const bundleByKey = new Map<string, Bundle>();
  for (const e of edges) {
    const key = `${e.parentChannelIndex}|${e.direction}|${e.ref.parent.entity}|${e.ref.parent.column}`;
    const [xMin, xMax] = range(e);
    const existing = bundleByKey.get(key);
    if (existing) {
      existing.members.push(e);
      existing.xMin = Math.min(existing.xMin, xMin);
      existing.xMax = Math.max(existing.xMax, xMax);
    } else {
      bundleByKey.set(key, { members: [e], xMin, xMax });
    }
  }
  const bundles = [...bundleByKey.values()];
  // xMin asc + span desc tiebreak. With center placement edges can run
  // either direction, so compare on min/max col rather than parent/child.
  bundles.sort((a, b) => {
    if (a.xMin !== b.xMin) return a.xMin - b.xMin;
    return b.xMax - b.xMin - (a.xMax - a.xMin);
  });
  const trackEnds: number[] = [];
  for (const bundle of bundles) {
    let assigned = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t]! < bundle.xMin) {
        trackEnds[t] = bundle.xMax;
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackEnds.push(bundle.xMax);
      assigned = trackEnds.length - 1;
    }
    for (const m of bundle.members) m.detourTrack = assigned;
  }
  return trackEnds.length;
}

interface VEntry {
  yMin: number;
  yMax: number;
  // Y of the V's source-side endpoint — parent port for single-hop and
  // multi-hop V1, detour Y for multi-hop V2. null for same-col (no
  // source/target distinction). Used by the zone analysis to tell apart
  // source-trapped from target-trapped V's.
  sourceY: number | null;
  // +1 if the V's edge runs forward (parent west of channel), -1 if backward
  // (parent east), 0 if direction is meaningless (same-col). Used to decide
  // whether to reverse track indices after FFD so that track 0 always lands
  // on the source side of the channel.
  direction: 1 | -1 | 0;
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
function packColChannels(
  planned: PlannedEdge[],
  entityYs: Map<string, number>,
): Map<number, number> {
  // Y coordinate of an edge endpoint in the relative space used for V-
  // interval packing. The top margin sits at y < 0 from the entity-space
  // perspective; the bottom margin sits beyond any entity's Y. We pick
  // sentinel values on either side of the entity Y range so V intervals
  // pack correctly regardless of which margin a multi-hop chose.
  const endpointY = (entity: string, rowOffset: number): number =>
    (entityYs.get(entity) ?? 0) + rowOffset;
  let maxRelY = 0;
  for (const y of entityYs.values()) maxRelY = Math.max(maxRelY, y);
  // 8 = a comfortable overshoot past the tallest entity's bottom; the value
  // only needs to be greater than any entityY + entityHeight, and interval
  // scheduling doesn't care about exact magnitudes for the bottom side.
  const bottomDetourBase = maxRelY + 8;
  const detourY = (edge: MultiHopPlannedEdge): number => {
    if (edge.detourSide === 'local' && edge.detourSpineY !== undefined) {
      return edge.detourSpineY;
    }
    const t = Math.max(0, edge.detourTrack);
    return edge.detourSide === 'bottom' ? bottomDetourBase + t : -1 - t;
  };

  const byChannel = new Map<number, VEntry[]>();
  const add = (channel: number, entry: VEntry): void => {
    let bucket = byChannel.get(channel);
    if (!bucket) {
      bucket = [];
      byChannel.set(channel, bucket);
    }
    bucket.push(entry);
  };

  // Parent-side bundles: single-hop V's and multi-hop V1's that originate
  // at the same (channel, direction, parent_entity, parent_column) share
  // one V trunk. The trunk's y-range is the union of all members'
  // endpoints: V1 members pull the trunk *up* toward their detour Y,
  // single-hop members pull it *down* toward their child Y. Both branch
  // east off the trunk (single-hop at the child row, V1 at the detour
  // row), so they meet at the parent port without needing separate tracks.
  // Crucial when a hub entity has both an adjacent and a non-adjacent
  // child off the same PK — saves a track and removes the H1×V crossing
  // you'd otherwise get at the parent row.
  type ParentMember =
    | { kind: 'single'; edge: SingleHopPlannedEdge }
    | { kind: 'v1'; edge: MultiHopPlannedEdge };
  const parentBundles = new Map<string, ParentMember[]>();
  const pushMember = (key: string, member: ParentMember): void => {
    let bucket = parentBundles.get(key);
    if (!bucket) {
      bucket = [];
      parentBundles.set(key, bucket);
    }
    bucket.push(member);
  };
  for (const edge of planned) {
    if (edge.kind === 'single') {
      const py = endpointY(edge.ref.parent.entity, edge.parentRowOffset);
      const cy = endpointY(edge.ref.child.entity, edge.childRowOffset);
      if (py === cy) continue; // straight: no V segment, no track needed
      const key = `${edge.channelIndex}|${edge.direction}|${edge.ref.parent.entity}|${edge.ref.parent.column}`;
      pushMember(key, { kind: 'single', edge });
    } else if (edge.kind === 'multi') {
      const key = `${edge.parentChannelIndex}|${edge.direction}|${edge.ref.parent.entity}|${edge.ref.parent.column}`;
      pushMember(key, { kind: 'v1', edge });
    }
  }
  // Backward single-hop parent bundles that a same-col edge can merge into.
  // Key: `${channelIndex}|${parentEntity}|${parentColumn}`.
  const backwardBundleVEntries = new Map<string, VEntry>();

  for (const [, members] of [...parentBundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = members[0]!;
    const channel =
      first.kind === 'single' ? first.edge.channelIndex : first.edge.parentChannelIndex;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      const py = endpointY(m.edge.ref.parent.entity, m.edge.parentRowOffset);
      yMin = Math.min(yMin, py);
      yMax = Math.max(yMax, py);
      if (m.kind === 'single') {
        const cy = endpointY(m.edge.ref.child.entity, m.edge.childRowOffset);
        yMin = Math.min(yMin, cy);
        yMax = Math.max(yMax, cy);
      } else {
        const dy = detourY(m.edge);
        yMin = Math.min(yMin, dy);
        yMax = Math.max(yMax, dy);
      }
    }
    const sourceY = endpointY(first.edge.ref.parent.entity, first.edge.parentRowOffset);
    const vEntry: VEntry = {
      yMin,
      yMax,
      sourceY,
      direction: first.edge.direction,
      assign: (t) => {
        for (const m of members) {
          if (m.kind === 'single') m.edge.track = t;
          else m.edge.parentTrack = t;
        }
      },
    };
    add(channel, vEntry);
    // Register backward single-hop bundles so same-col edges sharing the same
    // parent port can merge into this trunk instead of getting a separate track.
    if (first.edge.direction === -1 && members.every((m) => m.kind === 'single')) {
      backwardBundleVEntries.set(
        `${channel}|${first.edge.ref.parent.entity}|${first.edge.ref.parent.column}`,
        vEntry,
      );
    }
  }
  // Child-side V2 bundles: multi-hop V2's that terminate at the same
  // (channel, direction, child_entity, child_column) share one V trunk.
  // Each member's H2 ends at the bundled V2's x, and the trunk descends
  // through every member's detour Y down to the child port — symmetric
  // mirror of the parent-side V1 bundling above. Crucial when many
  // tables FK to one shared target (OMOP's `concept`, `person`, etc.):
  // without this, each multi-hop targeting the hub gets its own V2 at a
  // distinct x in the hub-adjacent channel.
  const childBundles = new Map<string, MultiHopPlannedEdge[]>();
  for (const edge of planned) {
    if (edge.kind !== 'multi') continue;
    const key = `${edge.childChannelIndex}|${edge.direction}|${edge.ref.child.entity}|${edge.ref.child.column}`;
    let bucket = childBundles.get(key);
    if (!bucket) {
      bucket = [];
      childBundles.set(key, bucket);
    }
    bucket.push(edge);
  }
  for (const [, members] of [...childBundles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = members[0]!;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      const cy = endpointY(m.ref.child.entity, m.childRowOffset);
      const dy = detourY(m);
      yMin = Math.min(yMin, dy, cy);
      yMax = Math.max(yMax, dy, cy);
    }
    // Source side of every V2 is the detour Y (its margin). Any member's
    // detour Y works as a representative — top-margin members' Y outranks
    // every entity Y from below, bottom-margin members' from above, so
    // the zone classifier treats the bundle consistently with where it
    // actually sits.
    const sourceY = detourY(first);
    add(first.childChannelIndex, {
      yMin,
      yMax,
      sourceY,
      direction: first.direction,
      assign: (t) => {
        for (const m of members) m.childTrack = t;
      },
    });
  }

  // Same-col edges: independent V per edge in the chosen side-channel, unless
  // the edge shares its parent port with a backward single-hop bundle in the
  // same channel (e.g. both encounter.provider_id and medication.prescriber_id
  // reference provider.id through the same channel). In that case, merge into
  // the backward bundle's trunk: extend the trunk's y-range and add this
  // edge's track assignment to the bundle's assign callback. The shared V
  // trunk eliminates the crossing the separate track would cause.
  for (const edge of planned) {
    if (edge.kind !== 'same-col') continue;
    const py = endpointY(edge.ref.parent.entity, edge.parentRowOffset);
    const cy = endpointY(edge.ref.child.entity, edge.childRowOffset);
    const mergeKey = `${edge.channelIndex}|${edge.ref.parent.entity}|${edge.ref.parent.column}`;
    const existing = backwardBundleVEntries.get(mergeKey);
    if (existing) {
      existing.yMin = Math.min(existing.yMin, py, cy);
      existing.yMax = Math.max(existing.yMax, py, cy);
      const prevAssign = existing.assign;
      existing.assign = (t) => {
        prevAssign(t);
        edge.track = t;
      };
    } else {
      add(edge.channelIndex, {
        yMin: Math.min(py, cy),
        yMax: Math.max(py, cy),
        // Same-col edges live in a side-channel; both ports are on the same
        // side of the entity, so source/target don't map to channel east/west.
        // Mark neutral so they don't pull the channel toward a reversal.
        sourceY: null,
        direction: 0,
        assign: (t) => {
          edge.track = t;
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

// Three-zone crossing-aware packing.
//
// FFD-by-yMin packs into the minimum track count but is blind to crossings.
// Two V's that overlap need different tracks; which side each V sits on
// determines whether their H1/H2 segments cross the other's column. The
// fix-up: classify each V by *which endpoint is trapped inside another V's
// range*:
//
//   - source-trapped only  → "lower" zone (track 0 = source-adjacent)
//   - target-trapped only  → "upper" zone (highest track = target-adjacent)
//   - both trapped         → "middle" zone (its own band between)
//   - neither              → "neutral", joins lower (any track is fine)
//
// Pack each zone independently with FFD; concatenate the track ranges. A V
// in the middle band can't intercept another V's H by construction (its H1
// reaches west into the lower zone, where the source-trapped V's H1 is also
// 0 cells; its H2 reaches east into the upper zone where target-trapped V's
// H2 is 0 cells). Cost: a middle-zone V adds one track to the channel that
// FFD-by-yMin would have skipped — that's the explicit trade-off, paying
// one column to remove unavoidable-otherwise crossings.
//
// Backward-dominant channels then reverse the final indices so track 0 is
// still source-adjacent in absolute (east/west) terms.
function packVEntries(entries: VEntry[]): number {
  type Zone = 'lower' | 'middle' | 'upper';
  const zones: Zone[] = entries.map((e, i) => {
    if (e.sourceY === null) return 'lower';
    const targetY = e.sourceY === e.yMin ? e.yMax : e.yMin;
    let sourceTrapped = false;
    let targetTrapped = false;
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      const o = entries[j]!;
      // Touching at a boundary doesn't cross — the cell at the boundary is
      // a corner glyph, not a V cell. Use strict <> so "overlap" matches
      // FFD's overlap test below.
      if (o.yMax <= e.yMin || o.yMin >= e.yMax) continue;
      if (e.sourceY > o.yMin && e.sourceY < o.yMax) sourceTrapped = true;
      if (targetY > o.yMin && targetY < o.yMax) targetTrapped = true;
    }
    if (sourceTrapped && targetTrapped) return 'middle';
    if (targetTrapped) return 'upper';
    // source-trapped or neutral both land here — neutral V's have no
    // alignment preference so they're harmless on the lower side.
    return 'lower';
  });

  // FFD-pack one zone's entries (in their original index order, sorted by
  // yMin for the greedy step). Returns track count for the zone and writes
  // each entry's track into the shared rawTracks array, offset by base.
  const rawTracks = new Array<number>(entries.length).fill(0);
  const packZone = (zone: Zone, base: number): number => {
    const indices: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (zones[i] === zone) indices.push(i);
    }
    indices.sort((a, b) => {
      const yMinDiff = entries[a]!.yMin - entries[b]!.yMin;
      if (yMinDiff !== 0) return yMinDiff;
      const aLen = entries[a]!.yMax - entries[a]!.yMin;
      const bLen = entries[b]!.yMax - entries[b]!.yMin;
      return bLen - aLen;
    });
    const trackEnds: number[] = [];
    for (const i of indices) {
      const e = entries[i]!;
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
      rawTracks[i] = base + assigned;
    }
    return trackEnds.length;
  };

  const lowerCount = packZone('lower', 0);
  const middleCount = packZone('middle', lowerCount);
  const upperCount = packZone('upper', lowerCount + middleCount);
  const totalTracks = lowerCount + middleCount + upperCount;

  // Same reversal rule as before: track 0 = west cell. That's source-side
  // for forward edges, target-side for backward. Flip backward-dominant
  // channels so the lower zone (source-adjacent in y-trap terms) maps to
  // source-adjacent in cell terms too. Mixed-direction channels (only with
  // @center placement) follow the majority.
  let fwd = 0;
  let bwd = 0;
  for (const e of entries) {
    if (e.direction === 1) fwd++;
    else if (e.direction === -1) bwd++;
  }
  const reverse = bwd > fwd && totalTracks > 1;
  for (let i = 0; i < entries.length; i++) {
    const raw = rawTracks[i]!;
    entries[i]!.assign(reverse ? totalTracks - 1 - raw : raw);
  }
  return totalTracks;
}

export function materializeEdges(
  planned: PlannedEdge[],
  placements: Placement[],
  sizing: StripSizing,
  entityPositions: EntityPositions,
  topMarginHeight: number,
): EdgeRoute[] {
  // First cell below every entity. The bottom margin's tracks start here:
  // detour-track 0 sits at bottomMarginBaseY, track 1 at +1, and so on.
  // 0 if there are no entities (nothing to size against).
  let bottomMarginBaseY = 0;
  for (const box of entityPositions.values()) {
    bottomMarginBaseY = Math.max(bottomMarginBaseY, box.y + box.height);
  }
  // Offset between relative Y (used during planning, including spine
  // assignment) and absolute Y (used during rendering). Local-spine
  // multi-hops store their detour Y in relative coords; add yBase here.
  const yBase = entityYBase(topMarginHeight);
  const channelLeftXs = buildChannelLeftXs(sizing);
  return planned.map((p) => {
    if (p.kind === 'single') return materializeSingleHop(p, channelLeftXs, entityPositions);
    if (p.kind === 'multi') {
      return materializeMultiHop(p, channelLeftXs, entityPositions, bottomMarginBaseY, yBase);
    }
    return materializeSameCol(p, channelLeftXs, entityPositions);
  });
}

function materializeSingleHop(
  p: SingleHopPlannedEdge,
  channelLeftXs: number[],
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
    // Straight horizontal segment spanning the two port cells. The renderer
    // skips a segment's endpoint cells (they're either corners or ports,
    // both filled by separate passes); including parent/child ports here
    // gives drawPortMarker the cells to overlay, and the interior covers
    // exactly the gap between the ports.
    const xLo = Math.min(parentPortX, childPortX);
    const xHi = Math.max(parentPortX, childPortX);
    segments = [{ kind: 'horizontal', x1: xLo, y1: parentPortY, x2: xHi, y2: parentPortY }];
  } else {
    // V tracks pack from the channel's left edge regardless of edge
    // direction. With mixed forward + backward edges in the same channel,
    // anchoring each to its own parent would map distinct track indices
    // to the same X cell (collision); a single anchor side avoids that.
    // Forward edges keep their original "flush to parent" placement;
    // backward edges land further from their parent than ideal but never
    // overlap a forward edge.
    const channelLeftX = channelLeftXs[p.channelIndex] ?? 0;
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
  channelLeftXs: number[],
  entityPositions: EntityPositions,
  bottomMarginBaseY: number,
  yBase: number,
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
  const v1ChannelLeftX = channelLeftXs[p.parentChannelIndex] ?? 0;
  const v1X = v1ChannelLeftX + Math.max(0, p.parentTrack);
  const v2ChannelLeftX = channelLeftXs[p.childChannelIndex] ?? 0;
  const v2X = v2ChannelLeftX + Math.max(0, p.childTrack);

  // H2 routes through the chosen margin or a local spine row. Top margin
  // sits above all entities starting at y=0; bottom margin starts at
  // bottomMarginBaseY (first cell below every entity); local spines store
  // a relative Y in detourSpineY (add yBase for absolute).
  let detourY: number;
  if (p.detourSide === 'local' && p.detourSpineY !== undefined) {
    detourY = p.detourSpineY + yBase;
  } else {
    const detourTrack = Math.max(0, p.detourTrack);
    detourY = p.detourSide === 'bottom' ? bottomMarginBaseY + detourTrack : detourTrack;
  }

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

function materializeSameCol(
  p: SameColPlannedEdge,
  channelLeftXs: number[],
  entityPositions: EntityPositions,
): EdgeRoute {
  const parentBox = entityPositions.get(p.ref.parent.entity)!;
  const childBox = entityPositions.get(p.ref.child.entity)!;

  // Both ports leave from the same side (the side facing the chosen
  // channel). The V travels through the adjacent channel and comes back.
  const portX = p.side === 'right' ? parentBox.x + parentBox.width - 1 : parentBox.x;
  const parentPortY = parentBox.y + p.parentRowOffset;
  const childPortY = childBox.y + p.childRowOffset;
  const portSide: Side = p.side;

  const channelLeftX = channelLeftXs[p.channelIndex] ?? 0;
  const bendX = channelLeftX + Math.max(0, p.track);

  const parentPort: Port = { x: portX, y: parentPortY, side: portSide };
  const childPort: Port = { x: portX, y: childPortY, side: portSide };

  // Include the port cells in H1/H3 so x2-x1 has a sign — corner glyph
  // selection at the bends works correctly. drawPortMarker repaints
  // the port cells last.
  const segments: EdgeSegment[] = [
    { kind: 'horizontal', x1: portX, y1: parentPortY, x2: bendX, y2: parentPortY },
    { kind: 'vertical', x1: bendX, y1: parentPortY, x2: bendX, y2: childPortY },
    { kind: 'horizontal', x1: bendX, y1: childPortY, x2: portX, y2: childPortY },
  ];

  return { ref: p.ref, parentPort, childPort, segments };
}

function buildChannelLeftXs(sizing: StripSizing): number[] {
  const xs: number[] = [];
  let x = 0;
  const n = sizing.channelColWidths.length + 1;
  for (let i = 0; i < n; i++) {
    x += sizing.colStripWidths[i] ?? 0;
    xs.push(x);
    x += sizing.channelColWidths[i] ?? 0;
  }
  return xs;
}
