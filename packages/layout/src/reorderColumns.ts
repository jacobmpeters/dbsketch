import type { Column, IR } from '@dbsketch/parser';

// Within each entity, reorder columns into three stable groups:
//   1. PK columns (declared order; composite PKs stay contiguous at the top)
//   2. FK source columns (declared order)
//   3. Everything else (declared order)
//
// Sources of cluttered routing are usually FK columns scattered between
// non-FK columns: each FK forces a V whose endpoint Y is far from its
// neighbors' attach rows. Clustering FK columns near the PK shortens those
// V's and aligns adjacent edges' attach rows, which collapses bend-adjacent
// and port-adjacent clusters.
//
// The rule is unconditional (no "preserve if no improvement" check) so it's
// trivially predictable: every entity with no `@layout { preserve_order }`
// hint gets the same transformation, idempotent, regardless of the rest of
// the schema. Schemas that already follow the convention see no change.
//
// Note on composite PKs: the v1 parser only marks columns as `pk` when the
// attribute appears inline (`id int [pk]`). Composite PKs declared via
// `indexes { (col1, col2) [pk] }` aren't detected and fall into the "other"
// group — that's an existing parser limitation, not a reorder bug.
export function reorderColumns(ir: IR): IR {
  const preserve = ir.hints.preserveOrder;
  if (preserve.global) return ir;
  const preserveSet = new Set(preserve.entities);

  // FK source columns: any column that appears as a child endpoint in a ref.
  // Indexed by (entity, column) so the lookup is O(1) per column.
  const fkSourceColumns = new Set<string>();
  for (const ref of ir.refs) {
    fkSourceColumns.add(`${ref.child.entity}|${ref.child.column}`);
  }

  return {
    ...ir,
    entities: ir.entities.map((e) => {
      if (preserveSet.has(e.name)) return e;
      const pks: Column[] = [];
      const fks: Column[] = [];
      const others: Column[] = [];
      for (const c of e.columns) {
        if (c.pk) pks.push(c);
        else if (fkSourceColumns.has(`${e.name}|${c.name}`)) fks.push(c);
        else others.push(c);
      }
      // No-op early-out: if reordering would produce the same sequence, keep
      // the original array reference so snapshot tests don't churn for
      // already-conventional schemas.
      const reordered = [...pks, ...fks, ...others];
      const unchanged = reordered.every((c, i) => c === e.columns[i]);
      return unchanged ? e : { ...e, columns: reordered };
    }),
  };
}
