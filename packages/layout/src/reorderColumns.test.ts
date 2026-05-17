import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { reorderColumns } from './reorderColumns.js';

const colNames = (ir: ReturnType<typeof reorderColumns>, entityName: string): string[] =>
  ir.entities.find((e) => e.name === entityName)?.columns.map((c) => c.name) ?? [];

describe('reorderColumns', () => {
  it('puts PK first, then FK columns, then others (declared order within group)', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child {
        body varchar
        parent_id int [ref: > parent.id]
        title varchar
        id int [pk]
      }
    `);
    const result = reorderColumns(ir);
    expect(colNames(result, 'child')).toEqual(['id', 'parent_id', 'body', 'title']);
  });

  it('preserves composite-PK ordering at the top', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table junction {
        body varchar
        user_id int [pk]
        tenant_id int [pk]
        parent_id int [ref: > parent.id]
      }
    `);
    const result = reorderColumns(ir);
    // PKs first, in declared order (user_id, tenant_id); then FK; then other.
    expect(colNames(result, 'junction')).toEqual(['user_id', 'tenant_id', 'parent_id', 'body']);
  });

  it('treats a column that is both PK and FK source as a PK', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child {
        body varchar
        id int [pk, ref: > parent.id]
        title varchar
      }
    `);
    const result = reorderColumns(ir);
    expect(colNames(result, 'child')).toEqual(['id', 'body', 'title']);
  });

  it('is a no-op when an entity is already PK → FK → other', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child {
        id int [pk]
        parent_id int [ref: > parent.id]
        body varchar
      }
    `);
    const result = reorderColumns(ir);
    // Same reference: the column array was not rebuilt for an unchanged entity.
    const child = ir.entities.find((e) => e.name === 'child')!;
    const resultChild = result.entities.find((e) => e.name === 'child')!;
    expect(resultChild.columns).toBe(child.columns);
  });

  it('skips entities named in @layout { preserve_order }', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child {
        body varchar
        parent_id int [ref: > parent.id]
        id int [pk]
      }
      @layout {
        preserve_order child
      }
    `);
    const result = reorderColumns(ir);
    expect(colNames(result, 'child')).toEqual(['body', 'parent_id', 'id']);
  });

  it('skips every entity when @layout { preserve_order } has no list', () => {
    const ir = parse(`
      Table parent { id int [pk] }
      Table child {
        body varchar
        parent_id int [ref: > parent.id]
        id int [pk]
      }
      @layout {
        preserve_order
      }
    `);
    const result = reorderColumns(ir);
    expect(colNames(result, 'child')).toEqual(['body', 'parent_id', 'id']);
  });
});
