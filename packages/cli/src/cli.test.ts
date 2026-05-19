import { describe, expect, it } from 'vitest';
import { USAGE, runCli } from './cli.js';

function makeDeps(
  input: string,
  isTty = false,
  files: Record<string, string> = {},
): {
  readFile: (path: string) => string;
  readStdin: () => string;
  stdinIsTty: boolean;
  writeFile: (path: string, content: string) => void;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  return {
    readFile: (path: string) => {
      if (path in files) return files[path]!;
      return input;
    },
    readStdin: () => input,
    stdinIsTty: isTty,
    writeFile: (path: string, content: string) => {
      written.set(path, content);
    },
    written,
  };
}

describe('runCli', () => {
  it('renders DBML from a file argument', () => {
    const result = runCli(['users.dbml'], makeDeps('Table users { id int }'));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('users');
    expect(result.stdout).toContain('id int');
  });

  it('renders DBML from stdin when no file is given', () => {
    const result = runCli([], makeDeps('Table users { id int }'));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('users');
  });

  it('uses Unicode glyphs (rounded corners) by default', () => {
    const result = runCli(['users.dbml'], makeDeps('Table users { id int }'));
    expect(result.stdout).toContain('╭');
  });

  it('uses ASCII glyphs when --ascii is passed', () => {
    const result = runCli(['--ascii', 'users.dbml'], makeDeps('Table users { id int }'));
    expect(result.stdout).toContain('+');
    expect(result.stdout).toContain('|');
    expect(result.stdout).not.toContain('╭');
  });

  it('shows usage on --help', () => {
    const result = runCli(['--help'], makeDeps(''));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(USAGE);
  });

  it('shows usage on stderr when stdin is a TTY and no file is given', () => {
    const result = runCli([], { ...makeDeps(''), stdinIsTty: true });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(USAGE);
  });

  it('reports parse errors with non-zero exit', () => {
    const result = runCli([], makeDeps('Table'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/error/);
  });

  it('reports unknown options with non-zero exit', () => {
    const result = runCli(['--bogus'], makeDeps(''));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('error');
  });

  it('appends a trailing newline so terminals format cleanly', () => {
    const result = runCli([], makeDeps('Table users { id int }'));
    expect(result.stdout.endsWith('\n')).toBe(true);
  });

  it('parses SQL when the file ends in .sql', () => {
    const sql = 'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(50));';
    const result = runCli(['schema.sql'], makeDeps(sql));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('users');
    expect(result.stdout).toContain('id');
  });

  it('forces SQL mode with --sql for stdin input', () => {
    const sql = 'CREATE TABLE products (id INT PRIMARY KEY);';
    const result = runCli(['--sql'], makeDeps(sql));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('products');
  });

  it('rejects an invalid --dialect value', () => {
    const result = runCli(['--sql', '--dialect=bogus'], makeDeps('CREATE TABLE x (id INT);'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid --dialect');
  });

  describe('--render-markdown', () => {
    const mdWithInline = [
      '# My doc',
      '',
      '<!-- dbsketch',
      'Table users { id int }',
      '-->',
      '',
      'Some text',
    ].join('\n');

    it('inserts a rendered block after an inline comment', () => {
      const deps = makeDeps('', false);
      deps.readFile = (_p) => mdWithInline;
      const result = runCli(['--render-markdown', 'README.md'], deps);
      expect(result.exitCode).toBe(0);
      const written = deps.written.get('README.md')!;
      expect(written).toContain('```dbsketch-rendered\n');
      expect(written).toContain('users');
      expect(written).toContain('Some text');
    });

    it('updates an existing rendered block on re-run (idempotent structure)', () => {
      const deps = makeDeps('', false);
      deps.readFile = (_p) => mdWithInline;
      runCli(['--render-markdown', 'README.md'], deps);
      const first = deps.written.get('README.md')!;
      deps.readFile = (_p) => first;
      runCli(['--render-markdown', 'README.md'], deps);
      const second = deps.written.get('README.md')!;
      expect(second).toBe(first);
    });

    it('renders a src="..." file reference', () => {
      const md = '<!-- dbsketch src="schema.dbml" -->\n';
      // readFile is called with the resolved absolute path; endsWith handles
      // any path prefix the CLI adds via dirname/resolve.
      const deps = makeDeps('', false);
      deps.readFile = (p) => {
        if (p === 'README.md') return md;
        if (p.endsWith('schema.dbml')) return 'Table products { id int }';
        throw new Error(`unexpected readFile: ${p}`);
      };
      const result = runCli(['--render-markdown', 'README.md'], deps);
      expect(result.exitCode).toBe(0);
      expect(deps.written.get('README.md')).toContain('products');
    });

    it('requires a file path', () => {
      const result = runCli(['--render-markdown'], makeDeps(''));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('requires a markdown file path');
    });
  });

  it('infers relationships from PK-name matches by default', () => {
    const dbml = `
      Table dim_user { user_id int [pk] name varchar }
      Table fact_event { event_id int [pk] user_id int }
    `;
    const inferred = runCli([], makeDeps(dbml));
    const notInferred = runCli(['--no-infer-refs'], makeDeps(dbml));
    expect(inferred.exitCode).toBe(0);
    expect(notInferred.exitCode).toBe(0);
    // With inference the layout connects the two entities, producing more
    // characters and a wider diagram than two independent boxes.
    expect(inferred.stdout.length).toBeGreaterThan(notInferred.stdout.length);
  });
});
