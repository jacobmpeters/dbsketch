# dbsketch

ASCII-art ERD diagrams from DBML or SQL, designed to look clean by default and live happily inside a README, a docstring, or an LLM prompt.

```
╭────────────────────╮  ╭────────────────────╮  ╭───────────────────╮  ╭────────────────────╮  ╭────────────────────╮
│    dim_country     │  │     dim_region     │  │     dim_date      │  │     fact_sales     │  │    dim_product     │
├────────────────────┤  ├────────────────────┤  ├───────────────────┤  ├────────────────────┤  ├────────────────────┤
│·country_id INTEGER ├╮ │·region_id  INTEGER ├╮ │·date_key     DATE ├╮ │·sale_id     BIGINT │╭─┤·product_id INTEGER │
│ name       VARCHAR ││ │ name       VARCHAR ││ │ year      INTEGER │╰─┤ date_key      DATE ││ │ sku        VARCHAR │
╰────────────────────╯╰─┤ country_id INTEGER ││ │ month     INTEGER │╭─┤ store_id   INTEGER ││ │ name       VARCHAR │
                        ╰────────────────────╯│ ╰───────────────────╯│ │ product_id INTEGER ├╯ ╰────────────────────╯
                                              │                      │ │ quantity   INTEGER │
                                              │ ╭───────────────────╮│ │ revenue    DECIMAL │
                                              │ │     dim_store     ││ ╰────────────────────╯
                                              │ ├───────────────────┤│
                                              │ │·store_id  INTEGER ├╯
                                              │ │ name      VARCHAR │
                                              ╰─┤ region_id INTEGER │
                                                ╰───────────────────╯
```

> **A note on viewing.** Diagrams are monospace text. They look best in a terminal, a code editor, or any markdown renderer that horizontally scrolls fenced code blocks (GitHub and most modern editors do; some viewers will wrap the lines and the box-drawing will fall apart). They also assume **tight line-height** — the vertical box-drawing characters (`│`) are sized to touch between rows, so any extra leading produces visible gaps. Terminals, editors, and code blocks render with line-height 1.0 by default; prose-mode markdown sometimes doesn't. For the cleanest experience, view a diagram in your terminal: `dbsketch schema.dbml`. The examples below are all real CLI output.

## Why this exists

Existing ERD tools — Mermaid, dbdiagram, GraphViz — lay out in continuous 2D space and project onto a grid. The projection is where things break: variable-width entities don't snap cleanly, edges meet boxes off-center, dense schemas need manual repositioning to be readable. Most of them produce SVG/PNG output that you can't paste into a README, a CHANGELOG entry, or a prompt.

dbsketch designs for the integer character grid from cell zero. Output is the algorithm's native form — no projection step, no approximation gap, no manual tweaking for the 90% case. When the algorithm picks something ugly, a one-line hint fixes that one thing.

## Quick start

```sh
npm install -g dbsketch
```

Given a DBML file:

```dbml
Table users {
  id int [pk]
  email varchar
}
Table posts {
  id int [pk]
  user_id int [ref: > users.id]
  title varchar
}
Table comments {
  id int [pk]
  post_id int [ref: > posts.id]
  user_id int [ref: > users.id]
  body varchar
}
```

```sh
dbsketch blog.dbml
```

```
                 ╭──────────────────╮
                 │                  │
╭───────────────╮│ ╭───────────────╮│ ╭──────────────╮
│     users     ││ │     posts     ││ │   comments   │
├───────────────┤│ ├───────────────┤│ ├──────────────┤
│·id        int ├╯╮│·id        int ├│╮│·id       int │
│ email varchar │ ╰┤ user_id   int ││╰┤ post_id  int │
╰───────────────╯  │ title varchar │╰─┤ user_id  int │
                   ╰───────────────╯  │ body varchar │
                                      ╰──────────────╯
```

SQL works too:

```sh
dbsketch schema.sql
dbsketch --sql --dialect=mysql < schema.sql
```

Library API:

```ts
import { compile, compileSql } from '@dbsketch/core';

const ascii = compile(dbmlSource);
const ascii = compileSql(sqlSource, 'postgres');
```

## What it's for

- **README and docs.** Diagrams that live in version-controlled text, render in any markdown viewer, and produce meaningful diffs.
- **LLM prompts.** ASCII ERDs are dense, accurate context for code-generation agents. SVG image diagrams aren't.
- **Code review.** A schema change becomes a readable diff in the diagram, not a blob change in a binary.
- **Terminal-first workflows.** No browser, no image viewer, no copy-from-design-tool round-trip.

## Philosophy: no fuss

dbsketch is opinionated about three things and indifferent about the rest:

1. **Deterministic.** Same input, byte-identical output. Diffs are meaningful, snapshot tests are reliable, CI pipelines are stable.
2. **Clean by default.** The algorithm produces something readable on every schema we've thrown at it (real and synthetic), with no flags or hints. When it doesn't, one hint fixes it.
3. **Code-first.** No GUIs, no themes, no color, no drag-to-reposition. The schema is the source of truth; the diagram is a derived view.

If you want to manually route an edge or change a font, this isn't the tool.

## Examples

### Star schema (auto-centered hub)

For a fact table with many dimensions, dbsketch detects the hub and places it in the center:

```
╭───────────────╮   ╭──────────────────╮   ╭──────────────╮
│  channel_dim  │   │    sales_fact    │   │ currency_dim │
├───────────────┤   ├──────────────────┤   ├──────────────┤
│·id        int ├╮  │·id           int │╭──┤·id       int │
│ name  varchar ││  │ date_id      int ├│╮ │ code varchar │
╰───────────────╯│  │ product_id   int ├││╮╰──────────────╯
                 │  │ store_id     int ├│╮│
╭───────────────╮│╭─┤ customer_id  int ││││╭──────────────╮
│ customer_dim  ││╭─┤ promotion_id int │││││   date_dim   │
├───────────────┤╰│─┤ channel_id   int ││││├──────────────┤
│·id        int ├─┤ │ currency_id  int ├╯├│┤·id       int │
│ email varchar │ │╭┤ employee_id  int │ │││ date    date │
╰───────────────╯ │││ quantity     int │ ││╰──────────────╯
                  │││ unit_price   int │ ││
╭───────────────╮ │││ total        int │ ││╭──────────────╮
│ employee_dim  │ ││╰──────────────────╯ │││ product_dim  │
├───────────────┤ ││                     ││├──────────────┤
│·id        int ├─│╯                     │╰┤·id       int │
│ name  varchar │ │                      │ │ sku  varchar │
╰───────────────╯ │                      │ ╰──────────────┘
```

`·` marks primary key columns. Tees on the entity border (`├`, `┤`) mark relationship endpoints.

### Multi-hub OLTP (no top-margin routing needed)

```
╭─────────────────────────────╮  ╭───────────────────────╮  ╭──────────────────────────╮  ╭───────────────────────╮
│         person_map          │  │      respondent       │  │     response_session     │  │      admin_event      │
├─────────────────────────────┤  ├───────────────────────┤  ├──────────────────────────┤  ├───────────────────────┤
│·respondent_id       integer ├──┤·respondent_id integer ├╮ │·session_id       integer ├╮ │·event_id      integer │
│ identity_hash          text │╭─┤ study_id      integer │╰─┤ respondent_id    integer │╰─┤ session_id    integer │
│ identity_type          text ││ │ external_id      text │  │ questionnaire_id integer ││ │ event_type       text │
╰─────────────────────────────╯│ │ enrollment_date  text │  │ started_at          text ││ │ occurred_at      text │
                               │ ╰───────────────────────╯  │ completed_at        text ││ │ performed_by     text │
╭─────────────────────────────╮│                            │ admin_mode          text ││ ╰───────────────────────╯
│            study            ││                            │ fhir_response_id    text ││
├─────────────────────────────┤│                            ╰──────────────────────────╯│ ╭───────────────────────╮
│·study_id            integer ├╯                                                        │ │       response        │
│ name                   text │                                                         │ ├───────────────────────┤
│ principal_investigator text │                                                         │ │·response_id   integer │
│ irb_number             text │                                                         ╰─┤ session_id    integer │
│ license                text │                                                           │ qq_id         integer │
│ doi                    text │                                                           │ option_id     integer │
╰─────────────────────────────╯                                                           │ response_text    text │
                                                                                          │ response_numeric real │
                                                                                          │ response_date    text │
                                                                                          │ repeat_index  integer │
                                                                                          ╰───────────────────────╯
```

## How it works (brief)

The canvas is a **strip grid** — alternating node strips (where entities sit) and channel strips (where edges route). Coordinates are integer cells from start to finish; nothing is laid out in continuous space and projected.

- **Layout.** Auto-detected hub (highest-degree entity) goes in the center, with neighbors fanning out left and right by FK distance. Entities pack tightly per column.
- **Routing.** Each edge decomposes into horizontal and vertical segments. Segments within a channel pack onto tracks via interval scheduling (greedy, O(n log n)). Multi-hop edges route through a shared top margin above all entities. Edges that share a parent port collapse into a single trunk that branches.
- **Rendering.** Each cell holds one glyph. Bend cells use direction-set merging so corners upgrade to tees naturally and horizontal-meets-vertical produces the conventional "h passes under v" gap.

The whole pipeline is single-pass and runs in low milliseconds for schemas of dozens of tables. A 100-entity star schema compiles in under 4ms.

By restricting ourselves to monospace UTF-8 box-drawing characters, the algorithm sidesteps every continuous-space problem: there's no font-metric ambiguity, no kerning, no anti-aliasing, no DPI. Cells align because they're cells. There's no aesthetic knob to fuss with because the medium doesn't offer one.

## When defaults don't fit

Five opt-in behaviors, all simple. Most schemas need none of them.

### `--no-types` (compact name-only mode)

Default:

```
╭────────────────────╮  ╭────────────────────╮
│    dim_country     │  │     dim_region     │
├────────────────────┤  ├────────────────────┤
│·country_id INTEGER │  │·region_id  INTEGER │
│ name       VARCHAR │  │ name       VARCHAR │
╰────────────────────╯  │ country_id INTEGER │
                        ╰────────────────────╯
```

`--no-types`:

```
╭─────────────╮  ╭────────────╮
│ dim_country │  │ dim_region │
├─────────────┤  ├────────────┤
│·country_id  │  │·region_id  │
│ name        │  │ name       │
╰─────────────╯  │ country_id │
                 ╰────────────╯
```

Useful when types are noise — high-level structural overviews, narrow rendering contexts.

### `--no-infer-refs` (skip relationship inference)

When a SQL schema declares no `FOREIGN KEY`s (common in warehouses), dbsketch infers relationships from PK-name matches: a non-PK column named `respondent_id` in one table that matches a PK column named `respondent_id` in another becomes a one-to-many ref. Pass `--no-infer-refs` to skip this and render only declared relationships.

### `--ascii` (7-bit ASCII glyphs)

Falls back to `+`, `-`, `|` and `*` for environments where Unicode box-drawing doesn't render cleanly.

### `--sql` and `--dialect=NAME`

SQL DDL input. Dialect defaults to `postgres` (which also reads SQLite cleanly). Other supported dialects: `mysql`, `mssql`, `snowflake`.

### `@layout` hints (DBML extension)

Pin an entity to a specific column or row:

```dbml
@layout {
  pin users at col 0, row 0
}
```

Override the auto-detected hub or bias which entities sit on which side:

```dbml
@layout {
  center sales_fact { left: date_dim, customer_dim right: store_dim, product_dim }
}
```

Both hints are local to one pipeline stage. They don't cascade and don't surprise.

## CLI reference

```
Usage: dbsketch [options] [file.dbml|file.sql]

Reads DBML or SQL DDL from a file (or stdin if omitted) and writes
the rendered ERD to stdout. SQL inputs are detected by the .sql
extension; for stdin, use --sql to force SQL mode.

Options:
  --ascii            Use 7-bit ASCII glyphs (+, -, |) instead of Unicode
  --sql              Treat input as SQL DDL (forced for stdin)
  --dialect=NAME     SQL dialect: postgres (default), mysql, mssql, snowflake
  --no-infer-refs    Don't infer relationships from PK-name matches when
                     the schema declares none (default: infer)
  --no-types         Render column names only, no data types. Entities are
                     correspondingly narrower
  -h, --help         Show this help
```

## Library API

```ts
import { compile, compileSql } from '@dbsketch/core';

compile(dbmlSource, options?)
compileSql(sqlSource, dialect?, options?)

// Options:
// {
//   glyphs?:     'unicode' | 'ascii'   // default 'unicode'
//   inferRefs?:  'auto' | 'never'      // default 'auto'
//   showTypes?:  boolean               // default true
// }
```

The lower-level packages (`@dbsketch/parser`, `@dbsketch/layout`, `@dbsketch/render`) are also published if you want to walk the IR or layout directly.

## Worked example: narrowing a wide diagram with a hint

The snowflake schema from the top of this README, as DBML:

```dbml
Table dim_date     { date_key date [pk] year integer month integer }
Table dim_country  { country_id integer [pk] name varchar }
Table dim_region   { region_id integer [pk] name varchar country_id integer [ref: > dim_country.country_id] }
Table dim_store    { store_id integer [pk] name varchar region_id integer [ref: > dim_region.region_id] }
Table dim_product  { product_id integer [pk] sku varchar name varchar }
Table fact_sales {
  sale_id bigint [pk]
  date_key date [ref: > dim_date.date_key]
  store_id integer [ref: > dim_store.store_id]
  product_id integer [ref: > dim_product.product_id]
  quantity integer
  revenue decimal
}
```

Default rendering puts `fact_sales` in the center with dim subtrees fanning out left and right — five columns wide:

```
╭────────────────────╮  ╭────────────────────╮  ╭───────────────────╮  ╭────────────────────╮  ╭────────────────────╮
│    dim_country     │  │     dim_region     │  │     dim_date      │  │     fact_sales     │  │    dim_product     │
├────────────────────┤  ├────────────────────┤  ├───────────────────┤  ├────────────────────┤  ├────────────────────┤
│·country_id integer ├╮ │·region_id  integer ├╮ │·date_key     date ├╮ │·sale_id     bigint │╭─┤·product_id integer │
│ name       varchar ││ │ name       varchar ││ │ year      integer │╰─┤ date_key      date ││ │ sku        varchar │
╰────────────────────╯╰─┤ country_id integer ││ │ month     integer │╭─┤ store_id   integer ││ │ name       varchar │
                        ╰────────────────────╯│ ╰───────────────────╯│ │ product_id integer ├╯ ╰────────────────────╯
                                              │                      │ │ quantity   integer │
                                              │ ╭───────────────────╮│ │ revenue    decimal │
                                              │ │     dim_store     ││ ╰────────────────────╯
                                              │ ├───────────────────┤│
                                              │ │·store_id  integer ├╯
                                              │ │ name      varchar │
                                              ╰─┤ region_id integer │
                                                ╰───────────────────╯
```

To narrow it to four columns, wrap `dim_product` below `dim_date` by pinning it. Append this to the DBML:

```dbml
@layout {
  pin dim_product at col 2, row 2
}
```

```
╭────────────────────╮  ╭────────────────────╮  ╭────────────────────╮  ╭────────────────────╮
│    dim_country     │  │     dim_region     │  │      dim_date      │  │     fact_sales     │
├────────────────────┤  ├────────────────────┤  ├────────────────────┤  ├────────────────────┤
│·country_id integer ├╮ │·region_id  integer ├╮ │·date_key      date ├╮ │·sale_id     bigint │
│ name       varchar ││ │ name       varchar ││ │ year       integer │╰─┤ date_key      date │
╰────────────────────╯╰─┤ country_id integer ││ │ month      integer │ ╭┤ store_id   integer │
                        ╰────────────────────╯│ ╰────────────────────╯╭│┤ product_id integer │
                                              │                       │││ quantity   integer │
                                              │ ╭────────────────────╮│││ revenue    decimal │
                                              │ │     dim_store      │││╰────────────────────╯
                                              │ ├────────────────────┤││
                                              │ │·store_id   integer ├│╯
                                              │ │ name       varchar ││
                                              ╰─┤ region_id  integer ││
                                                ╰────────────────────╯│
                                                                      │
                                                ╭────────────────────╮│
                                                │    dim_product     ││
                                                ├────────────────────┤│
                                                │·product_id integer ├╯
                                                │ sku        varchar │
                                                │ name       varchar │
                                                ╰────────────────────╯
```

Same schema, same algorithm — one hint to encode local intent.

> **Caveat.** Pinning two related entities into the same column drops the edge between them silently (same-column edges aren't routable). Pin into neighboring columns instead; the routing engine handles forward and backward flow when an `@center` is active.

## License

MIT.
