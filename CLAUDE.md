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

1. **Parse** — DBML + `@layout` block → IR (entities, columns, refs, hints). `packages/parser`.
2. **Cluster** — modularity/Louvain over the FK graph; assigns each entity to a cluster. Hint: `cluster X { ... }`.
3. **Rank** — Sugiyama-style layering by FK direction; junction tables (two FKs) sit between parents by construction. Hint: `rank N { ... }`.
4. **Place** — assign each entity to a `(col-strip, row-strip)` cell. Honors `pin` hints (`@right-of`, `@above`, etc.).
5. **Reorder columns** — within each entity, reorder columns so FK columns sit near the edge facing the related entity. Minimizes line bends. Honors `@preserve-order` opt-out.
6. **Assign ports** — each FK gets a port on the source/target entity at the row of the relevant column.
7. **Route** — edges decompose into horizontal/vertical segments living in channel strips. Interval scheduling assigns each segment a track.
8. **Size channels** — channel widths set to (max occupied tracks per channel); recompute final coordinates.
9. **Render** — strip grid + glyph table (ASCII or Unicode) → string. `packages/render`.

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
  cluster auth { users, sessions }
  rank 0  { users }
  pin posts @right-of users
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

**Browser-compatibility constraint:** `parser`, `layout`, `render`, `core` must not import Node-only APIs (no `fs`, `path`, `process` outside of `@types/node`). `cli` is the sole Node consumer. This keeps `core` shippable to browsers, playgrounds, and any web rendering pipeline.

## Tooling

- **Package manager:** pnpm with workspaces. No Turborepo/Nx for v1.
- **Module system:** ESM only.
- **TypeScript:** strict mode; project references between packages; `tsx` for dev; `tsc --build` for ship.
- **Testing:** Vitest. Snapshot tests for "given DBML X, expect ASCII Y" are the primary regression mechanism — determinism makes these reliable.
- **Lint/format:** Biome (single binary, replaces ESLint + Prettier).
- **Node target:** 20 LTS minimum.

## v1 scope

- DBML in (file or stdin), ASCII out (stdout).
- Two render modes: `--ascii` (7-bit `+`/`-`/`|`) and `--unicode` (default, box-drawing).
- Layout hints via `@layout` blocks.
- Library API exported from `core`.
- Snapshot test suite covering common ERD shapes.

## Non-goals (v1)

- Watch mode, server, web playground (deferred to v2).
- DDL/SQL parsing — planned for later; `parser` should be designed so new front-ends slot in cleanly.
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
- **Asymmetric flush-to-parent-side track packing.** A channel's routing tracks pack against the parent (source) border; any visual-separation padding sits on the child side. Saves space at the cost of visual symmetry. A future symmetric mode (padding split evenly) is on the table but deferred.
- **Refs the router can't handle surface in `Layout.skippedRefs`.** Don't silently drop edges — visibility into what isn't rendered matters more than a clean output that's secretly incomplete. Currently skipped: many-to-many, multi-hop with no row-channel below for the detour (last row strip).
- **Direction-set merging for line glyphs.** Each line glyph (corner/tee/cross/H/V) decomposes into a set of N/S/E/W directions. Merging at a cell: shared directions = JOIN (union, look up the new glyph), no shared = CROSSING (vertical wins, horizontal gets a visible gap). This produces accurate corner→tee upgrades and the conventional ASCII-art "H passes under V" gap visual without having to write a per-glyph merge table.

## Future-work backlog

Captured in priority order from conversation. Not strict commitments — revisit before picking up.

1. **Detour-above fallback for multi-hop edges.** Currently multi-hop only detours through the row-channel just below the higher of parent/child. When that row-channel doesn't exist (parent and child both in the last row strip), the edge skips. Adding "try above" doubles coverage with modest implementation cost.
2. **Tighter track packing (`<=` instead of `<`).** Edges that touch at a y-boundary could share a track instead of getting separate tracks. Saves 1-2 cells in dense channels. Risk: visual ambiguity at the merge cell.
3. **`@layout` hint parsing.** The DSL is sketched in this doc but the parser doesn't read it yet. Wiring it gives users escape valves for the inevitable cases where automatic layout picks something wrong.
4. **Edge bundling for shared parent ports.** When N FKs leave the same parent port to N children, render as a single trunk that branches. Visually transformative; routing rewrite.
5. **Crossing minimization at track assignment.** Beyond non-overlap packing, choose tracks to minimize crossings with other edges. NP-hard exact; barycenter-style heuristic. Real win for dense channels but significant slice.
6. **Star-schema / wide-aspect-ratio layouts.** When a layer has way fewer entities than its neighbors (e.g., one fact table opposite five dimensions), the layered model wastes vertical space. Allowing entities to span multiple row strips would help; breaks the "one entity per (col, row) cell" invariant.
7. **Color (opt-in flag).** Could differentiate edges with ANSI codes. Defer indefinitely — breaks markdown-renderability story unless gated behind explicit flag.
8. **DDL/SQL parsing.** Planned per v1 scope; parser front-end is designed to swap in.
