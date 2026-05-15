import type { IR } from '@ascii-erd/parser';
import type { Placement } from './types.js';

// Column-strip = rank. Row-strip = position within rank, sorted by entity
// name for determinism. No crossing-minimization yet — that's a future slice.
export function place(ir: IR, ranks: Map<string, number>): Placement[] {
  const entityNames = ir.entities.map((e) => e.name).sort();

  const byRank = new Map<number, string[]>();
  for (const name of entityNames) {
    const rank = ranks.get(name) ?? 0;
    let bucket = byRank.get(rank);
    if (!bucket) {
      bucket = [];
      byRank.set(rank, bucket);
    }
    bucket.push(name);
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  const placements: Placement[] = [];
  for (const rank of sortedRanks) {
    const names = byRank.get(rank)!;
    names.forEach((name, i) => {
      placements.push({ entity: name, colStrip: rank, rowStrip: i });
    });
  }

  return placements;
}
