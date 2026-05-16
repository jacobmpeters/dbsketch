import type { IR, Ref } from './types.js';

// Infer one-to-many refs from PK-name matching. Used as a fallback for
// warehouse schemas that join by naming convention rather than declared
// FOREIGN KEYs (dim_respondent.respondent_id PK + fact_response.respondent_id
// non-PK → infer fact_response.respondent_id → dim_respondent.respondent_id).
//
// Rule: for each non-PK column E.c, find entities P (P ≠ E) where P has a
// column named c marked PK. If exactly one such P exists, infer E.c → P.c
// as one-to-many. Skip if zero or multiple matches (ambiguous), or if c
// belongs to E's own PK.
//
// Why exact-name match only: generic column names like `created_at` or
// `name` are never PKs anywhere in a sane schema, so they don't trigger
// false positives. Ambiguity (two entities sharing a PK column name) is
// resolved by skipping rather than guessing.
//
// Does NOT catch OLTP-style refs where PK is just `id` and FK is `user_id`
// pointing to a `users` table — that requires name-munging heuristics
// (pluralization, prefix-stripping) which are much more error-prone.
// Such schemas should declare their FKs explicitly.
export function inferRefs(ir: IR): Ref[] {
  const pkOwners = new Map<string, string[]>();
  for (const e of ir.entities) {
    for (const c of e.columns) {
      if (!c.pk) continue;
      let owners = pkOwners.get(c.name);
      if (!owners) {
        owners = [];
        pkOwners.set(c.name, owners);
      }
      owners.push(e.name);
    }
  }

  const inferred: Ref[] = [];
  for (const e of ir.entities) {
    for (const c of e.columns) {
      if (c.pk) continue;
      const owners = pkOwners.get(c.name);
      if (!owners) continue;
      const others = owners.filter((o) => o !== e.name);
      if (others.length !== 1) continue;
      inferred.push({
        parent: { entity: others[0]!, column: c.name },
        child: { entity: e.name, column: c.name },
        cardinality: 'one-to-many',
      });
    }
  }
  return inferred;
}
