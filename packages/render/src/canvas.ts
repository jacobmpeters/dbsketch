// Mutable 2D character grid with bounds-clamping writes. Built once per render
// and stringified at the end. Out-of-bounds writes are silently dropped — the
// caller has already computed positions, so this is just defense.
export class Canvas {
  private readonly cells: string[];

  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.cells = new Array<string>(width * height).fill(' ');
  }

  set(x: number, y: number, ch: string): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.cells[y * this.width + x] = ch;
  }

  get(x: number, y: number): string | undefined {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return undefined;
    return this.cells[y * this.width + x];
  }

  setRow(x: number, y: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.set(x + i, y, str[i]!);
    }
  }

  toString(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = '';
      for (let x = 0; x < this.width; x++) {
        row += this.cells[y * this.width + x];
      }
      rows.push(row.trimEnd());
    }
    return rows.join('\n');
  }
}
