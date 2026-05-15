import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { place } from './place.js';
import { rank } from './rank.js';

describe('place', () => {
  it('returns empty for empty IR', () => {
    expect(place(parse(''), new Map())).toEqual([]);
  });

  it('places a single entity at (0, 0)', () => {
    const ir = parse('Table users { id int [pk] }');
    expect(place(ir, rank(ir))).toEqual([{ entity: 'users', colStrip: 0, rowStrip: 0 }]);
  });

  it('uses rank for the column strip', () => {
    const ir = parse(`
      Table users { id int [pk] }
      Table posts { id int [pk] user_id int [ref: > users.id] }
    `);
    const placements = place(ir, rank(ir));
    expect(placements.find((p) => p.entity === 'users')?.colStrip).toBe(0);
    expect(placements.find((p) => p.entity === 'posts')?.colStrip).toBe(1);
  });

  it('stacks same-rank entities into separate row strips', () => {
    const ir = parse(`
      Table a { id int [pk] }
      Table b { id int [pk] }
    `);
    expect(place(ir, rank(ir))).toEqual([
      { entity: 'a', colStrip: 0, rowStrip: 0 },
      { entity: 'b', colStrip: 0, rowStrip: 1 },
    ]);
  });

  it('orders within-rank entities alphabetically for determinism', () => {
    const ir = parse(`
      Table zebra { id int [pk] }
      Table alpha { id int [pk] }
      Table mango { id int [pk] }
    `);
    const placements = place(ir, rank(ir));
    expect(placements.map((p) => p.entity)).toEqual(['alpha', 'mango', 'zebra']);
  });
});
