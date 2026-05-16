import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { rank } from './rank.js';

describe('rank', () => {
  it('returns empty for empty IR', () => {
    expect(rank(parse(''))).toEqual(new Map());
  });

  it('assigns rank 0 to a single entity', () => {
    const r = rank(parse('Table users { id int [pk] }'));
    expect(r.get('users')).toBe(0);
  });

  it('ranks a linear chain by depth', () => {
    const r = rank(
      parse(`
        Table users { id int [pk] }
        Table posts { id int [pk] user_id int [ref: > users.id] }
        Table comments { id int [pk] post_id int [ref: > posts.id] }
      `),
    );
    expect(r.get('users')).toBe(0);
    expect(r.get('posts')).toBe(1);
    expect(r.get('comments')).toBe(2);
  });

  it('places sibling children at the same rank', () => {
    const r = rank(
      parse(`
        Table users { id int [pk] }
        Table posts { id int [pk] user_id int [ref: > users.id] }
        Table sessions { id int [pk] user_id int [ref: > users.id] }
      `),
    );
    expect(r.get('posts')).toBe(1);
    expect(r.get('sessions')).toBe(1);
  });

  it('places junction tables one rank below their parents', () => {
    const r = rank(
      parse(`
        Table users { id int [pk] }
        Table groups { id int [pk] }
        Table memberships {
          user_id int [ref: > users.id]
          group_id int [ref: > groups.id]
        }
      `),
    );
    expect(r.get('users')).toBe(0);
    expect(r.get('groups')).toBe(0);
    expect(r.get('memberships')).toBe(1);
  });

  it('uses the longest path when an entity has multiple parents', () => {
    const r = rank(
      parse(`
        Table a { id int [pk] }
        Table b { id int [pk] a_id int [ref: > a.id] }
        Table c { id int [pk] a_id int [ref: > a.id] b_id int [ref: > b.id] }
      `),
    );
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
  });

  it('terminates and assigns finite ranks for cycles', () => {
    const r = rank(
      parse(`
        Table a { id int [pk] b_id int [ref: > b.id] }
        Table b { id int [pk] a_id int [ref: > a.id] }
      `),
    );
    expect(r.get('a')).toBeTypeOf('number');
    expect(r.get('b')).toBeTypeOf('number');
  });

  it('ignores symmetric refs for ranking', () => {
    const r = rank(
      parse(`
        Table users { id int [pk] }
        Table profiles { id int [pk] user_id int [ref: - users.id] }
      `),
    );
    expect(r.get('users')).toBe(0);
    expect(r.get('profiles')).toBe(0);
  });
});
