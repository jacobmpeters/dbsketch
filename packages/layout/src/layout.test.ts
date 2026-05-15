import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';

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
});
