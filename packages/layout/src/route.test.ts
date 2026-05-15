import { type IR, parse } from '@ascii-erd/parser';
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

  it('routes multi-hop refs by detouring through a row-channel', () => {
    // Two rank-0 entities (a, b) gives us numRowStrips >= 2, so a row-channel
    // exists for the detour. a → d crosses cols 0 → 2.
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
      expect(multiHop.detourRowChannel).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to detour-above when detour-below row-channel is missing', () => {
    // Two roots → 2 row strips. Multi-hop edge from root at row 1 to a
    // child at col 2 row 1: minRow=1 is the last row strip, so detour-below
    // doesn't exist, but detour-above (row-channel 0) does.
    const ir = parse(`
      Table top { id int }
      Table bottom { id int }
      Table mid { id int top_id int [ref: > top.id] }
      Table leaf { id int bottom_id int [ref: > bottom.id] mid_id int [ref: > mid.id] }
    `);
    const result = plan(ir);
    // Both edges from top/bottom to leaf should route. The bottom→leaf edge
    // is the multi-hop one; with the fallback in place it shouldn't skip.
    expect(result.skippedRefs).toEqual([]);
    const multiHop = result.planned.find((p) => p.kind === 'multi');
    expect(multiHop).toBeDefined();
  });

  it('skips multi-hop refs when no row-channel exists for detour', () => {
    // Single row strip means there's nowhere to detour through.
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: > a.id] }
      Table c { id int b_id int [ref: > b.id] a_id int [ref: > a.id] }
    `);
    const result = plan(ir);
    // a → c is multi-hop but can't detour (only 1 row strip).
    expect(result.skippedRefs).toHaveLength(1);
    expect(result.skippedRefs[0]?.parent.entity).toBe('a');
    expect(result.skippedRefs[0]?.child.entity).toBe('c');
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
    const ir = parse(`
      Table src { a int }
      Table dst { id int x int [ref: > src.a] }
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
