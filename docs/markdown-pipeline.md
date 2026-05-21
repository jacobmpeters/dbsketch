# Markdown pipeline demo

This file demonstrates the `--render-markdown` workflow end-to-end. The DBML
schema lives inside an HTML comment, invisible to readers on GitHub. Running
the command below inserts (or updates) the rendered diagram automatically.

```sh
dbsketch --render-markdown markdown-pipeline.md
```

Re-running the command is safe — the rendered block is replaced in place,
never duplicated.

<!-- dbsketch
Table sales_fact {
  id int [pk]
  date_id int [ref: > date_dim.id]
  product_id int [ref: > product_dim.id]
  customer_id int [ref: > customer_dim.id]
  store_id int [ref: > store_dim.id]
  quantity int
  revenue decimal
}
Table date_dim { id int [pk] date date year int quarter int month int }
Table product_dim { id int [pk] name varchar category varchar brand varchar price decimal }
Table customer_dim { id int [pk] name varchar email varchar region varchar segment varchar }
Table store_dim { id int [pk] name varchar city varchar country varchar region varchar }
-->

```dbsketch-rendered
                                           ╭─────────────────╮
╭──────────────────╮                       │    date_dim     │
│   product_dim    │                       ├─────────────────┤
├──────────────────┤  ╭─────────────────╮╭─┤·id          int │
│·id           int ├╮ │   sales_fact    ││ │ date       date │
│ name     varchar ││ ├─────────────────┤│ │ year        int │
│ category varchar ││ │·id          int ││ │ quarter     int │
│ brand    varchar ││ │ date_id     int ├╯ │ month       int │
│ price    decimal │╰─┤ product_id  int │  ╰─────────────────╯
╰──────────────────╯╭─┤ customer_id int │
                    │ │ store_id    int ├╮ ╭─────────────────╮
╭──────────────────╮│ │ quantity    int ││ │    store_dim    │
│   customer_dim   ││ │ revenue decimal ││ ├─────────────────┤
├──────────────────┤│ ╰─────────────────╯╰─┤·id          int │
│·id           int ├╯                      │ name    varchar │
│ name     varchar │                       │ city    varchar │
│ email    varchar │                       │ country varchar │
│ region   varchar │                       │ region  varchar │
│ segment  varchar │                       ╰─────────────────╯
╰──────────────────╯
```

The schema above is a classic star schema: a central fact table surrounded by
dimension tables. The `<!-- dbsketch -->` comment is invisible when rendered on
GitHub — only the diagram below is visible to readers.

---

## SQL input

SQL DDL works the same way. Add `--sql` to the comment tag and dbsketch will
parse it as SQL instead of DBML. The dialect defaults to `postgres`; pass
`--dialect=mysql` (or `mssql`, `snowflake`) to override.

<!-- dbsketch --sql
CREATE TABLE date_dim (
  id    SERIAL PRIMARY KEY,
  date  DATE,
  year  INT,
  quarter INT,
  month INT
);
CREATE TABLE product_dim (
  id       SERIAL PRIMARY KEY,
  name     VARCHAR,
  category VARCHAR,
  brand    VARCHAR,
  price    DECIMAL
);
CREATE TABLE customer_dim (
  id      SERIAL PRIMARY KEY,
  name    VARCHAR,
  email   VARCHAR,
  region  VARCHAR,
  segment VARCHAR
);
CREATE TABLE store_dim (
  id      SERIAL PRIMARY KEY,
  name    VARCHAR,
  city    VARCHAR,
  country VARCHAR,
  region  VARCHAR
);
CREATE TABLE sales_fact (
  id          SERIAL PRIMARY KEY,
  date_id     INT REFERENCES date_dim(id),
  product_id  INT REFERENCES product_dim(id),
  customer_id INT REFERENCES customer_dim(id),
  store_id    INT REFERENCES store_dim(id),
  quantity    INT,
  revenue     DECIMAL
);
-->

Same schema, SQL dialect. Foreign keys from `REFERENCES` are extracted
automatically — no manual `Ref:` declarations needed.

---

## How it works

1. Write your schema inside a `<!-- dbsketch ... -->` HTML comment anywhere in
   a Markdown file.
2. Run `dbsketch --render-markdown <file.md>`.
3. A ` ```dbsketch-rendered ``` ` fenced block is inserted immediately after
   the comment (or updated if one already exists).
4. Commit both the comment and the rendered block. The comment is your source
   of truth; the rendered block is what readers see.

**The rendered block must sit immediately after the closing `-->`.** Prose
that belongs between the comment and the diagram should go after the rendered
block instead.

**Reference an external schema file** rather than inlining DBML:

```markdown
<!-- dbsketch src="schema.dbml" -->
```

The path is resolved relative to the Markdown file.

**Automate with a pre-commit hook** so the diagram always stays in sync:

> **Note:** Rendered diagrams require `line-height: 1` to display correctly. Most terminals and code editors do this by default; some docs sites (MkDocs, Docusaurus) need a small CSS override. See the [Viewing section](../README.md#viewing) in the README.

```sh
# .husky/pre-commit
git diff --cached --name-only | grep '\.md$' | xargs -I{} dbsketch --render-markdown {}
git add -u
```
