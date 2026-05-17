# dbsketch

ASCII-art ERD diagrams from DBML or SQL, designed to look clean by default and live happily inside a README, a docstring, or an LLM prompt.

A claims warehouse, compiled from raw SQL with no `FOREIGN KEY`s declared — all relationships inferred from PK-name matches:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.svg">
  <img alt="dbsketch hero diagram: claims warehouse ERD with fact_claim_line at the center and seven dimension tables fanning out." src="docs/hero.svg">
</picture>

<details><summary>Copy as text</summary>

```
╭───────────────╮  ╭──────────────────╮  ╭──────────────────────╮  ╭───────────────────╮
│  dim_region   │  │     dim_date     │  │   fact_claim_line    │  │   dim_provider    │
├───────────────┤  ├──────────────────┤  ├──────────────────────┤  ├───────────────────┤
│·region_id INT ├╮ │·date_key    DATE ├╮ │·claim_line_id BIGINT │ ╭┤·provider_id   INT │
│ name  VARCHAR ││ │ year         INT │╰─┤ date_key        DATE │ ││ specialty VARCHAR │
╰───────────────╯│ │ quarter      INT │╭─┤ patient_id       INT │ ││ tier      VARCHAR │
                 │ ╰──────────────────╯│ │ provider_id      INT ├─╯╰───────────────────╯
                 │                     │ │ payer_id         INT ├─╮
                 │ ╭──────────────────╮│ │ diagnosis_id     INT ├╮│╭───────────────────╮
                 │ │   dim_patient    ││╭┤ procedure_id     INT ││││     dim_payer     │
                 │ ├──────────────────┤│││ quantity         INT │││├───────────────────┤
                 │ │·patient_id   INT ├╯││ charge       DECIMAL ││╰┤·payer_id      INT │
                 │ │ age_band VARCHAR │ ││ paid         DECIMAL ││ │ plan_name VARCHAR │
                 │ │ sex      VARCHAR │ │╰──────────────────────╯│ │ plan_type VARCHAR │
                 ╰─┤ region_id    INT │ │                        │ ╰───────────────────╯
                   ╰──────────────────╯ │                        │
                                        │                        │ ╭───────────────────╮
                   ╭──────────────────╮ │                        │ │   dim_diagnosis   │
                   │  dim_procedure   │ │                        │ ├───────────────────┤
                   ├──────────────────┤ │                        ╰─┤·diagnosis_id  INT │
                   │·procedure_id INT ├─╯                          │ icd_code  VARCHAR │
                   │ cpt_code VARCHAR │                            │ category  VARCHAR │
                   │ category VARCHAR │                            ╰───────────────────╯
                   ╰──────────────────╯
```

</details>

> The hero above is an SVG; everything below is real monospace text and assumes **`line-height: 1`**. Terminals and editors do that by default; markdown viewers vary. See [Viewing](#viewing) if a diagram renders with gaps.

## Why this exists

Existing ERD tools — Mermaid, dbdiagram, GraphViz — lay out in continuous 2D space and project onto a grid. The projection is where things break: variable-width entities don't snap cleanly, edges meet boxes off-center, dense schemas need manual repositioning to be readable. Most of them produce SVG/PNG output that you can't paste into a README, a CHANGELOG entry, or a prompt.

dbsketch designs for the integer character grid from cell zero. Output is the algorithm's native form — no projection step, no approximation gap, no manual tweaking for the 90% case. When the algorithm picks something ugly, a one-line hint fixes that one thing.

## Quick start

```sh
npm install -g @dbsketch/cli
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

### Clinical OLTP (transactional schema with a clear hub)

An EHR-style schema centered on the `encounter` table — the visit that ties patient, provider, diagnoses, medications, and vitals together. The hub is detected automatically; sibling tables order themselves by where they attach on `encounter` so related rows sit close to their FK columns.

```dbml
Table patient   { id int [pk] mrn varchar name varchar dob date }
Table provider  { id int [pk] npi varchar name varchar specialty varchar }
Table encounter {
  id int [pk]
  patient_id int [ref: > patient.id]
  provider_id int [ref: > provider.id]
  encounter_type varchar
  started_at timestamp
  ended_at timestamp
}
Table diagnosis  { id int [pk] encounter_id int [ref: > encounter.id] icd_code varchar description varchar }
Table medication { id int [pk] encounter_id int [ref: > encounter.id] prescriber_id int [ref: > provider.id] name varchar dose varchar }
Table vital      { id int [pk] encounter_id int [ref: > encounter.id] measure varchar value decimal recorded_at timestamp }
```

```
╭───────────────────────╮  ╭────────────────────────╮   ╭───────────────────╮
│       diagnosis       │  │       encounter        │   │    medication     │
├───────────────────────┤  ├────────────────────────┤   ├───────────────────┤
│·id                int │╭─┤·id                 int ├╮  │·id            int │
│ encounter_id      int ├┤╭┤ patient_id         int │╰──┤ encounter_id  int │
│ icd_code      varchar ││││ provider_id        int ├─╭┬┤ prescriber_id int │
│ description   varchar ││││ encounter_type varchar │ │││ name      varchar │
╰───────────────────────╯│││ started_at   timestamp │ │││ dose      varchar │
                         │││ ended_at     timestamp │ ││╰───────────────────╯
╭───────────────────────╮││╰────────────────────────╯ ││
│         vital         │││                           ││╭───────────────────╮
├───────────────────────┤││                           │││     provider      │
│·id                int │││                           ││├───────────────────┤
│ encounter_id      int ├╯│                           ╰┴┤·id            int │
│ measure       varchar │ │                             │ npi       varchar │
│ value         decimal │ │                             │ name      varchar │
│ recorded_at timestamp │ │                             │ specialty varchar │
╰───────────────────────╯ │                             ╰───────────────────╯
                          │
╭───────────────────────╮ │
│        patient        │ │
├───────────────────────┤ │
│·id                int ├─╯
│ mrn           varchar │
│ name          varchar │
│ dob              date │
╰───────────────────────╯
```

Notice `provider` sits opposite `medication`, not stacked under `patient`: port-aware ordering placed it to align with `encounter.provider_id` (and `medication.prescriber_id`, also on the right), keeping those edges short.

## How it works (brief)

The canvas is a **strip grid** — alternating node strips (where entities sit) and channel strips (where edges route). Coordinates are integer cells from start to finish; nothing is laid out in continuous space and projected.

- **Layout.** Auto-detected hub (highest-degree entity) goes in the center, with neighbors fanning out left and right by FK distance. Entities pack tightly per column.
- **Sibling ordering.** Within a column, entities order by barycenter — the mean row position of their FK neighbors — so connected entities cluster together. For star schemas where every dim shares the same fact-table neighbor (and would all tie on raw barycenter), a port-aware tiebreaker sorts each dim by which row of the fact it attaches to. Result: dim_date sits next to fact.date_id, dim_currency sits next to fact.currency_id, edges are short and rarely cross.
- **Routing.** Each edge decomposes into horizontal and vertical segments. Segments within a channel pack onto tracks via interval scheduling (greedy, O(n log n)). Multi-hop edges route through a shared top margin above all entities. Edges that share a parent port collapse into a single trunk that branches. Self-FKs and edges between same-column entities route around the adjacent channel rather than silently dropping.
- **Rendering.** Each cell holds one glyph. Bend cells use direction-set merging so corners upgrade to tees naturally and horizontal-meets-vertical produces the conventional "h passes under v" gap.

The whole pipeline is single-pass and runs in low milliseconds for schemas of dozens of tables. A 100-entity star schema compiles in under 4ms.

By restricting ourselves to monospace UTF-8 box-drawing characters, the algorithm sidesteps every continuous-space problem: there's no font-metric ambiguity, no kerning, no anti-aliasing, no DPI. Cells align because they're cells. There's no aesthetic knob to fuss with because the medium doesn't offer one.

## When defaults don't fit

Five opt-in behaviors, all simple. Most schemas need none of them.

### `--no-types` (compact name-only mode)

Useful when types are noise — high-level structural overviews where you care about who-references-what, narrow rendering contexts, or dense schemas where every saved character matters. The savings compound: each entity gets narrower, and a narrower entity means narrower channels around it.

A real 12-entity schema (instrument design for a survey platform), with types — about 200 characters wide:

```
                                                                                 ╭─────────────────────────────────────────────────────────────╮
                                                                                 │                                                             │
╭───────────────────────╮  ╭───────────────────────╮  ╭─────────────────────────╮│ ╭──────────────────────────╮    ╭──────────────────────────╮│  ╭──────────────────────────╮  ╭─────────────────────────╮
│  response_option_set  │  │    response_option    │  │    scoring_rule_item    ││ │  questionnaire_question  │    │      questionnaire       ││  │       scoring_rule       │  │    scoring_category     │
├───────────────────────┤  ├───────────────────────┤  ├─────────────────────────┤│ ├──────────────────────────┤    ├──────────────────────────┤│  ├──────────────────────────┤  ├─────────────────────────┤
│·option_set_id integer ├╮ │·option_id     integer │  │ scoring_rule_id integer ├╭─┤·qq_id            integer ├┬╮╮─┤·questionnaire_id integer ├╰┬┬┤·scoring_rule_id  integer ├╮ │·category_id     integer │
│ name             text ││ │ question_id   integer ├╮ │ qq_id           integer ├╯ │ questionnaire_id integer ├╯││ │ study_id         integer │ │╰┤ questionnaire_id integer │╰─┤ scoring_rule_id integer │
│ canonical_url    text │╰─┤ option_set_id integer ││ │ weight             real ││╭┤ question_id      integer │ ││ │ name                text │ │ │ name                text │  │ label              text │
╰───────────────────────╯  │ option_text      text ││ │ reverse_score   boolean ││││ section_id       integer ├─││╮│ version             text │ │ │ formula             text │  │ min_score          real │
                           │ option_value     text ││ ╰─────────────────────────╯│││ parent_qq_id     integer ├─│╯││ canonical_url       text │ │ ╰──────────────────────────╯  │ max_score          real │
                           │ concept_id    integer ││                            │││ count_qq_id      integer ├─╯ │╰──────────────────────────╯ │                               ╰─────────────────────────╯
                           ╰───────────────────────╯│ ╭─────────────────────────╮│││ display_order    integer │   │                             │
                                                    │ │        skip_rule        ││││ required         boolean │   │╭──────────────────────────╮ │
                           ╭───────────────────────╮│ ├─────────────────────────┤││╰──────────────────────────╯   ││         section          │ │
                           │      grid_column      ││ │·skip_rule_id    integer │││                               │├──────────────────────────┤ │
                           ├───────────────────────┤│ │ qq_id           integer ├┤│                               ╰┤·section_id       integer │ │
                           │·column_id     integer ││ │ trigger_qq_id   integer ├╯│                                │ questionnaire_id integer ├─╯
                           │ question_id   integer ├╮ │ operator           text │ │                                │ name                text │
                           │ column_text      text ││ │ trigger_value      text │ │                                │ display_order    integer │
                           │ column_value     text ││ │ action             text │ │                                ╰──────────────────────────╯
                           ╰───────────────────────╯│ │ enable_behavior    text │ │
                                                    │ ╰─────────────────────────╯ │
                           ╭───────────────────────╮│                             │
                           │       grid_row        ││ ╭─────────────────────────╮ │
                           ├───────────────────────┤│ │        question         │ │
                           │·row_id        integer ││ ├─────────────────────────┤ │
                           │ question_id   integer ├╰─┤·question_id     integer ├─╯
                           │ row_text         text │  │ link_id            text │
                           │ display_order integer │  │ question_type      text │
                           ╰───────────────────────╯  │ question_text      text │
                                                      │ concept_id      integer │
                                                      │ version            text │
                                                      ╰─────────────────────────╯
```

Same schema with `--no-types` — about 165 characters wide (17% narrower), and the relationship structure is what your eye lands on first:

```
                                                                   ╭───────────────────────────────────────────────────╮
                                                                   │                                                   │
╭─────────────────────╮  ╭─────────────────╮  ╭───────────────────╮│ ╭────────────────────────╮    ╭──────────────────╮│  ╭──────────────────╮  ╭──────────────────╮
│ response_option_set │  │ response_option │  │ scoring_rule_item ││ │ questionnaire_question │    │  questionnaire   ││  │   scoring_rule   │  │ scoring_category │
├─────────────────────┤  ├─────────────────┤  ├───────────────────┤│ ├────────────────────────┤    ├──────────────────┤│  ├──────────────────┤  ├──────────────────┤
│·option_set_id       ├╮ │·option_id       │  │ scoring_rule_id   ├╭─┤·qq_id                  ├┬╮╮─┤·questionnaire_id ├╰┬┬┤·scoring_rule_id  ├╮ │·category_id      │
│ name                ││ │ question_id     ├╮ │ qq_id             ├╯ │ questionnaire_id       ├╯││ │ study_id         │ │╰┤ questionnaire_id │╰─┤ scoring_rule_id  │
│ canonical_url       │╰─┤ option_set_id   ││ │ weight            ││╭┤ question_id            │ ││ │ name             │ │ │ name             │  │ label            │
╰─────────────────────╯  │ option_text     ││ │ reverse_score     ││││ section_id             ├─││╮│ version          │ │ │ formula          │  │ min_score        │
                         │ option_value    ││ ╰───────────────────╯│││ parent_qq_id           ├─│╯││ canonical_url    │ │ ╰──────────────────╯  │ max_score        │
                         │ concept_id      ││                      │││ count_qq_id            ├─╯ │╰──────────────────╯ │                       ╰──────────────────╯
                         ╰─────────────────╯│ ╭───────────────────╮│││ display_order          │   │                     │
                                            │ │     skip_rule     ││││ required               │   │╭──────────────────╮ │
                         ╭─────────────────╮│ ├───────────────────┤││╰────────────────────────╯   ││     section      │ │
                         │   grid_column   ││ │·skip_rule_id      │││                             │├──────────────────┤ │
                         ├─────────────────┤│ │ qq_id             ├┤│                             ╰┤·section_id       │ │
                         │·column_id       ││ │ trigger_qq_id     ├╯│                              │ questionnaire_id ├─╯
                         │ question_id     ├╮ │ operator          │ │                              │ name             │
                         │ column_text     ││ │ trigger_value     │ │                              │ display_order    │
                         │ column_value    ││ │ action            │ │                              ╰──────────────────╯
                         ╰─────────────────╯│ │ enable_behavior   │ │
                                            │ ╰───────────────────╯ │
                         ╭─────────────────╮│                       │
                         │    grid_row     ││ ╭───────────────────╮ │
                         ├─────────────────┤│ │     question      │ │
                         │·row_id          ││ ├───────────────────┤ │
                         │ question_id     ├╰─┤·question_id       ├─╯
                         │ row_text        │  │ link_id           │
                         │ display_order   │  │ question_type     │
                         ╰─────────────────╯  │ question_text     │
                                              │ concept_id        │
                                              │ version           │
                                              ╰───────────────────╯
```

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

### Biasing which dimensions land on which side

For a fact-table-style schema, dbsketch auto-centers the highest-degree entity and splits its neighbors alphabetically between left and right. If you'd rather group them yourself, the `@center` hint takes optional `left:` and `right:` lists.

```dbml
Table fact_orders {
  order_id int [pk]
  date_key int [ref: > dim_date.date_key]
  customer_id int [ref: > dim_customer.customer_id]
  product_id int [ref: > dim_product.product_id]
  store_id int [ref: > dim_store.store_id]
  amount decimal
}
Table dim_date     { date_key int [pk] year int month int }
Table dim_customer { customer_id int [pk] email varchar segment varchar }
Table dim_product  { product_id int [pk] sku varchar name varchar }
Table dim_store    { store_id int [pk] name varchar region varchar }
```

Default centering (alphabetical split — `dim_customer` and `dim_product` end up on the left):

```
╭─────────────────╮  ╭─────────────────╮  ╭────────────────╮
│  dim_customer   │  │   fact_orders   │  │    dim_date    │
├─────────────────┤  ├─────────────────┤  ├────────────────┤
│·customer_id int ├╮ │·order_id    int │╭─┤·date_key   int │
│ email   varchar ││ │ date_key    int ├╯ │ year       int │
│ segment varchar │╰─┤ customer_id int │  │ month      int │
╰─────────────────╯ ╭┤ product_id  int │  ╰────────────────╯
                    ││ store_id    int ├─╮
╭─────────────────╮ ││ amount  decimal │ │╭────────────────╮
│   dim_product   │ │╰─────────────────╯ ││   dim_store    │
├─────────────────┤ │                    │├────────────────┤
│·product_id  int ├─╯                    ╰┤·store_id   int │
│ sku     varchar │                       │ name   varchar │
│ name    varchar │                       │ region varchar │
╰─────────────────╯                       ╰────────────────╯
```

With an explicit grouping — "who" dimensions on the left, "what/where" on the right:

```dbml
@layout {
  center fact_orders { left: dim_date, dim_customer right: dim_product, dim_store }
}
```

```
╭─────────────────╮  ╭─────────────────╮  ╭────────────────╮
│  dim_customer   │  │   fact_orders   │  │  dim_product   │
├─────────────────┤  ├─────────────────┤  ├────────────────┤
│·customer_id int ├╮ │·order_id    int │╭─┤·product_id int │
│ email   varchar ││╭┤ date_key    int ││ │ sku    varchar │
│ segment varchar │╰│┤ customer_id int ││ │ name   varchar │
╰─────────────────╯ ││ product_id  int ├╯ ╰────────────────╯
                    ││ store_id    int ├─╮
╭─────────────────╮ ││ amount  decimal │ │╭────────────────╮
│    dim_date     │ │╰─────────────────╯ ││   dim_store    │
├─────────────────┤ │                    │├────────────────┤
│·date_key    int ├─╯                    ╰┤·store_id   int │
│ year        int │                       │ name   varchar │
│ month       int │                       │ region varchar │
╰─────────────────╯                       ╰────────────────╯
```

`@center` also overrides the auto-detected hub if you want a different entity in the middle.

## Viewing

Text diagrams assume **`line-height: 1`** — the vertical box-drawing character (`│`) is sized to touch between rows, so any extra leading produces visible gaps. Terminals, editors, and code blocks render with line-height 1 by default; prose-mode markdown sometimes doesn't (notably GitHub's README renderer, which is why this README's hero is an SVG). For the cleanest experience, view a diagram in your terminal: `dbsketch schema.dbml`.

In docs sites where you control the CSS, one line fixes it. With MkDocs + Material (which enables `pymdownx.superfences` by default), tag your diagram fences:

````markdown
```{.dbsketch}
╭───╮
│ … │
╰───╯
```
````

…then in your extra CSS:

```css
.dbsketch { line-height: 1; }
```

Regular code blocks keep their comfortable spacing.

## License

MIT.
