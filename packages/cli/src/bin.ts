#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runCli } from './cli.js';

const result = runCli(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, 'utf8'),
  readStdin: () => readFileSync(0, 'utf8'),
  stdinIsTty: process.stdin.isTTY ?? false,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
