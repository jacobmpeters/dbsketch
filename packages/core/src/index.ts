import { layout } from '@ascii-erd/layout';
import { parse } from '@ascii-erd/parser';
import { type RenderOptions, render } from '@ascii-erd/render';

export type CompileOptions = RenderOptions;

export function compile(dbml: string, options?: CompileOptions): string {
  return render(layout(parse(dbml)), options);
}

export { ParseError, TokenizerError } from '@ascii-erd/parser';
export type * from '@ascii-erd/parser';
export type * from '@ascii-erd/layout';
export type * from '@ascii-erd/render';
