import { type IR, parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';
import { place } from './place.js';
import { rank } from './rank.js';
import { planRoutes } from './route.js';
import { rowSize } from './size.js';

function plan(ir: IR) {
  const placements = place(ir, rank(ir));
  return planRoutes(ir, placements, rowSize(ir, placements));
}

describe('planRoutes', () => {
  it('plans a single adjacent-col edge', () => {
    const ir = parse(`
      Table users { id int }
      Table posts { id int user_id int [ref: > users.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.parentColStrip).toBe(0);
    expect(result.planned[0]?.childColStrip).toBe(1);
    expect(result.planned[0]?.parentRowOffset).toBe(3);
    expect(result.planned[0]?.childRowOffset).toBe(4);
    expect(result.skippedRefs).toEqual([]);
  });

  it('plans cross-row-strip edges in adjacent col-strips', () => {
    // products and users both in rank 0 (no FKs into them). Sorted alphabetically
    // → products at row 0, users at row 1. orders has FK to users (rank 1, row 0).
    // The users → orders edge spans different row strips in col-channel 0.
    const ir = parse(`
      Table products { id int }
      Table users { id int }
      Table orders { id int user_id int [ref: > users.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0]?.parentRowStrip).toBe(1);
    expect(result.planned[0]?.childRowStrip).toBe(0);
    expect(result.skippedRefs).toEqual([]);
  });

  it('skips refs that span more than one col-strip', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int a_id int [ref: > a.id] }
      Table c { id int b_id int [ref: > b.id] a_id int [ref: > a.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
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
    expect(result.planned[0]?.track).toBe(-1);
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
    // src.a@3, src.b@4, dst.x@3, dst.y@4. Same row strip.
    // Edge 1: src.b(4) → dst.x(3). Edge 2: src.a(3) → dst.y(4). Bends overlap.
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
    // Two parents in row 0 (rank 0), two children in rows 0 and 1 (rank 1).
    // Each child's FK goes to a different parent; the bends sit in the same
    // col-channel but at different absolute y, so they share track 0.
    const ir = parse(`
      Table p1 { id int }
      Table p2 { id int }
      Table c1 { id int p1_id int [ref: > p1.id] }
      Table c2 { id int p2_id int [ref: > p2.id] }
    `);
    const result = plan(ir);
    expect(result.planned).toHaveLength(2);
    // Both edges bend (different absolute y), but their y ranges don't overlap
    // because they're in different row strips, so they share one track.
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
