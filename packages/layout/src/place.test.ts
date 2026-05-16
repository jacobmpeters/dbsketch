import { parse } from '@dbsketch/parser';
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

  it('falls back to alphabetical for entities with no FKs', () => {
    const ir = parse(`
      Table zebra { id int [pk] }
      Table alpha { id int [pk] }
      Table mango { id int [pk] }
    `);
    const placements = place(ir, rank(ir));
    expect(placements.map((p) => p.entity)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('aligns parent and child rows when barycenter ordering allows it', () => {
    // top, mid, bot in rank 0. x has FK to top, y has FK to bot.
    // Barycenter should pull top toward x's row and bot toward y's row, so
    // both FK edges become straight (parent and child at the same row).
    const ir = parse(`
      Table top { id int }
      Table mid { id int }
      Table bot { id int }
      Table x { id int top_id int [ref: > top.id] }
      Table y { id int bot_id int [ref: > bot.id] }
    `);
    const placements = place(ir, rank(ir));
    const top = placements.find((p) => p.entity === 'top')!;
    const bot = placements.find((p) => p.entity === 'bot')!;
    const x = placements.find((p) => p.entity === 'x')!;
    const y = placements.find((p) => p.entity === 'y')!;
    expect(x.rowStrip).toBe(top.rowStrip);
    expect(y.rowStrip).toBe(bot.rowStrip);
  });

  it('clusters children near a shared parent', () => {
    // hub at rank 0; three children all FK to hub. Children should be
    // ordered consistently (alphabetical tiebreak since all have the same
    // barycenter), and packed together rather than scattered.
    const ir = parse(`
      Table hub { id int }
      Table c { id int hub_id int [ref: > hub.id] }
      Table b { id int hub_id int [ref: > hub.id] }
      Table a { id int hub_id int [ref: > hub.id] }
    `);
    const placements = place(ir, rank(ir));
    const rank1 = placements.filter((p) => p.colStrip === 1).map((p) => p.entity);
    expect(rank1).toEqual(['a', 'b', 'c']);
  });

  it('produces deterministic output across runs', () => {
    const ir = parse(`
      Table a { id int }
      Table b { id int }
      Table c { id int a_id int [ref: > a.id] b_id int [ref: > b.id] }
    `);
    expect(place(ir, rank(ir))).toEqual(place(ir, rank(ir)));
  });
});
