import { describe, expect, it } from 'vitest';
import { ParseError, parse } from './parser.js';

describe('parse', () => {
  it('returns empty IR for empty input', () => {
    expect(parse('')).toEqual({
      entities: [],
      refs: [],
      hints: { clusters: [], ranks: [], pins: [] },
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
