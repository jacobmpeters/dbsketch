import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';

const SCENARIOS: Record<string, string> = {
  'single-table': `
    Table users { id int [pk] email varchar }
  `,
  'linear-chain': `
    Table users { id int [pk] }
    Table posts { id int [pk] user_id int [ref: > users.id] }
    Table comments { id int [pk] post_id int [ref: > posts.id] }
  `,
  'branching-children': `
    Table users { id int [pk] }
    Table posts { id int [pk] user_id int [ref: > users.id] }
    Table sessions { id int [pk] user_id int [ref: > users.id] }
  `,
  'junction-table': `
    Table users { id int [pk] name varchar }
    Table groups { id int [pk] name varchar }
    Table memberships {
      user_id int [ref: > users.id]
      group_id int [ref: > groups.id]
    }
  `,
  diamond: `
    Table a { id int [pk] }
    Table b { id int [pk] a_id int [ref: > a.id] }
    Table c { id int [pk] a_id int [ref: > a.id] b_id int [ref: > b.id] }
  `,
  // Barycenter should pull top → row matching x, bot → row matching y, leaving
  // both FK edges straight rather than bending across rows.
  'barycenter-reorder': `
    Table top { id int }
    Table mid { id int }
    Table bot { id int }
    Table x { id int top_id int [ref: > top.id] }
    Table y { id int bot_id int [ref: > bot.id] }
  `,
};

describe('layout snapshots', () => {
  for (const [name, dbml] of Object.entries(SCENARIOS)) {
    it(name, () => {
      expect(layout(parse(dbml))).toMatchSnapshot();
    });
  }
});
