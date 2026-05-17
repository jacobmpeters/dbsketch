#!/usr/bin/env node
// Regenerates docs/hero.svg and docs/hero-dark.svg from the first
// box-drawing code block in README.md. Run after editing the hero
// diagram in the README.
//
//   node scripts/build-hero-svg.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(repoRoot, 'README.md');
const md = fs.readFileSync(readmePath, 'utf8');

const fence = '```';
const lines = md.split('\n');
let blockLines = null;
for (let i = 0; i < lines.length && !blockLines; i++) {
  if (lines[i].trim() !== fence) continue;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() !== fence) continue;
    const candidate = lines.slice(i + 1, j);
    if (candidate[0]?.startsWith('╭')) blockLines = candidate;
    i = j;
    break;
  }
}
if (!blockLines) throw new Error('Hero diagram block not found in README.md');

const diagramLines = blockLines.map((l) => l.replace(/\s+$/, ''));

const fontSize = 13;
const lineH = 13;
// Generous upper-bound advance estimate for canvas sizing; we no longer
// pin per-tspan widths via textLength (iOS Safari distorts glyph positions
// with lengthAdjust="spacingAndGlyphs"), so the font's natural advance
// drives character placement and the canvas just has to be wide enough.
const charW = 8.4;
const padX = 14;
const padY = 12;

const maxCols = Math.max(...diagramLines.map((l) => [...l].length));
const w = Math.ceil(maxCols * charW + 2 * padX);
const h = Math.ceil(diagramLines.length * lineH + 2 * padY);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fontFamily =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

const svg = ({ bg, fg }) => {
  const tspans = diagramLines
    .map((line, i) => {
      const y = padY + fontSize + i * lineH;
      return `    <tspan x="${padX}" y="${y}">${esc(line)}</tspan>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="dbsketch hero diagram: claims warehouse ERD">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <text font-family="${fontFamily}" font-size="${fontSize}" fill="${fg}" xml:space="preserve">
${tspans}
  </text>
</svg>
`;
};

const docsDir = path.join(repoRoot, 'docs');
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, 'hero.svg'), svg({ bg: '#ffffff', fg: '#1f2328' }));
fs.writeFileSync(path.join(docsDir, 'hero-dark.svg'), svg({ bg: '#0d1117', fg: '#e6edf3' }));

console.log(`wrote docs/hero.svg, docs/hero-dark.svg (${w}x${h}, ${diagramLines.length} lines, ${maxCols} cols)`);
