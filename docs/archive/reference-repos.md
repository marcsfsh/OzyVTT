> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Point-in-time license and usefulness evaluation of ten candidate reference repositories (2026-07).
> **Current through:** 2026-07-17  (last commit that kept it true: `02d67cc`)
> **Superseded by:** nothing; the evaluation finished and nothing was ingested wholesale.
> **Read this for:** the licence verdict on each candidate, and why several are learn-from-only.
> **Do not read this for:** current dependencies or current licence posture — this is a survey of other people's repos as they stood in July 2026.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Reference repo evaluation (2026-07)

Owner asked for the 10 candidate repos to be (re-)evaluated for ideas/patterns even where
we won't ingest code. Verdicts below. **Nothing is ingested wholesale**; several ship
non-SRD or copyleft/no-redistribution content and are learn-from-only.

## Shortlist — worth a deeper look, by upcoming feature

1. **neuralinitiative/claude-dnd-skill** — *AI-agents-playing-campaigns / open REST API.*
   Best working model of an LLM DM with **deterministic mechanics owned by code, not the
   model** (dice/combat/lookup are scripts; only narration is the LLM). Maps directly onto
   our "server owns all game state" invariant — the agent proposes, deterministic tools
   resolve. Study its tool boundary, file-based world/campaign state, and turn/autorun
   protocol. **AGPL-3.0 — learn the design, don't lift code.**
2. **cbgfx/beholden** — *encounter builder + inline rules references.* Near-exact stack
   (TS + React/Vite + Express + SQLite + WebSocket), **MIT**, with a typed "Grand Schema"
   compendium (structured effects, no prose-parsing, Zod-validated, versioned API) and a
   DM/player split ≈ our GM/viewer split. Closest architectural analog. **Do NOT ingest its
   `WotC_2024_only.json` data — reuse the schema, keep our own SRD.**
3. **foundryvtt/dnd5e** — *inline SRD rules-reference data model.* Mature, safe, **CC-BY
   SRD-only** content in `packs/_source/` with 2014 + 2024 variants. Adapt field shapes;
   SRD JSON reusable with attribution.
4. **inigo-munoz/little-master** — *MCP/agent server + encounter builder.* Close sibling
   (TS monorepo GM companion) with an MCP server for AI agents and a CR-difficulty
   encounter generator. **MIT + CC-BY.** Early / Spanish docs — read the code.

## Full verdicts

| Repo | License | Verdict |
| --- | --- | --- |
| inigo-munoz/little-master | MIT + CC-BY SRD | **Learn-from** — MCP-server-for-agents + CR encounter generator; nearest peer. |
| FernDragonborn/charnik | AGPL + CC-BY SRD CSVs | Skip code (AGPL/Svelte); learn-from only for its easy-to-parse SRD CSVs. |
| nick-aschenbach/dnd-data | MIT code, **unlicensed scraped data** | **Skip** — 11k monsters/5.8k spells from 193 non-SRD books; do not ingest. |
| cbgfx/beholden | MIT (data is non-SRD) | **Learn-from (strong)** — our stack; typed compendium schema. Don't ingest its data. |
| Dear-Mercy/DnD-5e-2024-Spells | CC0 (misapplied) | Skip — non-SRD 2024 PHB text, Obsidian-format. |
| Yoonmoonsik/dnd2024 | none | Skip — no license, non-SRD, D&D Beyond mod. |
| foundryvtt/dnd5e | MIT + CC-BY SRD | **Learn-from + SRD data reference** — gold-standard 5e data model. |
| neuralinitiative/claude-dnd-skill | AGPL (SRD data clean) | **Learn-from (top for AI-agent roadmap)** — deterministic-mechanics/LLM-narration split. |
| MrVauxs/dnd5e-animations | GPL-3.0 + Foundry | Skip — off-scope, copyleft, Foundry-coupled. |
| Larkinabout/fvtt-custom-dnd5e | **no-redistribution** | Skip for reuse; learn-from at arm's length for encounter-builder UX. |

**Do-not-ingest flags:** dnd-data & DnD-5e-2024-Spells (scraped non-SRD, no valid data
license); beholden & fvtt-custom-dnd5e (non-SRD / no-redistribute assets). AGPL/GPL
(charnik, claude-dnd-skill, dnd5e-animations) are safe to learn from, risky to copy.
