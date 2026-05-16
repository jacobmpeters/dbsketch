import { type Token, type TokenKind, tokenize } from './tokenizer.js';
import type { CenterHint, Column, Entity, IR, PinHint, Ref, RefEndpoint } from './types.js';

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
  private readonly pins: PinHint[] = [];
  private readonly centers: CenterHint[] = [];

  constructor(private readonly tokens: Token[]) {}

  parse(): IR {
    while (!this.at('eof')) {
      this.parseTopLevel();
    }
    return {
      entities: this.entities,
      refs: this.refs,
      hints: { clusters: [], ranks: [], pins: this.pins, centers: this.centers },
    };
  }

  // Top-level dispatch:
  //   Table NAME { ... }        → tables (data we care about)
  //   Ref ... | Ref: ...        → external relationship declarations
  //   @layout { ... }           → dbsketch hints
  //   anything else IDENT ... { ... }  → tolerated; consumed and discarded
  //     (Project, TableGroup, Enum, Note, etc.)
  private parseTopLevel(): void {
    const tok = this.peek();
    if (tok.kind === 'at_sign') {
      this.parseLayoutBlock();
      return;
    }
    if (tok.kind === 'ident') {
      const kw = tok.value.toLowerCase();
      if (kw === 'table') {
        this.parseTable();
        return;
      }
      if (kw === 'ref') {
        this.parseExternalRef();
        return;
      }
      this.skipUnknownBlock();
      return;
    }
    throw new ParseError(`Unexpected '${tok.value || tok.kind}'`, tok.line, tok.col);
  }

  // Consume one unrecognized top-level construct: token stream up to the
  // next `{`, then a balanced brace skip. If no `{` follows (e.g. a bare
  // single-line directive), consume just the leading ident.
  private skipUnknownBlock(): void {
    this.advance();
    while (
      !this.at('eof') &&
      !this.at('lbrace') &&
      !this.at('at_sign') &&
      !(this.at('ident') && this.isTopLevelKeyword(this.peek().value))
    ) {
      this.advance();
    }
    if (this.at('lbrace')) this.skipBalancedBraces();
  }

  private isTopLevelKeyword(value: string): boolean {
    const v = value.toLowerCase();
    return v === 'table' || v === 'ref';
  }

  private skipBalancedBraces(): void {
    this.consume('lbrace');
    let depth = 1;
    while (depth > 0 && !this.at('eof')) {
      if (this.at('lbrace')) depth++;
      else if (this.at('rbrace')) depth--;
      this.advance();
    }
  }

  // External ref syntax variants:
  //   Ref: a.b > c.d
  //   Ref name: a.b > c.d
  //   Ref { a.b > c.d, ... }
  //   Ref name { a.b > c.d }
  private parseExternalRef(): void {
    this.consume('ident'); // 'Ref'
    // Optional name ident or quoted name.
    if (this.at('ident') || this.at('string')) this.advance();
    if (this.at('lbrace')) {
      this.consume('lbrace');
      while (!this.at('rbrace') && !this.at('eof')) {
        this.parseRefStatement();
        if (this.at('comma')) this.consume('comma');
      }
      this.consume('rbrace');
      return;
    }
    if (this.at('colon')) this.consume('colon');
    this.parseRefStatement();
    if (this.at('lbracket')) this.parseAttributeBracket(); // ignore [delete: cascade] etc.
  }

  private parseRefStatement(): void {
    const left = this.parseRefEndpoint();
    const op = this.consumeCardinality();
    const right = this.parseRefEndpoint();
    if (this.at('lbracket')) this.parseAttributeBracket();
    this.refs.push(makeRef(left, right, op));
  }

  // `entity.column` or `entity.(col1, col2)` (composite). For composite,
  // take the first column — the entity-to-entity relationship is what
  // matters for visualization, and we don't render per-column FK indicators
  // on multiple columns at once.
  private parseRefEndpoint(): RefEndpoint {
    const entity = this.consumeName();
    this.consume('dot');
    if (this.at('lparen')) {
      this.consume('lparen');
      const column = this.consumeName();
      while (!this.at('rparen') && !this.at('eof')) this.advance();
      if (this.at('rparen')) this.consume('rparen');
      return { entity, column };
    }
    const column = this.consumeName();
    return { entity, column };
  }

  private parseLayoutBlock(): void {
    this.consume('at_sign');
    const blockType = this.consume('ident');
    if (blockType.value.toLowerCase() !== 'layout') {
      throw new ParseError(
        `Expected 'layout' after '@', got '${blockType.value}'`,
        blockType.line,
        blockType.col,
      );
    }
    this.consume('lbrace');
    while (!this.at('rbrace')) {
      this.parseHintStatement();
    }
    this.consume('rbrace');
  }

  private parseHintStatement(): void {
    const tok = this.peek();
    if (tok.kind !== 'ident') {
      throw new ParseError(
        `Expected hint keyword, got '${tok.value || tok.kind}'`,
        tok.line,
        tok.col,
      );
    }
    const keyword = tok.value.toLowerCase();
    if (keyword === 'pin') {
      this.parsePinHint();
      return;
    }
    if (keyword === 'center') {
      this.parseCenterHint();
      return;
    }
    throw new ParseError(
      `Unknown hint: '${tok.value}' (expected 'pin' or 'center')`,
      tok.line,
      tok.col,
    );
  }

  private parsePinHint(): void {
    this.consume('ident'); // 'pin'
    const entityTok = this.consume('ident');
    const entity = entityTok.value;
    const atTok = this.consume('ident');
    if (atTok.value.toLowerCase() !== 'at') {
      throw new ParseError(
        `Expected 'at' after entity name, got '${atTok.value}'`,
        atTok.line,
        atTok.col,
      );
    }

    let col: number | null = null;
    let row: number | null = null;

    while (true) {
      const compTok = this.consume('ident');
      const comp = compTok.value.toLowerCase();
      if (comp !== 'col' && comp !== 'row') {
        throw new ParseError(
          `Expected 'col' or 'row', got '${compTok.value}'`,
          compTok.line,
          compTok.col,
        );
      }
      const numTok = this.consume('number');
      const value = Number.parseInt(numTok.value, 10);
      if (Number.isNaN(value) || value < 0) {
        throw new ParseError(
          `Expected non-negative integer, got '${numTok.value}'`,
          numTok.line,
          numTok.col,
        );
      }
      if (comp === 'col') {
        if (col !== null) {
          throw new ParseError("Duplicate 'col' in pin", compTok.line, compTok.col);
        }
        col = value;
      } else {
        if (row !== null) {
          throw new ParseError("Duplicate 'row' in pin", compTok.line, compTok.col);
        }
        row = value;
      }
      if (this.at('comma')) {
        this.consume('comma');
        continue;
      }
      break;
    }

    if (col === null && row === null) {
      throw new ParseError('pin must specify col, row, or both', entityTok.line, entityTok.col);
    }

    this.pins.push({ entity, col, row });
  }

  // Syntax:
  //   center entity
  //   center entity { left: a, b }
  //   center entity { right: c, d }
  //   center entity { left: a, b right: c, d }
  private parseCenterHint(): void {
    this.consume('ident'); // 'center'
    const entity = this.consume('ident').value;
    const left: string[] = [];
    const right: string[] = [];

    if (this.at('lbrace')) {
      this.consume('lbrace');
      const seen = new Set<string>();
      while (!this.at('rbrace')) {
        const sideTok = this.consume('ident');
        const side = sideTok.value.toLowerCase();
        if (side !== 'left' && side !== 'right') {
          throw new ParseError(
            `Expected 'left' or 'right', got '${sideTok.value}'`,
            sideTok.line,
            sideTok.col,
          );
        }
        if (seen.has(side)) {
          throw new ParseError(`Duplicate '${side}' in center`, sideTok.line, sideTok.col);
        }
        seen.add(side);
        this.consume('colon');
        const list = side === 'left' ? left : right;
        while (true) {
          list.push(this.consume('ident').value);
          if (this.at('comma')) {
            this.consume('comma');
            continue;
          }
          break;
        }
      }
      this.consume('rbrace');
    }

    this.centers.push({ entity, left, right, source: 'user' });
  }

  // Table NAME [as alias] [[attrs]] { ... }
  // NAME can be quoted ("vocabulary") or schema-qualified (schema.table).
  // Aliases and table-level attrs are tolerated and discarded.
  private parseTable(): void {
    this.consume('ident'); // 'Table'
    let name = this.consumeName();
    if (this.at('dot')) {
      // schema.table → keep only the table part.
      this.consume('dot');
      name = this.consumeName();
    }
    // Optional `as alias` — skip.
    if (this.at('ident') && this.peek().value.toLowerCase() === 'as') {
      this.advance();
      this.consumeName();
    }
    // Optional table-level [attrs].
    if (this.at('lbracket')) this.parseAttributeBracket();

    this.consume('lbrace');
    const columns: Column[] = [];
    while (!this.at('rbrace') && !this.at('eof')) {
      // Nested keyword blocks: Indexes / Checks / Note (as block or as
      // `Note: 'string'` attribute).
      if (this.at('ident')) {
        const kw = this.peek().value.toLowerCase();
        if (kw === 'indexes' || kw === 'checks') {
          this.advance();
          if (this.at('lbrace')) this.skipBalancedBraces();
          continue;
        }
        if (kw === 'note') {
          this.advance();
          if (this.at('colon')) {
            this.consume('colon');
            this.skipAttrValue();
            continue;
          }
          if (this.at('lbrace')) {
            this.skipBalancedBraces();
            continue;
          }
        }
      }
      const result = this.parseColumn(name);
      columns.push(result.column);
      if (result.ref) this.refs.push(result.ref);
    }
    this.consume('rbrace');
    this.entities.push({ name, columns });
  }

  private parseColumn(tableName: string): { column: Column; ref?: Ref } {
    const name = this.consumeName();
    const type = this.parseType();
    let pk = false;
    let ref: Ref | undefined;

    if (this.at('lbracket')) {
      const attrs = this.parseAttributeBracket();
      pk = attrs.pk;
      if (attrs.ref) {
        ref = makeRef({ entity: tableName, column: name }, attrs.ref.target, attrs.ref.op);
      }
    }

    const column: Column = { name, type, pk };
    return ref ? { column, ref } : { column };
  }

  // Type names like `int`, `varchar(100)`, `decimal(10, 2)`,
  // `schema.enum_type` (Postgres user-defined types are often
  // schema-qualified). Parens are consumed greedily until matched; their
  // content is appended to the type string verbatim for surface preservation.
  private parseType(): string {
    let type = this.consumeName();
    while (this.at('dot')) {
      this.consume('dot');
      type += `.${this.consumeName()}`;
    }
    if (this.at('lparen')) {
      let parens = '';
      let depth = 0;
      while (!this.at('eof')) {
        const t = this.advance();
        parens += t.value;
        if (t.kind === 'lparen') depth++;
        else if (t.kind === 'rparen') {
          depth--;
          if (depth === 0) break;
        }
      }
      type += parens;
    }
    return type;
  }

  // Returns extracted pk/ref; ignores everything else (not null, unique,
  // default:, note:, increment, etc.) by consuming the attribute name and
  // its optional `: value` then continuing on commas.
  private parseAttributeBracket(): {
    pk: boolean;
    ref?: { op: '>' | '<' | '-' | '<>'; target: RefEndpoint };
  } {
    this.consume('lbracket');
    let pk = false;
    let ref: { op: '>' | '<' | '-' | '<>'; target: RefEndpoint } | undefined;

    while (!this.at('rbracket') && !this.at('eof')) {
      if (this.at('ident')) {
        const name = this.peek().value.toLowerCase();
        if (name === 'pk') {
          this.advance();
          pk = true;
        } else if (name === 'primary') {
          this.advance();
          if (this.at('ident') && this.peek().value.toLowerCase() === 'key') this.advance();
          pk = true;
        } else if (name === 'ref') {
          this.advance();
          this.consume('colon');
          const op = this.consumeCardinality();
          const targetEntity = this.consumeName();
          let targetColumn = targetEntity;
          if (this.at('dot')) {
            this.consume('dot');
            targetColumn = this.consumeName();
          }
          // Schema-qualified target: schema.table.column → use last two parts.
          if (this.at('dot')) {
            this.consume('dot');
            targetColumn = this.consumeName();
          }
          ref = { op, target: { entity: targetEntity, column: targetColumn } };
        } else if (name === 'not') {
          this.advance();
          if (this.at('ident') && this.peek().value.toLowerCase() === 'null') this.advance();
        } else {
          // Generic attribute: `name` or `name: value` or `name: value-list`.
          this.advance();
          if (this.at('colon')) {
            this.consume('colon');
            this.skipAttrValue();
          }
        }
      } else if (this.at('string') || this.at('number')) {
        this.advance();
      } else {
        // Stray punctuation we don't recognize — advance to avoid infinite loops.
        this.advance();
      }
      if (this.at('comma')) this.consume('comma');
    }
    this.consume('rbracket');
    return ref ? { pk, ref } : { pk };
  }

  // Single attribute value: literal, identifier, code-string, or function
  // call (ident(args)). Anything beyond the value boundary is left for the
  // caller (a comma or `]`).
  private skipAttrValue(): void {
    if (this.at('string') || this.at('number')) {
      this.advance();
      return;
    }
    if (this.at('ident')) {
      this.advance();
      // Function-call form: ident(args)
      if (this.at('lparen')) {
        let depth = 0;
        while (!this.at('eof')) {
          const t = this.advance();
          if (t.kind === 'lparen') depth++;
          else if (t.kind === 'rparen') {
            depth--;
            if (depth === 0) break;
          }
        }
      }
      return;
    }
    // Unknown shape — best effort: advance one token.
    if (!this.at('rbracket') && !this.at('comma')) this.advance();
  }

  private consumeName(): string {
    const tok = this.peek();
    if (tok.kind === 'ident' || tok.kind === 'string') {
      return this.advance().value;
    }
    throw new ParseError(
      `Expected name (identifier or quoted string), got '${tok.value || tok.kind}'`,
      tok.line,
      tok.col,
    );
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

export function parse(source: string): IR {
  return new Parser(tokenize(source)).parse();
}
