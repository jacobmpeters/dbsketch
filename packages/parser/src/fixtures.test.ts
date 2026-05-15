import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

describe('fixtures', () => {
  for (const name of readdirSync(FIXTURES_DIR).sort()) {
    if (!name.endsWith('.dbml')) continue;
    it(name, () => {
      const source = readFileSync(join(FIXTURES_DIR, name), 'utf8');
      expect(parse(source)).toMatchSnapshot();
    });
  }
});
