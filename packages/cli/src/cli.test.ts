import { describe, expect, it } from 'vitest';
import { USAGE, runCli } from './cli.js';

function makeDeps(input: string, isTty = false) {
  return {
    readFile: (_path: string) => input,
    readStdin: () => input,
    stdinIsTty: isTty,
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
