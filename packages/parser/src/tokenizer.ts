export type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'lparen'
  | 'rparen'
  | 'colon'
  | 'comma'
  | 'dot'
  | 'gt'
  | 'lt'
  | 'dash'
  | 'lt-gt'
  | 'at_sign'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

export class TokenizerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} at line ${line}:${col}`);
  }
}

const SINGLE_CHAR: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  '(': 'lparen',
  ')': 'rparen',
  ':': 'colon',
  ',': 'comma',
  '.': 'dot',
  '>': 'gt',
  '-': 'dash',
  '@': 'at_sign',
};

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  const peek = (offset = 0): string | undefined => source[pos + offset];
  const advance = (): string => {
    const ch = source[pos++]!;
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (pos < source.length) {
    const startLine = line;
    const startCol = col;
    const ch = peek()!;

    if (/\s/.test(ch)) {
      advance();
      continue;
    }

    // Line comment: // ... \n
    if (ch === '/' && peek(1) === '/') {
      while (pos < source.length && peek() !== '\n') advance();
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && peek(1) === '*') {
      advance();
      advance();
      while (pos < source.length && !(peek() === '*' && peek(1) === '/')) advance();
      if (pos < source.length) {
        advance();
        advance();
      }
      continue;
    }

    // Triple-quoted string: '''...'''  (multi-line). Backslash escapes are
    // processed (\' produces a literal ', \\ produces a literal \) so that
    // closing-quote detection isn't fooled by escaped single quotes in the
    // content.
    if (ch === "'" && peek(1) === "'" && peek(2) === "'") {
      advance();
      advance();
      advance();
      let value = '';
      while (pos < source.length && !(peek() === "'" && peek(1) === "'" && peek(2) === "'")) {
        if (peek() === '\\' && peek(1) !== undefined) {
          advance();
          value += advance();
          continue;
        }
        value += advance();
      }
      if (pos >= source.length) {
        throw new TokenizerError('Unterminated triple-quoted string', startLine, startCol);
      }
      advance();
      advance();
      advance();
      tokens.push({ kind: 'string', value, line: startLine, col: startCol });
      continue;
    }

    // Single or double quoted string. Quoted identifiers (e.g. "vocabulary"
    // used as a table name) share this token kind; the parser accepts either
    // ident or string where a name is expected.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      advance();
      let value = '';
      while (pos < source.length && peek() !== quote) {
        if (peek() === '\\' && peek(1) !== undefined) {
          advance();
          value += advance();
          continue;
        }
        if (peek() === '\n') {
          throw new TokenizerError('Unterminated string', startLine, startCol);
        }
        value += advance();
      }
      if (pos >= source.length) {
        throw new TokenizerError('Unterminated string', startLine, startCol);
      }
      advance();
      tokens.push({ kind: 'string', value, line: startLine, col: startCol });
      continue;
    }

    // Backtick string: `expr` — used for code expressions in defaults and
    // CHECK clauses. May span multiple lines (e.g. a multi-line CHECK
    // expression emitted by @dbml/core's SQL importer). Parser treats
    // these as opaque values to discard.
    if (ch === '`') {
      advance();
      let value = '';
      while (pos < source.length && peek() !== '`') {
        value += advance();
      }
      if (pos >= source.length) {
        throw new TokenizerError('Unterminated backtick string', startLine, startCol);
      }
      advance();
      tokens.push({ kind: 'string', value, line: startLine, col: startCol });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let value = '';
      while (pos < source.length && /[0-9.]/.test(peek()!)) {
        value += advance();
      }
      tokens.push({ kind: 'number', value, line: startLine, col: startCol });
      continue;
    }

    if (ch === '<') {
      advance();
      if (peek() === '>') {
        advance();
        tokens.push({ kind: 'lt-gt', value: '<>', line: startLine, col: startCol });
      } else {
        tokens.push({ kind: 'lt', value: '<', line: startLine, col: startCol });
      }
      continue;
    }

    const punct = SINGLE_CHAR[ch];
    if (punct !== undefined) {
      advance();
      tokens.push({ kind: punct, value: ch, line: startLine, col: startCol });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let value = '';
      while (pos < source.length && /[A-Za-z0-9_]/.test(peek()!)) {
        value += advance();
      }
      tokens.push({ kind: 'ident', value, line: startLine, col: startCol });
      continue;
    }

    // Hex color literal: #abc123, used in [headercolor: ...] and similar.
    // Tokenized as a generic ident so attribute-value parsers can consume
    // it without special casing.
    if (ch === '#' && peek(1) !== undefined && /[A-Fa-f0-9]/.test(peek(1)!)) {
      let value = '';
      while (pos < source.length && /[A-Fa-f0-9#]/.test(peek()!)) {
        value += advance();
      }
      tokens.push({ kind: 'ident', value, line: startLine, col: startCol });
      continue;
    }

    throw new TokenizerError(`Unexpected character '${ch}'`, startLine, startCol);
  }

  tokens.push({ kind: 'eof', value: '', line, col });
  return tokens;
}
