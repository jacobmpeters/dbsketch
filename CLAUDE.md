# ascii-erd

Code-first ERD diagramming tool that compiles DBML schemas into ASCII or Unicode box-drawing diagrams. The differentiator is a **grid-native, deterministic layout algorithm** designed for the character grid from cell zero — not continuous-space layout projected onto characters.

## Thesis

Existing ERD tools (Mermaid, dbdiagram, GraphViz) lay out in continuous 2D space, then project to a grid or SVG. The projection step is where alignment breaks: variable-width entities don't snap cleanly, edges meet boxes off-center, lines come out crooked. ascii-erd designs the algorithm for the integer character grid from the start, so the output is the algorithm's native form — no projection, no approximation gap.

Three properties fall out of this and are non-negotiable:

1. **Determinism.** Same DBML in, byte-identical ASCII out. Diffs in version control must be meaningful, snapshot tests must be reliable, and downstream consumers (CI, LLMs, markdown pipelines) must depend on output stability.
2. **Predictability over optimality.** Layouts are fast and consistent rather than minimum-crossing-optimal. When the algorithm picks something ugly, the user adds one layout hint to fix that one thing — they never have to drive the whole algorithm.
3. **Web-native, browser-compatible core.** The compiler runs in the browser as easily as in Node, so the same package powers a CLI, a web playground, a VS Code extension, and a markdown-it plugin.

## The strip grid (central abstraction)

The canvas is an alternating sequence of **node strips** and **channel strips**, in both axes:

```
col-strip 0 (node) │ ch-strip 0 │ col-strip 1 (node) │ ch-strip 1 │ ...
───────────────────┼────────────┼────────────────────┼────────────┼────
row-strip 0 (node) │            │                    │            │
                   │            │                    │            │
ch-strip 0         │            │                    │            │
                   │            │                    │            │
row-strip 1 (node) │            │                    │            │
```

- **Node strips** hold entities; sized to the widest entity in a column-strip (or tallest in a row-strip).
- **Channel strips** hold routing tracks; width grows by exactly one character per occupied track. A channel with 3 edges crossing it is 3 cells wide. Gap expansion is automatic and minimal — there is no tuning knob.
- **Routing inside a channel = interval scheduling.** Two horizontal segments share a track if their column ranges don't overlap. Greedy O(n log n). No A*, no congestion search.
- **Crossings** only occur where a row-channel meets a column-channel — a single cell rendered as `┼` (or `+` in ASCII mode). Bounded, predictable, locatable.

Most algorithm work lives in `packages/layout` and operates directly on this grid model. Coordinates are integer cells everywhere — no floats, no continuous space.

## Pipeline

Sequential stages, each with one responsibility. Each layout hint maps to exactly one stage — that locality is what makes hints predictable.

0. **(SQL input only)** — SQL DDL → DBML via `@dbml/core`'s importer. `parseSql(sql, dialect)` in `packages/parser` does this, then hands off to stage 1. Supported dialects: postgres (default; also handles SQLite cleanly as a subset), mysql, mssql, snowflake. We don't carry a second canonical IR — everything funnels through DBML so the rest of the pipeline doesn't fork.
1. **Parse** — DBML + `@layout` block → IR (entities, columns, refs, hints). `packages/parser`. The parser is permissive: it strictly handles `Table { ... }` and external `Ref` declarations but tolerates anything else (Project, TableGroup, Enum, Note blocks, multi-attribute brackets with not-null/default/note, quoted identifiers, composite-column refs, schema-qualified names) by skipping over it with balanced-brace scanning.
2. **Detect hubs** — find high-degree entities and emit synthetic `@center` hints. Auto picks the top-1 entity (degree ≥ 3); users can override or add more via explicit `@center`. `packages/layout/detectHubs.ts`.
3. **Cluster** — modularity/Louvain over the FK graph; assigns each entity to a cluster. Hint: `cluster X { ... }`. *(Not yet wired up.)*
4. **Rank** — assigns each entity to a col-strip. Two modes:
   - *Hub-distance* (when centers exist): BFS from the hub on the undirected FK graph; col = hubCol ± distance, with direct neighbors split between left and right. Multi-hub uses a spine with bridge cols for shared neighbors.
   - *Balanced* (no centers): Sugiyama-style layering by FK direction with a width cap to control aspect ratio.
   Hints: `rank N { ... }` *(not yet wired)*, `@center entity { left: ... right: ... }`.
5. **Place** — assign each entity to a `(col-strip, row-strip)` cell. Honors `pin` hints (`pin X at col N, row M`).
6. **Reorder columns** — within each entity, reorder columns so FK columns sit near the edge facing the related entity. Minimizes line bends. Honors `@preserve-order` opt-out. *(Not yet wired.)*
7. **Assign ports** — each FK gets a port on the source/target entity at the row of the relevant column.
8. **Route** — edges decompose into horizontal/vertical segments living in channel strips. Interval scheduling assigns each segment a track. Multi-hop edges route through a top margin above all entities.
9. **Size channels** — channel widths set to (max occupied tracks per channel); recompute final coordinates. Per-col stacking packs entities tightly within each col-strip.
10. **Render** — strip grid + glyph table (ASCII or Unicode) → string. `packages/render`.

## Input formats

Two front-ends, single IR:

- **DBML** (native). Standard DBML plus our `@layout` extension block. The parser handles the real-world DBML surface (quoted identifiers, multi-attribute brackets, external `Ref:`, Project/TableGroup/Enum/Note/Indexes/Checks blocks, composite-column refs, schema-qualified names) — features get either extracted (Table/Column/PK/FK) or skipped, never errored on.
- **SQL DDL** (via `@dbml/core`). The parser package depends on `@dbml/core` for SQL → DBML conversion. Resulting DBML feeds into the same DBML parser. Supported dialects match `@dbml/core`'s importer: postgres (also handles SQLite), mysql, mssql, snowflake. CLI auto-detects `.sql` files; library API: `parseSql(sql, dialect)` and `compileSql(sql, dialect, opts)`.

## DSL surface

Standard DBML, plus an optional `@layout` block that vanilla DBML parsers ignore (comment-friendly):

```
Table users {
  id int [pk]
  email varchar
}

Table posts {
  id int [pk]
  user_id int [ref: > users.id]
  title varchar
}

@layout {
  pin users at col 0
  pin posts at col 1, row 2
  center sales_fact { left: date_dim, customer_dim right: product_dim, store_dim }
}
```

LLMs can generate or modify `@layout` without understanding the algorithm — each hint has local effect on one pipeline stage.

## Workspace layout

pnpm workspaces. Five packages today; one deferred app:

```
packages/
  parser/    # DBML + @layout extension → IR
  layout/    # ranking, clustering, placement, routing — the strip-grid algorithm
  render/    # IR + grid → string; ASCII and Unicode glyph tables
  core/      # pipeline orchestration; library entry point; browser-safe
  cli/       # Node CLI; the only Node-specific package
apps/
  playground/  # deferred — placeholder for future web demo
```

**Browser-compatibility constraint:** `parser`, `layout`, `render`, `core` must not import Node-only APIs (no `fs`, `path`, `process` outside of `@types/node`). `cli` is the sole Node consumer. This keeps `core` shippable to browsers, playgrounds, and any web rendering pipeline. `@dbml/core` (a runtime dep of `parser`, used by `parseSql`) is browser-safe — it powers dbdiagram.io.

## Tooling

- **Package manager:** pnpm with workspaces. No Turborepo/Nx for v1.
- **Module system:** ESM only.
- **TypeScript:** strict mode; project references between packages; `tsx` for dev; `tsc --build` for ship.
- **Testing:** Vitest. Snapshot tests for "given DBML X, expect ASCII Y" are the primary regression mechanism — determinism makes these reliable.
- **Lint/format:** Biome (single binary, replaces ESLint + Prettier).
- **Node target:** 20 LTS minimum.

## v1 scope

- DBML or SQL DDL in (file or stdin), ASCII out (stdout). `.sql` auto-detected by extension; `--sql` forces SQL mode for stdin.
- Two render modes: `--ascii` (7-bit `+`/`-`/`|`) and `--unicode` (default, box-drawing).
- Layout hints via `@layout` blocks (`pin`, `center` with optional `{ left: ... right: ... }` bias).
- Library API exported from `core` (`compile`, `compileSql`).
- Snapshot test suite covering common ERD shapes plus a regression set of real-world DBML files in `parser/fixtures-realworld`.

## Non-goals (v1)

- Watch mode, server, web playground (deferred to v2).
- Custom themes, color, SVG output.
- Interactive editing.
- "Optimal" layouts via simulated annealing or other expensive optimization. Strip-grid + interval scheduling is fast and predictable; that's the deliberate tradeoff.

## Hard constraints

Surfacing here so they aren't relitigated in code review:

- **Determinism.** Same input → byte-identical output. Do not iterate `Map`/`Set` in insertion order without sorting; do not seed RNG from the clock; do not rely on async race ordering.
- **Browser-safe core.** No Node imports in `parser`/`layout`/`render`/`core`.
- **One hint, one stage.** Layout hints map to a single pipeline stage. If a feature needs to touch multiple stages, redesign it.
- **Integer cells only.** No continuous-space coordinates in `layout`. The strip grid is the model end-to-end.

## Design decisions

Standing decisions made through discussion. Don't relitigate without revisiting the original tradeoff.

- **Channels have a visual-separation floor (2 cols, 1 row) below which they don't shrink even with zero routing.** Without this, adjacent boxes touch and the diagram becomes unreadable. Channels grow with routing demand on top of the floor.
- **Asymmetric flush-to-parent-side track packing for single-direction channels.** A channel's routing tracks pack against the parent (source) border; visual-separation padding sits on the child side. With mixed forward + backward edges in the same channel (only possible with `@center` placement), tracks pack from the channel's LEFT edge regardless of direction — anchoring each edge to its own parent would map distinct track indices to the same X cell.
- **Per-col entity packing.** Each col-strip packs its entities tightly from the top with a single-row gap between them, rather than aligning every entity to a shared row-strip grid. Eliminates the dead space that appears beside tall fact tables.
- **Multi-hop edges route through a single top margin** above all entities (sentinel detour-row-channel = -1). Per-col packing breaks the "row R is at the same y in every col" invariant, so inter-row channels no longer have a well-defined position; the top margin is always available and trivially valid. Multi-hops never skip for lack of detour space.
- **Hub auto-detection caps at 1 hub.** Single-hub centering is a clear win across schema shapes; multi-hub layouts are wider and only help when the schema has genuinely distinct subtrees, so they're opt-in via explicit `@center` hints rather than auto-emitted. The multi-hub ranker (spine + bridge cols) is wired up but only activates when the user provides 2+ centers.
- **`@center` placement intentionally breaks parent-col < child-col.** The whole point of fanning edges to both sides of a hub is that some FKs flow right-to-left. The router handles `colDiff < 0` by mirroring port-side selection, segment endpoints, and bend computation. Validation that would reject backward edges only runs when there are no centers.
- **`@center` and `@col` on the same entity are rejected up front.** Both constrain the col axis; silently letting one win produces wrong layouts. `HintConflictError` surfaces the conflict at layout entry.
- **Refs the router can't handle surface in `Layout.skippedRefs`.** Don't silently drop edges — visibility into what isn't rendered matters more than a clean output that's secretly incomplete. Currently skipped: many-to-many.
- **Edge bundling at the parent port.** Edges that share `(channel, direction, parent_entity, parent_column)` allocate a single V track instead of one per edge. The bundle's `assign()` writes the same track to every member, so all members' V segments collapse to one trunk at one `bendX`. Branches emerge naturally from glyph merging — each child's H2 at a different row turns the trunk into a tee. Applies to single-hop V and multi-hop V1; multi-hop V2 doesn't bundle because each FK has its own child column.
- **Direction-set merging for line glyphs.** Each line glyph (corner/tee/cross/H/V) decomposes into a set of N/S/E/W directions. Merging at a cell: shared directions = JOIN (union, look up the new glyph), no shared = CROSSING (vertical wins, horizontal gets a visible gap). This produces accurate corner→tee upgrades and the conventional ASCII-art "H passes under V" gap visual without having to write a per-glyph merge table. Combined with bundling, the trunk's intermediate branch cells get `├`/`┤` tees and end-of-trunk cells get the appropriate corner without any bundle-specific render code.
- **H1/H2 segments include their port cells.** Single-cell horizontal segments can't convey travel direction from `x2 - x1` alone, which corrupts corner-glyph selection at bends for backward edges. Extending H1/H2 to include the port cell makes the sign unambiguous; `drawPortMarker` repaints the port cell last so the segment glyph is invisible.

## Future-work backlog

Captured in priority order from conversation. Not strict commitments — revisit before picking up.

1. **Max-width control (col folding).** Opt-in `--max-cols N` flag for narrow rendering contexts (mobile docs, terminal-first usage). Fold outermost cols inward, stacking their entities into inner-neighbor col-strips via per-col packing. Cost: more multi-hop edges (handled by existing top-margin routing + V1 bundling), folded col-strips get taller, layout looks compressed at low caps. Default behavior unchanged — the diagram should reflect the schema. Shelved until a concrete schema demonstrates the need.
2. **Bottom-margin fallback for multi-hop.** All multi-hops currently share one top-margin band. For schemas with many multi-hops (`pure_star` before center placement, `snowflake` with multi-hub), splitting traffic between top and bottom margins would halve the band height.
3. **Tighter track packing (`<=` instead of `<`).** Edges that touch at a y-boundary could share a track instead of getting separate tracks. Saves 1-2 cells in dense channels. Risk: visual ambiguity at the merge cell.
4. **Smarter hub-selection metric.** Auto picks the top-1 hub by total degree; some shapes might prefer "centrality" (entity whose neighborhood is densest) or "balanced in/out" (favors fact tables specifically). Phase 5 shipped a closeness tiebreak that was reverted with the cap=1 change; revisit if auto needs to pick more than one.
5. **Cluster + rank hints.** `cluster X { ... }` and `rank N { ... }` are sketched in the DSL but the parser doesn't read them yet. Lower priority now that `pin` and `@center` cover the main escape valves.
6. **Crossing minimization at track assignment.** Beyond non-overlap packing, choose tracks to minimize crossings with other edges. NP-hard exact; barycenter-style heuristic. Real win for dense channels but significant slice.
7. **Color (opt-in flag).** Could differentiate edges with ANSI codes. Defer indefinitely — breaks markdown-renderability story unless gated behind explicit flag.
