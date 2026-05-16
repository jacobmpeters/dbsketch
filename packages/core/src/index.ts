import { layout } from '@ascii-erd/layout';
import { type IR, type SqlDialect, inferRefs, parse, parseSql } from '@ascii-erd/parser';
import { type RenderOptions, render } from '@ascii-erd/render';

export type InferRefsMode = 'auto' | 'never';

export interface CompileOptions extends RenderOptions {
  // 'auto' (default): infer refs only when the parsed IR has zero declared
  // refs (warehouse-style schemas with no FOREIGN KEYs); skip otherwise so
  // user-declared relationships aren't augmented with guesses.
  // 'never': never infer.
  inferRefs?: InferRefsMode;
  // false: strip column types from the IR before layout. Entities render
  // names only and are correspondingly narrower. Useful for high-level
  // structural overviews where types are noise.
  showTypes?: boolean;
}

function withInferred(ir: IR, mode: InferRefsMode = 'auto'): IR {
  if (mode === 'never') return ir;
  if (ir.refs.length > 0) return ir;
  const refs = inferRefs(ir);
  if (refs.length === 0) return ir;
  return { ...ir, refs };
}

function withoutTypes(ir: IR, showTypes: boolean | undefined): IR {
  if (showTypes !== false) return ir;
  return {
    ...ir,
    entities: ir.entities.map((e) => ({
      ...e,
      columns: e.columns.map((c) => ({ ...c, type: '' })),
    })),
  };
}

export function compile(dbml: string, options?: CompileOptions): string {
  let ir = parse(dbml);
  ir = withInferred(ir, options?.inferRefs);
  ir = withoutTypes(ir, options?.showTypes);
  return render(layout(ir), options);
}

export function compileSql(
  sql: string,
  dialect: SqlDialect = 'postgres',
  options?: CompileOptions,
): string {
  let ir = parseSql(sql, dialect);
  ir = withInferred(ir, options?.inferRefs);
  ir = withoutTypes(ir, options?.showTypes);
  return render(layout(ir), options);
}

export { ParseError, TokenizerError } from '@ascii-erd/parser';
export type * from '@ascii-erd/parser';
export type * from '@ascii-erd/layout';
export type * from '@ascii-erd/render';
