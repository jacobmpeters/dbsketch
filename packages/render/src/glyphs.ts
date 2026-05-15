export interface Glyphs {
  cornerTL: string;
  cornerTR: string;
  cornerBL: string;
  cornerBR: string;
  horizontal: string;
  vertical: string;
  teeLeft: string;
  teeRight: string;
  teeTop: string;
  teeBottom: string;
  cross: string;
}

export const ASCII: Glyphs = {
  cornerTL: '+',
  cornerTR: '+',
  cornerBL: '+',
  cornerBR: '+',
  horizontal: '-',
  vertical: '|',
  teeLeft: '+',
  teeRight: '+',
  teeTop: '+',
  teeBottom: '+',
  cross: '+',
};

export const UNICODE: Glyphs = {
  cornerTL: '┌',
  cornerTR: '┐',
  cornerBL: '└',
  cornerBR: '┘',
  horizontal: '─',
  vertical: '│',
  teeLeft: '├',
  teeRight: '┤',
  teeTop: '┬',
  teeBottom: '┴',
  cross: '┼',
};
