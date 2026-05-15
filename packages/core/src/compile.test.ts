import { describe, expect, it } from 'vitest';
import { ParseError, TokenizerError, compile } from './index.js';

describe('compile', () => {
  it('compiles DBML to a Unicode ERD by default', () => {
    const out = compile('Table users { id int }');
    expect(out).toContain('┌');
    expect(out).toContain('users');
    expect(out).toContain('id int');
  });

  it('honors the glyphs: ascii option', () => {
    const out = compile('Table users { id int }', { glyphs: 'ascii' });
    expect(out).toContain('+');
    expect(out).toContain('|');
    expect(out).not.toContain('┌');
  });

  it('returns an empty string for empty input', () => {
    expect(compile('')).toBe('');
  });

  it('propagates ParseError on malformed DBML', () => {
    expect(() => compile('Table')).toThrow(ParseError);
  });

  it('propagates TokenizerError on unrecognized characters', () => {
    expect(() => compile('@@@nope')).toThrow(TokenizerError);
  });
});
