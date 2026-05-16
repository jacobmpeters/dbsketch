import { importer } from '@dbml/core';
import { parse } from './parser.js';
import type { IR } from './types.js';

// Dialects handled by @dbml/core's importer. SQLite isn't in the list but
// SQLite DDL is largely a subset of PostgreSQL and parses cleanly under
// 'postgres' in practice — see the quickq fixtures.
export type SqlDialect = 'postgres' | 'mysql' | 'mssql' | 'snowflake';

// Convert SQL DDL to DBML via @dbml/core, then run our parser. The
// intermediate DBML is real-world-style (quoted identifiers, external
// Ref declarations, multi-attribute brackets) which our parser handles
// after Phase A.
export function parseSql(sql: string, dialect: SqlDialect = 'postgres'): IR {
  const dbml = importer.import(sql, dialect);
  return parse(dbml);
}
