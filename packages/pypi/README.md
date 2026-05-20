# dbsketch

ASCII/Unicode ERD diagrams from DBML or SQL schemas — designed to look clean in READMEs, docstrings, and LLM prompts.

```
pip install dbsketch
dbsketch schema.sql
dbsketch schema.dbml
```

No Node.js installation required — a suitable runtime is downloaded automatically on first use.

## Usage

```
dbsketch [options] <file>

Options:
  --no-types      Hide column types
  --no-columns    Show table names only
  --ascii         Use ASCII box-drawing (default: Unicode)
  --sql           Force SQL input mode (auto-detected from .sql extension)
```

## Example

```
dbsketch schema.sql > docs/erd.txt
```

## Web playground

Try it in the browser at **[dbsketch.dev](https://dbsketch.dev)**.

## More

Full documentation and source at [github.com/jacobmpeters/dbsketch](https://github.com/jacobmpeters/dbsketch).
