import { describe, expect, it } from 'vitest';
import { TokenizerError, tokenize } from './tokenizer.js';

describe('tokenize', () => {
  it('returns just eof for empty input', () => {
    const toks = tokenize('');
    expect(toks).toHaveLength(1);
    expect(toks[0]?.kind).toBe('eof');
  });

  it('handles single-char punctuation', () => {
    const toks = tokenize('{ } [ ] : , . > - <');
    expect(toks.map((t) => t.kind)).toEqual([
      'lbrace',
      'rbrace',
      'lbracket',
      'rbracket',
      'colon',
      'comma',
      'dot',
      'gt',
      'dash',
      'lt',
      'eof',
    ]);
  });

  it('recognizes <> as a single token', () => {
    const toks = tokenize('<>');
    expect(toks[0]?.kind).toBe('lt-gt');
  });

  it('tracks line and column', () => {
    const toks = tokenize('foo\n  bar');
    expect(toks[0]).toMatchObject({ value: 'foo', line: 1, col: 1 });
    expect(toks[1]).toMatchObject({ value: 'bar', line: 2, col: 3 });
  });

  it('skips line comments', () => {
    const toks = tokenize('foo // ignored\nbar');
    expect(toks.map((t) => t.value)).toEqual(['foo', 'bar', '']);
  });

  it('parses both quote styles', () => {
    expect(tokenize(`'hello'`)[0]?.value).toBe('hello');
    expect(tokenize(`"world"`)[0]?.value).toBe('world');
  });

  it('throws on unterminated string', () => {
    expect(() => tokenize(`"unclosed`)).toThrow(TokenizerError);
  });

  it('throws on unexpected character', () => {
    expect(() => tokenize('@')).toThrow(/Unexpected character/);
  });
});
