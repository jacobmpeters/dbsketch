import { layout } from '@dbsketch/layout';
import { type IR, type SqlDialect, inferRefs, parse, parseSql } from '@dbsketch/parser';
import { type RenderOptions, render } from '@dbsketch/render';

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
  // false: collapse every entity to a 3-row name-only box. Edges still
  // route correctly, with all FKs from/to an entity converging on a single
  // port at the name row. Useful for whole-schema overviews where the
  // relationship graph matters more than column-level detail.
  showColumns?: boolean;
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

// Collapse every entity to an empty-columns shell. Downstream stages
// (size, route, render) treat empty-columns entities as 3-row "compact"
// boxes with a single port per side at the name row. We also blank out
// ref column names so the route stage's parent-side bundling key
// (channel, direction, entity, column) naturally bundles every ref from
// one parent entity together — there's only one rendered port per side
// to attach to anyway.
function withoutColumns(ir: IR, showColumns: boolean | undefined): IR {
  if (showColumns !== false) return ir;
  return {
    ...ir,
    entities: ir.entities.map((e) => ({ ...e, columns: [] })),
    refs: ir.refs.map((r) => ({
      ...r,
      parent: { ...r.parent, column: '' },
      child: { ...r.child, column: '' },
    })),
  };
}

export function compile(dbml: string, options?: CompileOptions): string {
  let ir = parse(dbml);
  ir = withInferred(ir, options?.inferRefs);
  ir = withoutTypes(ir, options?.showTypes);
  ir = withoutColumns(ir, options?.showColumns);
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
  ir = withoutColumns(ir, options?.showColumns);
  return render(layout(ir), options);
}

export { ParseError, TokenizerError } from '@dbsketch/parser';
export type * from '@dbsketch/parser';
export type * from '@dbsketch/layout';
export type * from '@dbsketch/render';
