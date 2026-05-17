import { describe, expect, it } from 'vitest';
import { ParseError, parse } from './parser.js';

describe('parse', () => {
  it('returns empty IR for empty input', () => {
    expect(parse('')).toEqual({
      entities: [],
      refs: [],
      hints: {
        clusters: [],
        ranks: [],
        pins: [],
        centers: [],
        preserveOrder: { global: false, entities: [] },
      },
    });
  });

  it('parses a single table with columns', () => {
    const ir = parse(`
      Table users {
        id int [pk]
        email varchar
      }
    `);
    expect(ir.entities).toEqual([
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'int', pk: true },
          { name: 'email', type: 'varchar', pk: false },
        ],
      },
    ]);
    expect(ir.refs).toEqual([]);
  });

  it('normalizes inline > to parent→child', () => {
    const ir = parse(`
      Table users { id int [pk] }
      Table posts {
        id int [pk]
        user_id int [ref: > users.id]
      }
    `);
    expect(ir.refs).toEqual([
      {
        parent: { entity: 'users', column: 'id' },
        child: { entity: 'posts', column: 'user_id' },
        cardinality: 'one-to-many',
      },
    ]);
  });

  it('normalizes inline < to the same parent→child shape', () => {
    const ir = parse(`
      Table users {
        id int [pk, ref: < posts.user_id]
      }
      Table posts {
        id int [pk]
        user_id int
      }
    `);
    expect(ir.refs).toEqual([
      {
        parent: { entity: 'users', column: 'id' },
        child: { entity: 'posts', column: 'user_id' },
        cardinality: 'one-to-many',
      },
    ]);
  });

  it('parses one-to-one with -', () => {
    const ir = parse(`
      Table profiles {
        user_id int [ref: - users.id]
      }
      Table users { id int [pk] }
    `);
    expect(ir.refs[0]?.cardinality).toBe('one-to-one');
  });

  it('parses many-to-many with <>', () => {
    const ir = parse(`
      Table tags {
        id int [pk]
        post_id int [ref: <> posts.id]
      }
      Table posts { id int [pk] }
    `);
    expect(ir.refs[0]?.cardinality).toBe('many-to-many');
  });

  it('skips comments inside and outside tables', () => {
    const ir = parse(`
      // top
      Table users {
        id int [pk] // trailing
        // mid
        email varchar
      }
    `);
    expect(ir.entities[0]?.columns).toHaveLength(2);
  });

  it('parses an @layout block with a row pin', () => {
    const ir = parse(`
      Table users { id int }
      @layout {
        pin users at row 2
      }
    `);
    expect(ir.hints.pins).toEqual([{ entity: 'users', col: null, row: 2 }]);
  });

  it('parses pins for col, row, and combined col + row', () => {
    const ir = parse(`
      Table users { id int }
      Table posts { id int }
      Table comments { id int }
      @layout {
        pin users at col 1
        pin posts at row 3
        pin comments at col 2, row 1
      }
    `);
    expect(ir.hints.pins).toEqual([
      { entity: 'users', col: 1, row: null },
      { entity: 'posts', col: null, row: 3 },
      { entity: 'comments', col: 2, row: 1 },
    ]);
  });

  it('rejects @layout pins with no col or row', () => {
    expect(() =>
      parse(`
        Table users { id int }
        @layout { pin users at }
      `),
    ).toThrow(ParseError);
  });

  it('rejects unknown hint keywords', () => {
    expect(() =>
      parse(`
        Table users { id int }
        @layout { cluster auth { users } }
      `),
    ).toThrow(/Unknown hint/);
  });

  it('parses a bare center hint', () => {
    const ir = parse(`
      Table sales_fact { id int }
      @layout { center sales_fact }
    `);
    expect(ir.hints.centers).toEqual([
      { entity: 'sales_fact', left: [], right: [], source: 'user' },
    ]);
  });

  it('parses a center hint with left and right bias', () => {
    const ir = parse(`
      Table sales_fact { id int }
      Table dim_a { id int }
      Table dim_b { id int }
      Table dim_c { id int }
      @layout {
        center sales_fact { left: dim_a, dim_b right: dim_c }
      }
    `);
    expect(ir.hints.centers).toEqual([
      { entity: 'sales_fact', left: ['dim_a', 'dim_b'], right: ['dim_c'], source: 'user' },
    ]);
  });

  it('parses center sides in either order', () => {
    const ir = parse(`
      Table f { id int }
      Table a { id int }
      Table b { id int }
      @layout { center f { right: b left: a } }
    `);
    expect(ir.hints.centers[0]).toEqual({
      entity: 'f',
      left: ['a'],
      right: ['b'],
      source: 'user',
    });
  });

  it('rejects duplicate side keywords in center', () => {
    expect(() =>
      parse(`
        Table f { id int }
        @layout { center f { left: a left: b } }
      `),
    ).toThrow(/Duplicate 'left'/);
  });

  it('rejects unknown side keyword in center', () => {
    expect(() =>
      parse(`
        Table f { id int }
        @layout { center f { top: a } }
      `),
    ).toThrow(/Expected 'left' or 'right'/);
  });

  it('throws ParseError on syntax errors with line info', () => {
    try {
      parse('Table users {\n  id int [oops');
      expect.fail('expected ParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).line).toBe(2);
    }
  });
});
