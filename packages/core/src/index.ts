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
}

function withInferred(ir: IR, mode: InferRefsMode = 'auto'): IR {
  if (mode === 'never') return ir;
  if (ir.refs.length > 0) return ir;
  const refs = inferRefs(ir);
  if (refs.length === 0) return ir;
  return { ...ir, refs };
}

export function compile(dbml: string, options?: CompileOptions): string {
  const ir = withInferred(parse(dbml), options?.inferRefs);
  return render(layout(ir), options);
}

export function compileSql(
  sql: string,
  dialect: SqlDialect = 'postgres',
  options?: CompileOptions,
): string {
  const ir = withInferred(parseSql(sql, dialect), options?.inferRefs);
  return render(layout(ir), options);
}

export { ParseError, TokenizerError } from '@ascii-erd/parser';
export type * from '@ascii-erd/parser';
export type * from '@ascii-erd/layout';
export type * from '@ascii-erd/render';
