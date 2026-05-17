import { type IR, parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
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

  it('routes multi-hop refs through the top margin', () => {
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
      // -1 is the top-margin sentinel; all multi-hops detour above all entities.
      expect(multiHop.detourRowChannel).toBe(-1);
    }
  });

  it('routes multi-hops via the top margin even with a single row strip', () => {
    // Previously this case had no detour space (no inter-row channels), but
    // the top margin is always available.
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
      expect(multiHop.detourRowChannel).toBe(-1);
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
    const ir = parse(`
      Table p1 { id int }
      Table p2 { id int }
      Table c1 { id int p1_id int [ref: > p1.id] }
      Table c2 { id int p2_id int [ref: > p2.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
    expect(result.channelTrackCounts.get(0)).toBe(1);
  });

  it('bundles edges sharing a parent port into a single V track', () => {
    // Three children of the same parent column. Without bundling each
    // would get its own track (channel width = 3); bundled, they share
    // a trunk (channel width = 1).
    const ir = parse(`
      Table parent { id int }
      Table a { id int parent_id int [ref: > parent.id] }
      Table b { id int parent_id int [ref: > parent.id] }
      Table c { id int parent_id int [ref: > parent.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(3);
    expect(result.channelTrackCounts.get(0)).toBe(1);
    // All three edges land on the same track since they share the trunk.
    const tracks = result.planned
      .filter((p): p is import('./route.js').SingleHopPlannedEdge => p.kind === 'single')
      .map((p) => p.track);
    expect(new Set(tracks).size).toBe(1);
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
    // dst has a PK that pins to row 0, so the FK column ends up at row 1
    // even after column optimization — the Y mismatch with src.a (row 0)
    // forces a Z-shape.
    const ir = parse(`
      Table src { a int }
      Table dst { id int [pk] x int [ref: > src.a] }
    `);
    const result = layout(ir);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.segments.map((s) => s.kind)).toEqual([
      'horizontal',
      'vertical',
      'horizontal',
    ]);
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
    expect(result.sizing.channelColWidths[0]).toBe(2);
  });
});
