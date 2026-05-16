import { parse } from '@dbsketch/parser';
import { describe, expect, it } from 'vitest';
import { place } from './place.js';
import { rank } from './rank.js';
import { size } from './size.js';

describe('size', () => {
  it('returns zero-length arrays for empty IR', () => {
    const sizing = size(parse(''), []);
    expect(sizing).toEqual({
      colStripWidths: [],
      channelColWidths: [],
      rowStripHeights: [],
      channelRowHeights: [],
    });
  });

  it('sizes a column strip to the widest entity in it', () => {
    const ir = parse(`
      Table u { id int [pk] }
      Table verylongname { id int [pk] }
    `);
    const sizing = size(ir, place(ir, rank(ir)));
    expect(sizing.colStripWidths[0]).toBe('verylongname'.length + 4);
  });

  it('sizes row strips to entity heights', () => {
    const ir = parse('Table users { id int [pk] email varchar }');
    // 4 (borders + header + separator) + 2 columns
    expect(size(ir, place(ir, rank(ir))).rowStripHeights[0]).toBe(6);
  });

  it('sizes width to fit the widest column line', () => {
    const ir = parse('Table t { short int verylongcolumnname varchar }');
    // inner = "verylongcolumnname varchar".length = 26
    expect(size(ir, place(ir, rank(ir))).colStripWidths[0]).toBe(30);
  });

  it('uses the minimum visual-separation channel width when there is no routing', () => {
    const ir = parse(`
      Table users { id int [pk] }
      Table posts { id int [pk] user_id int [ref: > users.id] }
    `);
    const sizing = size(ir, place(ir, rank(ir)));
    expect(sizing.channelColWidths).toEqual([2]);
    expect(sizing.channelRowHeights).toEqual([]);
  });
});
