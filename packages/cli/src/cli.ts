import { parseArgs } from 'node:util';
import { type SqlDialect, compile, compileSql } from '@dbsketch/core';

export interface CliDeps {
  readFile: (path: string) => string;
  readStdin: () => string;
  stdinIsTty: boolean;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const USAGE = `Usage: dbsketch [options] [file.dbml|file.sql]

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
`;

const VALID_DIALECTS: SqlDialect[] = ['postgres', 'mysql', 'mssql', 'snowflake'];

export function runCli(args: string[], deps: CliDeps): CliResult {
  let values: {
    ascii?: boolean | undefined;
    sql?: boolean | undefined;
    dialect?: string | undefined;
    'no-infer-refs'?: boolean | undefined;
    'no-types'?: boolean | undefined;
    help?: boolean | undefined;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args,
      options: {
        ascii: { type: 'boolean', default: false },
        sql: { type: 'boolean', default: false },
        dialect: { type: 'string' },
        'no-infer-refs': { type: 'boolean', default: false },
        'no-types': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    return { stdout: '', stderr: `error: ${(e as Error).message}\n${USAGE}`, exitCode: 1 };
  }

  if (values.help) {
    return { stdout: USAGE, stderr: '', exitCode: 0 };
  }

  let input: string;
  let path: string | undefined;
  if (positionals.length > 0) {
    path = positionals[0]!;
    try {
      input = deps.readFile(path);
    } catch (e) {
      return { stdout: '', stderr: `error: ${(e as Error).message}\n`, exitCode: 1 };
    }
  } else if (!deps.stdinIsTty) {
    input = deps.readStdin();
  } else {
    return { stdout: '', stderr: USAGE, exitCode: 1 };
  }

  const isSql = values.sql === true || (path !== undefined && /\.sql$/i.test(path));

  let dialect: SqlDialect = 'postgres';
  if (values.dialect !== undefined) {
    if (!VALID_DIALECTS.includes(values.dialect as SqlDialect)) {
      return {
        stdout: '',
        stderr: `error: invalid --dialect '${values.dialect}' (expected one of: ${VALID_DIALECTS.join(', ')})\n`,
        exitCode: 1,
      };
    }
    dialect = values.dialect as SqlDialect;
  }

  const opts = {
    glyphs: values.ascii ? ('ascii' as const) : ('unicode' as const),
    inferRefs: values['no-infer-refs'] ? ('never' as const) : ('auto' as const),
    showTypes: !values['no-types'],
  };

  try {
    const out = isSql ? compileSql(input, dialect, opts) : compile(input, opts);
    const padded = out.length > 0 && !out.endsWith('\n') ? `${out}\n` : out;
    return { stdout: padded, stderr: '', exitCode: 0 };
  } catch (e) {
    return { stdout: '', stderr: `error: ${(e as Error).message}\n`, exitCode: 1 };
  }
}
