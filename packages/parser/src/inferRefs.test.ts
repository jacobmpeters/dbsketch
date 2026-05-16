import { describe, expect, it } from 'vitest';
import { inferRefs } from './inferRefs.js';
import { parse } from './parser.js';

describe('inferRefs', () => {
  it('infers warehouse fact-to-dim refs by PK name match', () => {
    const ir = parse(`
      Table dim_respondent { respondent_id int [pk] name varchar }
      Table dim_study      { study_id int [pk] name varchar }
      Table fact_response {
        response_id int [pk]
        respondent_id int
        study_id int
      }
    `);
    const refs = inferRefs(ir).map(
      (r) => `${r.child.entity}.${r.child.column}->${r.parent.entity}.${r.parent.column}`,
    );
    expect(refs).toEqual([
      'fact_response.respondent_id->dim_respondent.respondent_id',
      'fact_response.study_id->dim_study.study_id',
    ]);
  });

  it('does not infer when no other entity has the PK column', () => {
    const ir = parse(`
      Table a { id int [pk] name varchar }
      Table b { id int [pk] description varchar }
    `);
    expect(inferRefs(ir)).toEqual([]);
  });

  it('skips ambiguous matches (two PK owners)', () => {
    const ir = parse(`
      Table a { x int [pk] }
      Table b { x int [pk] }
      Table c { x int }
    `);
    expect(inferRefs(ir)).toEqual([]);
  });

  it('does not infer self-references', () => {
    const ir = parse(`
      Table tree { id int [pk] parent_id int }
    `);
    // No entity has parent_id as PK, so nothing to match.
    expect(inferRefs(ir)).toEqual([]);
  });

  it('ignores PKs on the same column as the candidate FK (self only)', () => {
    // x is the PK on both a and c; b.x is a non-PK FK pointing to one of them.
    // Two owners → ambiguous → skip.
    const ir = parse(`
      Table a { x int [pk] }
      Table b { x int }
      Table c { x int [pk] }
    `);
    expect(inferRefs(ir)).toEqual([]);
  });

  it('skips columns that already match the entity itself', () => {
    const ir = parse(`
      Table a { x int [pk] x_other int }
      Table b { x int }
    `);
    // b.x → a.x is the one inference; a.x being PK doesn't conflict.
    const refs = inferRefs(ir);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      parent: { entity: 'a', column: 'x' },
      child: { entity: 'b', column: 'x' },
      cardinality: 'one-to-many',
    });
  });
});
