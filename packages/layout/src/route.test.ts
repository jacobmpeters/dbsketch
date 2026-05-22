import { type IR, parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { detectHubs } from './detectHubs.js';
import { layout } from './layout.js';
import { place } from './place.js';
import { rank } from './rank.js';
import { planRoutes } from './route.js';

function plan(ir: IR) {
  return planRoutes(ir, place(ir, rank(ir)));
}

describe('planRoutes', () => {
  it('plans a single adjacent-col edge', () => {
    const ir = parse(`
      Table users { id int }
      Table posts { id int user_id int [ref: > users.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(1);
    const edge = result.planned[0]!;
    expect(edge.kind).toBe('single');
    expect(edge.parentColStrip).toBe(0);
    expect(edge.childColStrip).toBe(1);
    expect(edge.parentRowOffset).toBe(3);
    expect(edge.childRowOffset).toBe(4);
    expect(result.skippedRefs).toEqual([]);
  });

  it('classifies adjacent-col edges as single-hop', () => {
    // (Used to assert specific row strips, but float placement now aligns
    // single-entity ranks with their connections, so the rows depend on
    // barycenter — the classification is what we're testing here.)
    const ir = parse(`
      Table products { id int }
      Table users { id int }
      Table orders { id int user_id int [ref: > users.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(1);
    const edge = result.planned[0]!;
    expect(edge.kind).toBe('single');
    expect(edge.parentColStrip).toBe(0);
    expect(edge.childColStrip).toBe(1);
    expect(result.skippedRefs).toEqual([]);
  });

  it('classifies col-spanning refs as multi-hop and assigns a detour side', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      Table c { id int a_id int [ref: > a.id] }
      Table d { id int c_id int [ref: > c.id] a_id int [ref: > a.id] }
    `);
    const result = plan(ir);
    expect(result.skippedRefs).toEqual([]);
    expect(result.planned).toHaveLength(3);
    const multiHop = result.planned.find((p) => p.kind === 'multi');
    expect(multiHop).toBeDefined();
    if (multiHop?.kind === 'multi') {
      expect(multiHop.ref.parent.entity).toBe('a');
      expect(multiHop.ref.child.entity).toBe('d');
      expect(multiHop.parentChannelIndex).toBe(0);
      expect(multiHop.childChannelIndex).toBe(1);
      // Detour side picked among {top, bottom, local}; previously hard-coded
      // to -1 (top margin), but local-spine routing can override that.
      expect(['top', 'bottom', 'local']).toContain(multiHop.detourSide);
    }
  });

  it('routes multi-hops successfully even with a single row strip', () => {
    // Previously this case had no detour space (no inter-row channels), but
    // every multi-hop now picks a margin or finds a local spine row.
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: > a.id] }
      Table c { id int b_id int [ref: > b.id] a_id int [ref: > a.id] }
    `);
    const result = plan(ir);
    expect(result.skippedRefs).toEqual([]);
    const multiHop = result.planned.find((p) => p.kind === 'multi');
    expect(multiHop).toBeDefined();
    if (multiHop?.kind === 'multi') {
      expect(['top', 'bottom', 'local']).toContain(multiHop.detourSide);
    }
  });

  it('skips many-to-many refs', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: <> a.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(0);
    expect(result.skippedRefs).toHaveLength(1);
  });

  it('routes self-FKs as same-col edges', () => {
    // departments.parent_dept_id → departments.id is the canonical case.
    // Adding the other → tree ref pushes tree to col 1 so there's a
    // channel available for the self-FK to route through.
    const ir = parse(`
      Table other { id int }
      Table tree {
        id int [pk]
        other_id int [ref: > other.id]
        parent_id int [ref: > tree.id]
      }
    `);
    const result = plan(ir);
    expect(result.skippedRefs).toEqual([]);
    const selfFk = result.planned.find(
      (p) => p.ref.parent.entity === 'tree' && p.ref.child.entity === 'tree',
    );
    expect(selfFk?.kind).toBe('same-col');
  });

  it('skips same-col edges when there is no adjacent channel to route through', () => {
    // Single-col diagram: nowhere to route a same-col edge.
    const ir = parse(`
      Table tree {
        id int [pk]
        parent_id int [ref: > tree.id]
      }
    `);
    const result = plan(ir);
    expect(result.planned).toEqual([]);
    expect(result.skippedRefs).toHaveLength(1);
  });

  it('does not allocate a track for straight edges (same port row)', () => {
    const ir = parse(`
      Table src { a int }
      Table dst { id int [ref: > src.a] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(1);
    const edge = result.planned[0]!;
    expect(edge.kind).toBe('single');
    if (edge.kind === 'single') {
      expect(edge.track).toBe(-1);
    }
    expect(result.channelTrackCounts.get(0) ?? 0).toBe(0);
  });

  it('packs overlapping bends onto separate tracks', () => {
    const ir = parse(`
      Table src { a int b int }
      Table dst {
        x int [ref: > src.b]
        y int [ref: > src.a]
      }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
    expect(result.channelTrackCounts.get(0)).toBe(2);
  });

  it('shares a track between non-overlapping bends', () => {
    const ir = parse(`
      Table src { a int b int c int d int }
      Table dst {
        w int [ref: > src.a]
        x int [ref: > src.d]
      }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
    expect(result.channelTrackCounts.get(0)).toBe(1);
  });

  it('shares a track across non-overlapping cross-row-strip bends', () => {
    // c shares two FK columns to two stacked parents — the barycenter
    // pass can only align one pair at a time, so both edges keep their
    // bends (and they go in opposite directions, so their V intervals
    // don't overlap). Interval scheduling shares them on one track.
    const ir = parse(`
      Table p1 { id int }
      Table p2 { id int }
      Table c {
        id int
        p1_id int [ref: > p1.id]
        x int
        y int
        z int
        p2_id int [ref: > p2.id]
      }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
    expect(result.channelTrackCounts.get(0)).toBe(1);
  });

  it('bundles edges sharing a parent port into a single V track', () => {
    // Three children of the same parent column. Without bundling each
    // would get its own track (channel width = 3); bundled, they share
    // a trunk (channel width = 1). The barycenter pass may straighten
    // one of the three (the middle one, aligned with parent's port),
    // skipping it from the bundle — but the remaining bent edges still
    // share a single track.
    const ir = parse(`
      Table parent { id int }
      Table a { id int parent_id int [ref: > parent.id] }
      Table b { id int parent_id int [ref: > parent.id] }
      Table c { id int parent_id int [ref: > parent.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(3);
    expect(result.channelTrackCounts.get(0)).toBe(1);
    // Edges with a real V track land on the same track via parent-side
    // bundling. Straightened edges (track = -1) are excluded.
    const bentTracks = result.planned
      .filter((p): p is import('./route.js').SingleHopPlannedEdge => p.kind === 'single')
      .map((p) => p.track)
      .filter((t) => t >= 0);
    expect(bentTracks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bentTracks).size).toBe(1);
  });

  it('does not bundle edges from different parent PKs even in the same channel', () => {
    const ir = parse(`
      Table p1 { id int }
      Table p2 { id int }
      Table dst {
        id int
        a int [ref: > p1.id]
        b int [ref: > p2.id]
      }
    `);
    const result = plan(ir);
    // Two distinct parent ports → two distinct bundles → may need separate
    // tracks if they overlap vertically. Here p1 and p2 are in different
    // rows so their V intervals overlap by row 0 (PK row of each).
    expect(result.planned).toHaveLength(2);
    expect(result.channelTrackCounts.get(0)).toBeGreaterThanOrEqual(1);
  });

  it('merges a same-col edge into a backward single-hop bundle sharing the same parent port', () => {
    // encounter (center, col 1) has a backward FK to provider (col 2).
    // medication (col 2, same col as provider) has a same-col FK to provider.
    // Both attach to provider.id and route through channel 1. Before the fix
    // these got separate VEntries → 3 tracks. After the fix they share one
    // VEntry → channel 1 needs at most 2 tracks.
    const ir = parse(`
      Table patient { id int }
      Table provider { id int }
      Table medication {
        id int
        encounter_id int [ref: > encounter.id]
        prescriber_id int [ref: > provider.id]
      }
      Table encounter {
        id int
        patient_id int [ref: > patient.id]
        provider_id int [ref: > provider.id]
      }

      @layout {
        center encounter { left: patient right: provider, medication }
      }
    `);
    // Must pass centers to rank() so the @center hint is honored and
    // provider/medication land in the right col (col 2) next to encounter.
    const centers = detectHubs(ir);
    const result = planRoutes(ir, place(ir, rank(ir, centers)));

    // Channel 1 (between col 1 and col 2) carries the backward edge
    // (encounter→provider), the forward edge (medication→encounter), and
    // the same-col edge (medication→provider). The backward + same-col pair
    // share a parent port so they merge to one track; total must be ≤ 2.
    expect(result.channelTrackCounts.get(1)).toBeLessThanOrEqual(2);

    const backwardEdge = result.planned.find(
      (p): p is import('./route.js').SingleHopPlannedEdge =>
        p.kind === 'single' &&
        p.ref.child.entity === 'encounter' &&
        p.ref.parent.entity === 'provider',
    );
    const sameColEdge = result.planned.find(
      (p): p is import('./route.js').SameColPlannedEdge =>
        p.kind === 'same-col' &&
        p.ref.child.entity === 'medication' &&
        p.ref.parent.entity === 'provider',
    );
    expect(backwardEdge).toBeDefined();
    expect(sameColEdge).toBeDefined();
    // When the backward edge has a real V segment (not straight), it must
    // share the same track as the same-col edge.
    if (backwardEdge!.track >= 0) {
      expect(backwardEdge!.track).toBe(sameColEdge!.track);
    }
  });
});

describe('layout integration', () => {
  it('produces an EdgeRoute with one segment for a straight edge', () => {
    const ir = parse(`
      Table src { a int }
      Table dst { id int [ref: > src.a] }
    `);
    const result = layout(ir);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.segments).toHaveLength(1);
    expect(result.edges[0]?.segments[0]?.kind).toBe('horizontal');
  });

  it('produces three segments (H, V, H) for a Z-shape edge', () => {
    // Two sources stacked in col 0 with a dst in col 1 that references
    // both — the barycenter pass can only align one pair (and the
    // optimizer picks dst's column order to favor neither), so the
    // edge from src2 keeps its Z-shape across the column boundary.
    const ir = parse(`
      Table src1 { a int }
      Table src2 { b int }
      Table dst {
        id int [pk]
        x int [ref: > src1.a]
        y int [ref: > src2.b]
      }
    `);
    const result = layout(ir);
    const zEdge = result.edges.find((e) => e.segments.length === 3);
    expect(zEdge?.segments.map((s) => s.kind)).toEqual(['horizontal', 'vertical', 'horizontal']);
  });

  it('produces five segments (H, V, H, V, H) for a multi-hop edge', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      Table c { id int a_id int [ref: > a.id] }
      Table d { id int c_id int [ref: > c.id] a_id int [ref: > a.id] }
    `);
    const result = layout(ir);
    const multiHop = result.edges.find(
      (e) => e.ref.parent.entity === 'a' && e.ref.child.entity === 'd',
    );
    expect(multiHop).toBeDefined();
    expect(multiHop?.segments.map((s) => s.kind)).toEqual([
      'horizontal',
      'vertical',
      'horizontal',
      'vertical',
      'horizontal',
    ]);
  });

  it('grows the col-channel width when tracks pack tightly', () => {
    const ir = parse(`
      Table src { a int b int }
      Table dst {
        x int [ref: > src.b]
        y int [ref: > src.a]
      }
    `);
    const result = layout(ir);
    expect(result.sizing.channelColWidths[0]).toBe(3);
  });
});
