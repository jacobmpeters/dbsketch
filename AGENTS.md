# AGENTS.md — dbsketch reference

Terse, exhaustive reference for LLMs and agents using dbsketch. For prose and motivation see [README.md](README.md).

## What it does

Compiles a database schema (DBML or SQL DDL) into a monospace ASCII/Unicode ERD diagram. Deterministic — same input always produces byte-identical output.

## How to invoke

```sh
# CLI (preferred for one-shot)
npx @dbsketch/cli path/to/schema.dbml
npx @dbsketch/cli path/to/schema.sql                  # SQL auto-detected by extension
echo 'Table u { id int }' | npx @dbsketch/cli         # stdin

# Library (for programmatic use)
import { compile, compileSql } from '@dbsketch/core';
const ascii = compile(dbmlSource, options?);
const ascii = compileSql(sqlSource, 'postgres', options?);
```

## DBML syntax (the subset dbsketch parses)

```dbml
Table users {
  id int [pk]                              // primary key marker
  email varchar
  age int [not null, default: 0, note: 'comment']  // attributes; non-PK non-FK ones are tolerated, not used
}

Table posts {
  id int [pk]
  user_id int [ref: > users.id]            // FK ref inline: > = many-to-one
  body varchar [ref: < comments.body]      // <  = one-to-many (reversed)
  link varchar [ref: - profiles.link]      // -  = one-to-one
  tag int [ref: <> tags.id]                // <> = many-to-many (router skips, surfaces in skippedRefs)
}

Ref: posts.user_id > users.id               // alternative: external Ref declaration
Ref posts_users: posts.user_id > users.id   // also valid

Table "Schema.Name" {                       // quoted identifiers (with spaces, schema-qualified)
  "Column Name" int
}

// Tolerated but ignored: Project blocks, TableGroup blocks, Enum blocks,
// Note blocks (block or attribute form), Indexes blocks, Checks blocks,
// schema-qualified identifiers, composite-column refs.

@layout { ... }                             // dbsketch-specific extension; see Hints below
```

SQL DDL: standard `CREATE TABLE` + `ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY/FOREIGN KEY`. Supported dialects: `postgres` (default; also reads SQLite cleanly), `mysql`, `mssql`, `snowflake`. `parseSql` runs the input through `@dbml/core`'s importer and feeds the resulting DBML into the same pipeline.

## CLI flags

| Flag | Effect |
|---|---|
| `--ascii` | 7-bit ASCII (`+`, `-`, `|`) instead of Unicode box-drawing |
| `--sql` | Force SQL DDL parsing (default for `.sql` files and stdin only with this flag) |
| `--dialect=NAME` | `postgres` (default), `mysql`, `mssql`, `snowflake` |
| `--no-infer-refs` | Skip PK-name-match relationship inference (only used when zero declared refs) |
| `--no-types` | Drop type annotations; column names only. Entities narrower |
| `--no-columns` | Collapse every entity to 3-row name-only box. Maximally compact |
| `-h`, `--help` | Show help |

## Library options

```ts
interface CompileOptions {
  glyphs?:      'unicode' | 'ascii'   // default 'unicode'
  inferRefs?:   'auto' | 'never'      // default 'auto' (infer only when zero declared)
  showTypes?:   boolean               // default true
  showColumns?: boolean               // default true; false → name-only boxes
}
```

## @layout hints reference

All hints go inside one `@layout { ... }` block at the top level. Multiple hints accumulate.

| Hint | Syntax | Effect |
|---|---|---|
| `pin` | `pin ENTITY at col N` / `at row N` / `at col N, row M` | Force entity placement to specific col-strip / row index |
| `center` | `center ENTITY` <br> `center ENTITY { left: A, B right: C, D }` | Override auto-detected hub. Optional left/right bias splits neighbors |
| `preserve_order` | `preserve_order` (global) <br> `preserve_order ENT1, ENT2` (per-entity) | Disable automatic column reordering optimization |
| `cluster` | `cluster "Label" { ENT1, ENT2, ... }` | Split into named sub-diagrams; cross-cluster FKs render as annotation rows |

### Hint conflicts and edge cases

- `pin` on `col` cannot place a child entity at-or-before its parent — surfaces `HintConflictError`.
- `@center` and `pin` on the same entity's col axis is rejected up front.
- `cluster` entities can be ghost-listed in multiple clusters (intentional — useful for hubs).
- Unclustered entities collect into a trailing `Other` cluster automatically.
- Auto hub detection caps at 1 hub. To get multi-hub layouts, declare 2+ explicit `@center` hints.

## Picking the right output mode

```
Schema size?
├── ≤ 20 tables   → default (full columns + types). Just run it.
├── ~20-40 tables → try --no-types first; if still too wide, --no-columns
└── 40+ tables    → cluster + (optionally) --no-columns
```

Specifics:

- **`--no-types`**: ~25-35% horizontal compression. Lose type info; keep column names + relationships.
- **`--no-columns`**: ~70% vertical, ~30% horizontal. Lose all column detail; keep entity names + relationships. Best for one-page overview of large schemas.
- **`cluster`**: each diagram is bounded in size, but you get N diagrams. Cross-cluster refs become `↳ target.col (Cluster)` annotation rows. Best for documenting a large schema as multiple focused views.

See [docs/large-schemas.md](docs/large-schemas.md) for a worked OMOP CDM example.

## What dbsketch doesn't draw (silent skips, surfaced in `Layout.skippedRefs`)

- Many-to-many refs (`<>`). Router has no clean way to draw bi-directional cardinality.
- Same-col edges with no adjacent channel (e.g., a single-col diagram with a self-FK). Router needs at least one adjacent channel to route around.

Other refs are always drawn.

## Determinism guarantees

- Same DBML in → byte-identical ASCII out, every time.
- No clock-seeded randomness, no `Map`/`Set` iteration without explicit sort, no parallel ordering deps.
- Layout optimizations (column ordering, local spines) are deterministic searches; they always pick the same winner on the same input.

## Library types worth knowing

```ts
import type { Layout, RouteStats } from '@dbsketch/layout';
import { layout, routeStats } from '@dbsketch/layout';

const l: Layout = layout(parse(dbml));
const stats: RouteStats = routeStats(l);
// stats.crossings:    number of geometric H×V intersections
// stats.totalVLength: sum of V-segment lengths (proxy for routing compactness)
// l.skippedRefs:      refs the router couldn't draw
```

## Common patterns

**Generate a diagram from a schema described in prose:**
1. Write DBML matching the description.
2. Run `compile(dbml)`. Read the output.
3. If wide, add `--no-types`. If still wide, `--no-columns`. If huge, add `cluster` hints partitioning logically.

**Embed in markdown:**
- Wrap output in a fenced code block. GitHub renders fine. Tight line-height matters for some viewers — see README's `## Viewing` section.

**Run as part of a CI / docs pipeline:**
- Use the library API (`@dbsketch/core`). Determinism makes diffs in version control meaningful.

## Repo layout (for contribution)

- `packages/parser` — DBML + SQL → IR; tolerant of full DBML surface.
- `packages/layout` — Strip-grid placement + routing; the core algorithm.
- `packages/render` — IR + layout → ASCII/Unicode string.
- `packages/core` — Orchestration; the public API.
- `packages/cli` — Node CLI wrapper.

Run tests: `pnpm test`. Lint: `pnpm lint`. Build: `pnpm build`.

## See also

- [README.md](README.md) — motivation, philosophy, design decisions
- [docs/large-schemas.md](docs/large-schemas.md) — three-technique walkthrough for big schemas
