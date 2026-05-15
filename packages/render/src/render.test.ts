import { layout } from '@ascii-erd/layout';
import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { render } from './render.js';

describe('render', () => {
  it('renders a single table in unicode (default)', () => {
    const out = render(layout(parse('Table users { id int email varchar }')));
    expect(out).toMatchInlineSnapshot(`
      "┌───────────────┐
      │ users         │
      ├───────────────┤
      │ id int        │
      │ email varchar │
      └───────────────┘"
    `);
  });

  it('renders a single table in ascii', () => {
    const out = render(layout(parse('Table users { id int email varchar }')), { glyphs: 'ascii' });
    expect(out).toMatchInlineSnapshot(`
      "+---------------+
      | users         |
      +---------------+
      | id int        |
      | email varchar |
      +---------------+"
    `);
  });

  it('renders a chained schema across rank-based columns', () => {
    const out = render(
      layout(
        parse(`
          Table users { id int email varchar }
          Table posts { id int user_id int [ref: > users.id] title varchar }
        `),
      ),
    );
    expect(out).toMatchInlineSnapshot(`
      "┌───────────────┐  ┌───────────────┐
      │ users         │  │ posts         │
      ├───────────────┤  ├───────────────┤
      │ id int        ├┐ │ id int        │
      │ email varchar │└─┤ user_id int   │
      └───────────────┘  │ title varchar │
                         └───────────────┘"
    `);
  });

  it('renders a junction-table layout (two parents, one child)', () => {
    const out = render(
      layout(
        parse(`
          Table users { id int }
          Table groups { id int }
          Table memberships {
            user_id int [ref: > users.id]
            group_id int [ref: > groups.id]
          }
        `),
      ),
    );
    expect(out).toMatchInlineSnapshot(`
      "┌────────┐  ┌──────────────┐
      │ groups │  │ memberships  │
      ├────────┤  ├──────────────┤
      │ id int ├┬┐┤ user_id int  │
      └────────┘│└┤ group_id int │
                │ └──────────────┘
                │
      ┌────────┐│
      │ users  ││
      ├────────┤│
      │ id int ├┘
      └────────┘"
    `);
  });

  it('handles entities of different heights in the same row strip', () => {
    const out = render(
      layout(
        parse(`
          Table tall { a int b int c int d int e int }
          Table short { id int }
        `),
      ),
    );
    expect(out).toMatchInlineSnapshot(`
      "┌────────┐
      │ short  │
      ├────────┤
      │ id int │
      └────────┘

      ┌────────┐
      │ tall   │
      ├────────┤
      │ a int  │
      │ b int  │
      │ c int  │
      │ d int  │
      │ e int  │
      └────────┘"
    `);
  });

  it('returns empty string for empty IR', () => {
    expect(render(layout(parse('')))).toBe('');
  });
});
