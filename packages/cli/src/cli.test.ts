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

  it('uses Unicode glyphs by default', () => {
    const result = runCli(['users.dbml'], makeDeps('Table users { id int }'));
    expect(result.stdout).toContain('┌');
  });

  it('uses ASCII glyphs when --ascii is passed', () => {
    const result = runCli(['--ascii', 'users.dbml'], makeDeps('Table users { id int }'));
    expect(result.stdout).toContain('+');
    expect(result.stdout).toContain('|');
    expect(result.stdout).not.toContain('┌');
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
});
