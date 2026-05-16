import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@ascii-erd/parser';
import { describe, expect, it } from 'vitest';
import { detectHubs } from './detectHubs.js';

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'parser',
  'fixtures',
);

describe('detectHubs', () => {
  for (const name of readdirSync(FIXTURES_DIR).sort()) {
    if (!name.endsWith('.dbml')) continue;
    it(name, () => {
      const ir = parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
      expect(detectHubs(ir).map((c) => ({ entity: c.entity, source: c.source }))).toMatchSnapshot();
    });
  }

  it('respects user-provided centers and does not override @col pins', () => {
    const ir = parse(`
      Table fact { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
    `);
    // User pins fact to col 0 → auto-detection should skip it.
    ir.hints.pins.push({ entity: 'fact', col: 0, row: null });
    const hubs = detectHubs(ir);
    expect(hubs.find((c) => c.entity === 'fact')).toBeUndefined();
  });

  it('preserves user-provided @center entries', () => {
    const ir = parse(`
      Table x { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
    `);
    ir.hints.centers.push({ entity: 'a', left: [], right: [], source: 'user' });
    const hubs = detectHubs(ir);
    const a = hubs.find((c) => c.entity === 'a');
    expect(a?.source).toBe('user');
  });

  it('breaks degree ties by closeness to already-selected hubs', () => {
    // The primary hub (sales, degree 4) is unambiguous. The secondary
    // tie is between `near` (1 hop from sales) and `aaaa` (disconnected
    // from sales), both at degree 3. Closeness should win — picking the
    // far leaf would produce a fragmented spine.
    const ir = parse(`
      Table sales { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] d_id int [ref: > d.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
      Table d { id int }
      Table near { id int n1_id int [ref: > leaf1.id] n2_id int [ref: > leaf2.id] s_id int [ref: > sales.id] }
      Table leaf1 { id int }
      Table leaf2 { id int }
      Table aaaa { id int x1_id int [ref: > xa.id] x2_id int [ref: > xb.id] x3_id int [ref: > xc.id] }
      Table xa { id int }
      Table xb { id int }
      Table xc { id int }
    `);
    const hubs = detectHubs(ir).map((c) => c.entity);
    expect(hubs[0]).toBe('sales');
    // `near` connects to sales (dist 1), `aaaa` is in its own component.
    // The closeness tiebreak picks near as the 2nd hub.
    expect(hubs).toContain('near');
    expect(hubs.indexOf('near')).toBeLessThan(hubs.indexOf('aaaa'));
  });
});
