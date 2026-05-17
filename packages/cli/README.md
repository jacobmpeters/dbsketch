# @dbsketch/cli

Command-line tool for [dbsketch](https://github.com/jacobmpeters/dbsketch) — code-first ASCII/Unicode ERD diagrams from DBML or SQL.

```sh
npm install -g @dbsketch/cli
```

```sh
dbsketch schema.dbml         # Unicode (default)
dbsketch schema.dbml --ascii # 7-bit ASCII
dbsketch schema.sql          # SQL auto-detected by extension
dbsketch --sql --dialect=mysql < schema.sql
```

Output goes to stdout; pipe it into a file, a clipboard tool, or a markdown block.

See the [project README](https://github.com/jacobmpeters/dbsketch#readme) for examples, philosophy, and the `@layout` hint syntax.
