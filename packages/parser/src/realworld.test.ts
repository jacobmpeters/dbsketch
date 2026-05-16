import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures-realworld');

// Regression set: real-world DBML pulled from open-source projects. These
// exercise features our minimal grammar doesn't define syntax for but must
// tolerate without erroring (Project/TableGroup/Enum blocks, Note blocks,
// quoted identifiers, multi-attribute brackets with not null/default/note,
// external Ref declarations, schema-qualified names, composite-column refs).
//
// The contract is loose: parsing must succeed and produce non-empty entities
// for non-empty schemas. We snapshot the entity+ref counts to catch
// accidental drops in coverage.
describe('real-world fixtures', () => {
  for (const name of readdirSync(FIXTURES_DIR).sort()) {
    if (!name.endsWith('.dbml')) continue;
    it(name, () => {
      const source = readFileSync(join(FIXTURES_DIR, name), 'utf8');
      const ir = parse(source);
      expect(ir.entities.length).toBeGreaterThan(0);
      expect({ entities: ir.entities.length, refs: ir.refs.length }).toMatchSnapshot();
    });
  }
});
