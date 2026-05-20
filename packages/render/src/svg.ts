const FONT_FAMILY =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

const FONT_SIZE = 13;
const LINE_H = 13;
const CHAR_W = 8.4;
const PAD_X = 14;
const PAD_Y = 12;

const THEMES = {
  light: { bg: '#ffffff', fg: '#1f2328' },
  dark:  { bg: '#0d1117', fg: '#e6edf3' },
};

export interface SvgOptions {
  theme?: 'light' | 'dark';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderSvg(text: string, options: SvgOptions = {}): string {
  const { bg, fg } = THEMES[options.theme ?? 'light'];
  const lines = text.split('\n');
  const maxCols = Math.max(...lines.map((l) => [...l].length), 0);
  const w = Math.ceil(maxCols * CHAR_W + 2 * PAD_X);
  const h = Math.ceil(lines.length * LINE_H + 2 * PAD_Y);

  const tspans = lines
    .map((line, i) => {
      const y = PAD_Y + FONT_SIZE + i * LINE_H;
      return `    <tspan x="${PAD_X}" y="${y}">${esc(line)}</tspan>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <text font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${fg}" xml:space="preserve">
${tspans}
  </text>
</svg>`;
}
