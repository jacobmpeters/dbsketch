import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { layout } from './layout.js';
import { routeStats } from './stats.js';

const colNames = (l: ReturnType<typeof layout>, entityName: string): string[] =>
  l.ir.entities.find((e) => e.name === entityName)?.columns.map((c) => c.name) ?? [];

describe('optimizeColumns', () => {
  it('reorders an entity when an FK sits below a non-FK column', () => {
    // dim_region in this shape needs country_id (FK) pulled above name
    // (non-FK) to straighten the edge to dim_country.
    const ir = parse(`
      Table dim_country { country_id int [pk] name varchar }
      Table dim_region  { region_id int [pk] name varchar country_id int [ref: > dim_country.country_id] }
    `);
    const l = layout(ir);
    expect(colNames(l, 'dim_region')).toEqual(['region_id', 'country_id', 'name']);
  });

  it('leaves declared order alone when reorder would regress the metric', () => {
    // Star: sales_fact's FKs are mostly already up top, with a single
    // non-FK (promotion_id) interspersed. The PK→FK→other rule shifts
    // promotion_id past the trailing FKs, which moves dim row strips and
    // makes V's longer in aggregate. Search should reject the move.
    const ir = parse(`
      Table dim_date     { id int [pk] date date }
      Table dim_customer { id int [pk] email varchar }
      Table dim_product  { id int [pk] sku varchar }
      Table dim_store    { id int [pk] name varchar }
      Table channel_dim  { id int [pk] name varchar }
      Table currency_dim { id int [pk] code varchar }
      Table employee_dim { id int [pk] name varchar }
      Table sales_fact {
        id int [pk]
        date_id int [ref: > dim_date.id]
        product_id int [ref: > dim_product.id]
        store_id int [ref: > dim_store.id]
        customer_id int [ref: > dim_customer.id]
        promotion_id int
        channel_id int [ref: > channel_dim.id]
        currency_id int [ref: > currency_dim.id]
        employee_id int [ref: > employee_dim.id]
        quantity int
        unit_price int
        total int
      }
    `);
    const l = layout(ir);
    // promotion_id stays at row 5 (declared position), not pushed to the
    // bottom of the FK group.
    expect(colNames(l, 'sales_fact')[5]).toBe('promotion_id');
  });

  it('respects @layout { preserve_order } globally', () => {
    const ir = parse(`
      Table dim_country { country_id int [pk] name varchar }
      Table dim_region  { region_id int [pk] name varchar country_id int [ref: > dim_country.country_id] }
      @layout { preserve_order }
    `);
    const l = layout(ir);
    expect(colNames(l, 'dim_region')).toEqual(['region_id', 'name', 'country_id']);
  });

  it('respects @layout { preserve_order entity } per-entity', () => {
    const ir = parse(`
      Table dim_country { country_id int [pk] name varchar }
      Table dim_region  { region_id int [pk] name varchar country_id int [ref: > dim_country.country_id] }
      @layout { preserve_order dim_region }
    `);
    const l = layout(ir);
    expect(colNames(l, 'dim_region')).toEqual(['region_id', 'name', 'country_id']);
  });

  it('is deterministic — same input produces same output', () => {
    const dbml = `
      Table dim_country { country_id int [pk] name varchar }
      Table dim_region  { region_id int [pk] name varchar country_id int [ref: > dim_country.country_id] }
    `;
    const a = routeStats(layout(parse(dbml)));
    const b = routeStats(layout(parse(dbml)));
    expect(a).toEqual(b);
  });
});
