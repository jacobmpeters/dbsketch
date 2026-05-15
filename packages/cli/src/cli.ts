import { parseArgs } from 'node:util';
import { compile } from '@ascii-erd/core';

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

export const USAGE = `Usage: ascii-erd [options] [file.dbml]

Reads DBML from a file (or stdin if omitted) and writes the rendered
ERD to stdout.

Options:
  --ascii      Use 7-bit ASCII glyphs (+, -, |) instead of Unicode
  -h, --help   Show this help
`;

export function runCli(args: string[], deps: CliDeps): CliResult {
  let values: { ascii?: boolean | undefined; help?: boolean | undefined };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args,
      options: {
        ascii: { type: 'boolean', default: false },
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
  if (positionals.length > 0) {
    try {
      input = deps.readFile(positionals[0]!);
    } catch (e) {
      return { stdout: '', stderr: `error: ${(e as Error).message}\n`, exitCode: 1 };
    }
  } else if (!deps.stdinIsTty) {
    input = deps.readStdin();
  } else {
    return { stdout: '', stderr: USAGE, exitCode: 1 };
  }

  try {
    const out = compile(input, { glyphs: values.ascii ? 'ascii' : 'unicode' });
    const padded = out.length > 0 && !out.endsWith('\n') ? `${out}\n` : out;
    return { stdout: padded, stderr: '', exitCode: 0 };
  } catch (e) {
    return { stdout: '', stderr: `error: ${(e as Error).message}\n`, exitCode: 1 };
  }
}
