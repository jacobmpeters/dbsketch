import { type Token, type TokenKind, tokenize } from './tokenizer.js';
import type { Column, Entity, IR, LayoutHints, Ref, RefEndpoint } from './types.js';

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(`${message} at line ${line}:${col}`);
  }
}

class Parser {
  private pos = 0;
  private readonly entities: Entity[] = [];
  private readonly refs: Ref[] = [];

  constructor(private readonly tokens: Token[]) {}

  parse(): IR {
    while (!this.at('eof')) {
      this.parseTopLevel();
    }
    return {
      entities: this.entities,
      refs: this.refs,
      hints: emptyHints(),
    };
  }

  private parseTopLevel(): void {
    const tok = this.peek();
    if (tok.kind === 'ident' && tok.value.toLowerCase() === 'table') {
      this.parseTable();
      return;
    }
    throw new ParseError(`Expected 'Table', got '${tok.value || tok.kind}'`, tok.line, tok.col);
  }

  private parseTable(): void {
    this.consume('ident');
    const name = this.consume('ident').value;
    this.consume('lbrace');
    const columns: Column[] = [];
    while (!this.at('rbrace')) {
      const result = this.parseColumn(name);
      columns.push(result.column);
      if (result.ref) this.refs.push(result.ref);
    }
    this.consume('rbrace');
    this.entities.push({ name, columns });
  }

  private parseColumn(tableName: string): { column: Column; ref?: Ref } {
    const name = this.consume('ident').value;
    const type = this.consume('ident').value;
    let pk = false;
    let ref: Ref | undefined;

    if (this.at('lbracket')) {
      this.consume('lbracket');
      while (!this.at('rbracket')) {
        const attrTok = this.consume('ident');
        const attr = attrTok.value.toLowerCase();
        if (attr === 'pk') {
          pk = true;
        } else if (attr === 'ref') {
          this.consume('colon');
          const op = this.consumeCardinality();
          const targetEntity = this.consume('ident').value;
          this.consume('dot');
          const targetColumn = this.consume('ident').value;
          ref = makeRef(
            { entity: tableName, column: name },
            { entity: targetEntity, column: targetColumn },
            op,
          );
        }
        if (this.at('comma')) this.consume('comma');
      }
      this.consume('rbracket');
    }

    const column: Column = { name, type, pk };
    return ref ? { column, ref } : { column };
  }

  private consumeCardinality(): '>' | '<' | '-' | '<>' {
    const tok = this.peek();
    if (tok.kind === 'gt') {
      this.advance();
      return '>';
    }
    if (tok.kind === 'lt') {
      this.advance();
      return '<';
    }
    if (tok.kind === 'dash') {
      this.advance();
      return '-';
    }
    if (tok.kind === 'lt-gt') {
      this.advance();
      return '<>';
    }
    throw new ParseError(
      `Expected cardinality operator, got '${tok.value || tok.kind}'`,
      tok.line,
      tok.col,
    );
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private advance(): Token {
    return this.tokens[this.pos++]!;
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private consume(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(`Expected ${kind}, got '${tok.value || tok.kind}'`, tok.line, tok.col);
    }
    return this.advance();
  }
}

// DBML cardinality operators describe the left→right reading of the relationship.
// For inline refs, left is the declaring column (FK side by convention) and right
// is the target (PK side):
//   '>'  many-to-one:   left is many (child),  right is one  (parent)
//   '<'  one-to-many:   left is one  (parent), right is many (child)
//   '-'  one-to-one:    symmetric — declarer placed as child by convention
//   '<>' many-to-many:  symmetric — declarer placed as child by convention
// IR is normalized to parent/child so downstream stages don't have to interpret.
function makeRef(left: RefEndpoint, right: RefEndpoint, op: '>' | '<' | '-' | '<>'): Ref {
  switch (op) {
    case '>':
      return { parent: right, child: left, cardinality: 'one-to-many' };
    case '<':
      return { parent: left, child: right, cardinality: 'one-to-many' };
    case '-':
      return { parent: right, child: left, cardinality: 'one-to-one' };
    case '<>':
      return { parent: right, child: left, cardinality: 'many-to-many' };
  }
}

function emptyHints(): LayoutHints {
  return { clusters: [], ranks: [], pins: [] };
}

export function parse(source: string): IR {
  return new Parser(tokenize(source)).parse();
}
