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

  it('auto-detects at most one hub (multi-hub is opt-in via explicit @center)', () => {
    const ir = parse(`
      Table fact { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] d_id int [ref: > d.id] }
      Table other { id int x_id int [ref: > a.id] y_id int [ref: > b.id] z_id int [ref: > c.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
      Table d { id int }
    `);
    // Both fact (deg 4) and other (deg 3) clear the threshold, but auto
    // only picks the top one.
    const hubs = detectHubs(ir).map((c) => c.entity);
    expect(hubs).toEqual(['fact']);
  });

  it('honors all user-provided @center hints regardless of auto cap', () => {
    const ir = parse(`
      Table fact { id int a_id int [ref: > a.id] b_id int [ref: > b.id] c_id int [ref: > c.id] }
      Table a { id int }
      Table b { id int }
      Table c { id int }
    `);
    ir.hints.centers.push(
      { entity: 'a', left: [], right: [], source: 'user' },
      { entity: 'b', left: [], right: [], source: 'user' },
    );
    const hubs = detectHubs(ir).map((c) => c.entity);
    expect(hubs).toEqual(['a', 'b']);
  });
});
