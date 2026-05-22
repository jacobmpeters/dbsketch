import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { HintConflictError, layout } from './layout.js';

describe('layout', () => {
  it('produces a complete layout for a chained schema', () => {
    const ir = parse(`
      Table users { id int [pk] }
      Table posts { id int [pk] user_id int [ref: > users.id] }
      Table comments { id int [pk] post_id int [ref: > posts.id] }
    `);
    const result = layout(ir);
    expect(result.placements).toHaveLength(3);
    expect(result.sizing.colStripWidths).toHaveLength(3);
    expect(result.sizing.channelColWidths).toHaveLength(2);
  });

  it('is byte-identical across runs (determinism contract)', () => {
    const ir = parse(`
      Table a { id int [pk] }
      Table b { id int [pk] a_id int [ref: > a.id] }
      Table c { id int [pk] a_id int [ref: > a.id] }
    `);
    expect(JSON.stringify(layout(ir))).toBe(JSON.stringify(layout(ir)));
  });

  it('honors a row pin', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      Table c { id int }
      @layout { pin a at row 2 }
    `);
    const result = layout(ir);
    expect(result.placements.find((p) => p.entity === 'a')?.rowStrip).toBe(2);
  });

  it('honors a col pin', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      @layout { pin a at col 1 }
    `);
    const result = layout(ir);
    expect(result.placements.find((p) => p.entity === 'a')?.colStrip).toBe(1);
  });

  it('skips pinned rows when placing other entities in the same rank', () => {
    // Three rank-0 entities. Pinning b to row 2 should put others at rows
    // 0 and 1 (not 0, 1, 2 with b colliding).
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      Table c { id int }
      @layout { pin b at row 2 }
    `);
    const result = layout(ir);
    const rows = result.placements.map((p) => ({ entity: p.entity, row: p.rowStrip }));
    expect(rows).toContainEqual({ entity: 'b', row: 2 });
    // a and c should be at 0 and 1 (in some order)
    const aRow = result.placements.find((p) => p.entity === 'a')?.rowStrip;
    const cRow = result.placements.find((p) => p.entity === 'c')?.rowStrip;
    expect([aRow, cRow].sort()).toEqual([0, 1]);
  });

  it('rejects a col pin that places a child before its parent', () => {
    const ir = parse(`
      Table parent { id int }
      Table child { id int p_id int [ref: > parent.id] }
      @layout { pin child at col 0 pin parent at col 1 }
    `);
    expect(() => layout(ir)).toThrow(HintConflictError);
  });

  it('allows same-col pins when parent and child are deliberately stacked', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child { id int p_id int [ref: > parent.id] }
      @layout {
        pin parent at col 0, row 0
        pin child at col 0, row 1
      }
    `);
    expect(() => layout(ir)).not.toThrow();
  });

  it('rejects two pins at the same fully-specified position', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      @layout {
        pin a at col 0, row 1
        pin b at col 0, row 1
      }
    `);
    expect(() => layout(ir)).toThrow(/both target/);
  });

  it('does not trigger col-conflict for self-FKs', () => {
    // Self-referencing FK (e.g., department.parent_dept_id → department.id)
    // shouldn't trip the parent-col < child-col validator, since it can't
    // satisfy the constraint anyway and the router skips self-FKs.
    const ir = parse(`
      Table department {
        id int [pk]
        parent_id int [ref: > department.id]
      }
    `);
    expect(() => layout(ir)).not.toThrow();
  });

  it('rejects pin to unknown entity', () => {
    const ir = parse(`
      Table a { id int }
      @layout { pin nonexistent at row 0 }
    `);
    expect(() => layout(ir)).toThrow(/unknown entity/);
  });

  it('rejects @center and @col on the same entity (incompatible axes)', () => {
    const ir = parse(`
      Table fact { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
      @layout {
        center fact
        pin fact at col 0
      }
    `);
    expect(() => layout(ir)).toThrow(/@center and a @col pin/);
  });
});
