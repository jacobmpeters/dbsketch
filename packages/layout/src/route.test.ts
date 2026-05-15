import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';
import { place } from './place.js';
import { rank } from './rank.js';
import { planRoutes } from './route.js';

describe('planRoutes', () => {
  it('plans a single adjacent-col edge', () => {
    const ir = parse(`
      Table users { id int }
      Table posts { id int user_id int [ref: > users.id] }
    `);
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]?.parentColStrip).toBe(0);
    expect(plan.planned[0]?.childColStrip).toBe(1);
    expect(plan.planned[0]?.parentRowOffset).toBe(3);
    expect(plan.planned[0]?.childRowOffset).toBe(4);
    expect(plan.skippedRefs).toEqual([]);
  });

  it('skips refs that span more than one col-strip', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: > a.id] }
      Table c { id int b_id int [ref: > b.id] a_id int [ref: > a.id] }
    `);
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(2);
    expect(plan.skippedRefs).toHaveLength(1);
    expect(plan.skippedRefs[0]?.parent.entity).toBe('a');
    expect(plan.skippedRefs[0]?.child.entity).toBe('c');
  });

  it('skips many-to-many refs', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: <> a.id] }
    `);
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(0);
    expect(plan.skippedRefs).toHaveLength(1);
  });

  it('does not allocate a track for straight edges (same port row)', () => {
    const ir = parse(`
      Table src { a int }
      Table dst { id int [ref: > src.a] }
    `);
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]?.track).toBe(-1);
    expect(plan.channelTrackCounts.get(0) ?? 0).toBe(0);
  });

  it('packs overlapping bends onto separate tracks', () => {
    const ir = parse(`
      Table src { a int b int }
      Table dst {
        x int [ref: > src.b]
        y int [ref: > src.a]
      }
    `);
    // src.a@3, src.b@4, dst.x@3, dst.y@4
    // Edge 1: src.b(4) → dst.x(3). Bend over rows [3,4].
    // Edge 2: src.a(3) → dst.y(4). Bend over rows [3,4]. Overlaps.
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(2);
    expect(plan.channelTrackCounts.get(0)).toBe(2);
  });

  it('shares a track between non-overlapping bends', () => {
    const ir = parse(`
      Table src { a int b int c int d int }
      Table dst {
        w int [ref: > src.a]
        x int [ref: > src.d]
      }
    `);
    // src.a@3, src.d@6, dst.w@3, dst.x@4
    // Edge 1: src.a(3) → dst.w(3). Straight, no track.
    // Edge 2: src.d(6) → dst.x(4). Bend over [4,6].
    const plan = planRoutes(ir, place(ir, rank(ir)));
    expect(plan.planned).toHaveLength(2);
    expect(plan.channelTrackCounts.get(0)).toBe(1);
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
