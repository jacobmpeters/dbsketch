import { HintConflictError, layout } from '@dbsketch/layout';
import {
  type ClusterHint,
  type Column,
  type IR,
  type Ref,
  type SqlDialect,
  inferRefs,
  parse,
  parseSql,
} from '@dbsketch/parser';
import { type RenderOptions, render, renderSvg } from '@dbsketch/render';
import type { SvgOptions } from '@dbsketch/render';

export type InferRefsMode = 'auto' | 'never';

export interface SvgCompileOptions extends SvgOptions {
  inferRefs?: InferRefsMode;
  showTypes?: boolean;
  showColumns?: boolean;
}

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
  return renderClustered(ir, options);
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
  return renderClustered(ir, options);
}

export function compileSvg(dbml: string, options?: SvgCompileOptions): string {
  const { theme, ...compileOpts } = options ?? {};
  const text = compile(dbml, compileOpts);
  return text ? renderSvg(text, theme ? { theme } : {}) : '';
}

export function compileSqlSvg(
  sql: string,
  dialect: SqlDialect = 'postgres',
  options?: SvgCompileOptions,
): string {
  const { theme, ...compileOpts } = options ?? {};
  const text = compileSql(sql, dialect, compileOpts);
  return text ? renderSvg(text, theme ? { theme } : {}) : '';
}

// When the IR has cluster hints, split it into one sub-IR per cluster and
// render each separately with a section header. Cross-cluster refs get
// annotated on the source column ("user_id → users.id (Auth)") instead of
// drawing edges between diagrams. Unclustered entities collect into a
// trailing "Other" cluster so nothing falls off.
function renderClustered(ir: IR, options?: CompileOptions): string {
  if (ir.hints.clusters.length === 0) {
    return render(layout(ir), options);
  }
  const clusters = withDefaultCluster(ir);
  const targetClusterByEntity = new Map<string, string>();
  for (const cluster of clusters) {
    for (const entity of cluster.entities) {
      if (!targetClusterByEntity.has(entity)) targetClusterByEntity.set(entity, cluster.name);
    }
  }
  const sections: string[] = [];
  for (const cluster of clusters) {
    if (cluster.entities.length === 0) continue;
    const subIr = buildClusterIR(ir, cluster, targetClusterByEntity);
    const body = render(layout(subIr), options);
    sections.push(`─── ${cluster.name} ───\n\n${body}`);
  }
  return sections.join('\n\n');
}

// Add a trailing "Other" cluster covering entities not assigned anywhere.
// Avoids silently dropping entities when the user's clusters don't cover
// the whole schema.
function withDefaultCluster(ir: IR): ClusterHint[] {
  const entityNames = new Set(ir.entities.map((e) => e.name));
  const assigned = new Set<string>();
  for (const cluster of ir.hints.clusters) {
    for (const entity of cluster.entities) {
      if (!entityNames.has(entity)) {
        throw new HintConflictError(`cluster '${cluster.name}' references unknown entity '${entity}'`);
      }
      assigned.add(entity);
    }
  }
  const leftover = ir.entities.map((e) => e.name).filter((n) => !assigned.has(n));
  if (leftover.length === 0) return ir.hints.clusters;
  return [...ir.hints.clusters, { name: 'Other', entities: leftover }];
}

// Sub-IR for one cluster: only entities in the cluster, only refs whose
// endpoints are both in the cluster. Refs that cross out of the cluster
// get rendered as annotation rows inserted immediately after the FK
// column — `↳ target.col (cluster)` on its own row, keeping the FK
// column's row at its natural width.
function buildClusterIR(
  ir: IR,
  cluster: ClusterHint,
  targetClusterByEntity: Map<string, string>,
): IR {
  const inCluster = new Set(cluster.entities);
  const internal: Ref[] = [];
  const externalSourceAnnotations = new Map<string, string>(); // key: "entity|column"
  for (const ref of ir.refs) {
    const parentIn = inCluster.has(ref.parent.entity);
    const childIn = inCluster.has(ref.child.entity);
    if (parentIn && childIn) {
      internal.push(ref);
      continue;
    }
    if (childIn) {
      // The FK source (child) is in this cluster; annotate the source col.
      const owner = targetClusterByEntity.get(ref.parent.entity);
      const suffix = owner && owner !== cluster.name ? ` (${owner})` : '';
      externalSourceAnnotations.set(
        `${ref.child.entity}|${ref.child.column}`,
        // Leading spaces indent the annotation under its FK column so the
        // arrow visually attaches to the column above it.
        `  ↳ ${ref.parent.entity}.${ref.parent.column}${suffix}`,
      );
    }
  }
  return {
    ...ir,
    entities: ir.entities
      .filter((e) => inCluster.has(e.name))
      .map((e) => {
        const newColumns: Column[] = [];
        for (const c of e.columns) {
          newColumns.push(c);
          const annotation = externalSourceAnnotations.get(`${e.name}|${c.name}`);
          if (annotation) {
            // Display-only column: no `pk`, no `type`, no edges target it.
            // The router skips it because no ref points to its name.
            newColumns.push({ name: annotation, type: '', pk: false });
          }
        }
        return { ...e, columns: newColumns };
      }),
    refs: internal,
    // Clear the cluster hint inside the sub-IR — we're already iterating.
    hints: { ...ir.hints, clusters: [] },
  };
}

// ── Markdown processing ───────────────────────────────────────────────────────

export interface ProcessMarkdownOptions extends CompileOptions {
  // Resolves a src="..." path to its raw file content. The callback receives
  // the path string exactly as written in the comment; the caller is responsible
  // for resolving it relative to the markdown file's directory. When omitted,
  // src="..." references are skipped (left in place, no rendered block inserted).
  resolveFile?: (src: string) => string;
  // SQL dialect used when a src="..." path ends in .sql. Defaults to 'postgres'.
  dialect?: SqlDialect;
}

const FENCE = '```';
// Matches either:
//   <!-- dbsketch\n<DBML>\n-->       (inline block — group 2 captures DBML)
//   <!-- dbsketch src="path" -->     (file ref — group 1 captures path)
const COMMENT_RE =
  /<!--\s*dbsketch(?:[ \t]+src="([^"]+)"[^-]*|[ \t]*\n([\s\S]*?)\n)-->/g;
// After a comment: optional blank lines then an existing rendered block.
const RENDERED_RE = new RegExp(`^(\\n+)(${FENCE}dbsketch-rendered\\n[\\s\\S]*?${FENCE})`);
// Matches fenced code blocks so we can skip comments that appear inside them.
const FENCE_RE = /^```[^\n]*\n[\s\S]*?^```/gm;

function fencedRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of source.matchAll(FENCE_RE)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

export function processMarkdown(source: string, options?: ProcessMarkdownOptions): string {
  const { resolveFile, dialect = 'postgres', ...compileOpts } = options ?? {};

  const fenced = fencedRanges(source);
  let result = '';
  let cursor = 0;

  for (const match of source.matchAll(COMMENT_RE)) {
    if (fenced.some(([s, e]) => match.index! >= s && match.index! < e)) continue;
    const srcPath = match[1];
    const inlineDbml = match[2];
    const commentEnd = match.index! + match[0].length;

    result += source.slice(cursor, commentEnd);
    cursor = commentEnd;

    let dbml: string;
    if (srcPath !== undefined) {
      if (!resolveFile) continue;
      try {
        dbml = resolveFile(srcPath);
      } catch {
        continue;
      }
    } else {
      dbml = inlineDbml!.trim();
    }

    let rendered: string;
    try {
      const isSql = srcPath !== undefined && /\.sql$/i.test(srcPath);
      rendered = isSql ? compileSql(dbml, dialect, compileOpts) : compile(dbml, compileOpts);
    } catch {
      continue;
    }

    const trailingNewline = rendered.endsWith('\n') ? '' : '\n';
    const newBlock = `${FENCE}dbsketch-rendered\n${rendered}${trailingNewline}${FENCE}`;

    const tail = source.slice(cursor);
    const existing = tail.match(RENDERED_RE);
    if (existing) {
      result += existing[1] + newBlock;
      cursor += existing[0].length;
    } else {
      result += '\n\n' + newBlock;
    }
  }

  result += source.slice(cursor);
  return result;
}

export { ParseError, TokenizerError } from '@dbsketch/parser';
export type * from '@dbsketch/parser';
export type * from '@dbsketch/layout';
export type * from '@dbsketch/render';
export { renderSvg } from '@dbsketch/render';
