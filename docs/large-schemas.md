# Working with large schemas

dbsketch is built for the diagrams you'd put in a README, a docstring, or an LLM prompt — typically up to ~20 tables. For larger schemas (OMOP CDM, real-world OLTP systems, mature data warehouses), a single column-detailed diagram becomes too wide to read.

This guide walks through three escape hatches, in order of how much information you give up:

1. [`--no-types`](#1---no-types--drop-type-annotations) — keep column names, drop type annotations
2. [`--no-columns`](#2---no-columns--name-only-overview) — keep entity names and relationships, drop columns entirely
3. [`@layout { cluster ... }`](#3-cluster-hint--split-into-focused-sub-diagrams) — split the schema into separate logical sub-diagrams

Each is independent; they can be combined.

## The motivating example

The OMOP Common Data Model has 39 tables and 176 foreign keys. Rendering the whole thing with full columns produces a 367-line × 168-character diagram — readable only as a wall-spanning printout. We'll use OMOP CDM throughout this guide to demonstrate each technique.

## 1. `--no-types` — drop type annotations

Drops data types from columns. Keeps column names, PK markers, and FK relationships. Entities get narrower because the longest cell on each row is usually `column_name TYPE`; without types, just `column_name`.

```sh
dbsketch schema.sql --no-types
```

When to reach for it:
- The diagram is right-at-the-edge of fitting and you don't need types for the audience
- You're embedding in a README where vertical space is fine but horizontal space matters
- The types aren't load-bearing for the conversation (e.g., a review of structural changes)

Trade-off: readers lose type info. Often acceptable for "what tables are related to what" discussions; usually not acceptable for migration reviews or schema design conversations.

OMOP CDM in this mode is about 30% narrower than the default. Still too big to read end-to-end, but the horizontal axis becomes manageable.

## 2. `--no-columns` — name-only overview

Collapses every entity to a 3-row name-only box. All FKs from/to an entity converge on a single port per side; routing still draws every edge correctly, but the column-level "which FK goes to which port" detail is gone.

```sh
dbsketch schema.sql --no-columns
```

When to reach for it:
- You want a whole-schema **overview** — "what tables exist, how are they related" at a glance
- A printable one-page view of the relationship graph
- You'll show the detailed view separately (per-subdomain) once readers understand the topology

For OMOP CDM, `--no-columns` produces an **84-line × 110-character** diagram instead of 367 × 168. About a 5x compression on area, mostly by collapsing entity heights from "4 + column count" rows down to 3.

Trade-off: you can't tell at a glance which column of source-table A references which column of target-table B. For reference, the original CDM diagram has every entity at full height; the `--no-columns` view shows only names and edges.

Combines well with `--no-types`, though `--no-types` has no effect when `--no-columns` is set (no columns to type-strip).

## 3. `cluster` hint — split into focused sub-diagrams

Adds a hint that partitions the schema into named clusters. Each cluster renders as its **own diagram** with a section header. Foreign keys that cross cluster boundaries become annotation rows on the source column rather than edges that would have to span between diagrams.

This is the workflow for documenting a large schema as a *set* of focused diagrams instead of one overwhelming one.

### Syntax

```dbml
@layout {
  cluster "Display Name" {
    entity_a, entity_b, entity_c
  }
  cluster "Another Group" {
    entity_d, entity_e
  }
}
```

The label can be a quoted string (preserves spaces for the section header) or a bare identifier. Members are comma-separated entity names.

### Output shape

Given the three clusters above, output looks like:

```
─── Display Name ───

[diagram of entity_a, entity_b, entity_c, with their internal FKs as real edges]

─── Another Group ───

[diagram of entity_d, entity_e]
```

Entities not assigned to any cluster automatically collect into a trailing `Other` section, so nothing falls off.

### Cross-cluster references

When an FK in cluster A points to an entity in cluster B, dbsketch can't draw the edge between separate diagrams. Instead, it inserts an annotation row immediately below the FK column, indented and arrow-prefixed:

```
│ condition_concept_id                    │
│   ↳ concept.concept_id (Vocabularies)   │
│ condition_type_concept_id               │
│   ↳ concept.concept_id (Vocabularies)   │
```

The reader sees that `condition_concept_id` references `concept.concept_id`, and that `concept` lives in the `Vocabularies` section.

### Worked example: OMOP CDM

The OMOP CDM splits cleanly along three lines:

- **Clinical Events** — patient encounters and observations (`person`, `visit_occurrence`, `condition_occurrence`, `drug_exposure`, `procedure_occurrence`, `measurement`, `observation`)
- **Vocabularies** — terminology and standard concepts (`concept`, `vocabulary`, `domain`, `concept_class`, `concept_relationship`)
- **Organization** — providers, locations, care sites (`provider`, `care_site`, `location`)

Add the cluster hint to the DBML:

```dbml
@layout {
  cluster "Clinical Events" {
    person, visit_occurrence, condition_occurrence, drug_exposure,
    procedure_occurrence, measurement, observation
  }
  cluster "Vocabularies" {
    concept, vocabulary, domain, concept_class, concept_relationship
  }
  cluster "Organization" {
    provider, care_site, location
  }
}
```

Now each cluster renders independently. The clinical-events cluster shows the patient/visit hierarchy at a comfortable size; the vocabularies cluster shows `concept` as the local hub with its lookup tables; the organization cluster is three tables with one chain. Cross-cluster FKs (e.g., `condition_occurrence.condition_concept_id → concept`) appear as annotation rows in the source cluster.

### Tradeoffs and edge cases

- **Width:** annotated cluster entities can be wider than non-clustered equivalents if the annotation text is longer than the longest column name. The `↳ target.col (Cluster)` line dominates width.
- **Ghosts:** an entity can be listed in multiple clusters — useful for hubs (e.g., putting `concept` in both `Vocabularies` and `Clinical Events`). Each cluster gets its own copy with cluster-internal refs as real edges.
- **Unclustered entities:** anything you don't list falls into a trailing `Other` cluster. This is intentional — better to surface mis-grouping than to silently drop tables.
- **Cluster headers:** the section divider is `─── Display Name ───`. Markdown renderers, browser SVG viewers, and terminals all handle it as plain text.

## Combining approaches

The three are independent:

| Approach | Vertical compression | Horizontal compression | Detail preserved |
|---|---|---|---|
| `--no-types` | none | ~25-35% | column names + FK ports |
| `--no-columns` | ~70% | ~30% | entity names + relationships only |
| `cluster` | per-diagram only | per-diagram only | full, but split |

Typical workflows:

- **Overview + details:** one `--no-columns` rendering of the whole schema for the topology, plus a clustered rendering for per-section detail
- **Just the overview:** `--no-columns` alone for a one-page graph
- **Just the splits:** `cluster` alone preserves every column and type, but each diagram is bounded in size

If you want both the topology view and the detailed splits in one document, run dbsketch twice and concatenate the outputs.
