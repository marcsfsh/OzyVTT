# ADR-0021 closing record: the guided character builder shipped

## Status

Closed — 2026-08-01. Records what shipped. **ADR-0021 is unchanged** and is still correct
about the play sheet; this record closes its decision 1 only.

**Closes** ADR-0021 decision 1 — "Ship an interactive *play* sheet, not a guided builder —
yet … The full **builder** … is the **next roadmap update**"
(`docs/adr/0021-player-character-sheet.md`).

## What happened

The next roadmap update arrived. The guided builder shipped on 2026-07-28 in commit `3144e58`
("Character content, homebrew authoring, and magic items", #50):

- `apps/client/src/builder/` — the full-page wizard (`CharacterBuilder.tsx`,
  `build-payload.ts`, `draft.ts`, `character-builder.css`), mounted from the GM roster in
  `apps/client/src/main.tsx`.
- `apps/server/src/character-build.ts` — server-side assembly for `character.create`: ability
  method validation, per-level HP, feature-rider interpretation, and re-validation against
  `ActorDefinitionSchema`.
- `GameState.builderPolicy` (`packages/domain/src/index.ts`) — a GM-set, player-read table
  policy for which ability-score methods are allowed, carried verbatim into the player
  projection.
- `packages/content-srd-5.2.1` — the classes, subclasses, species, backgrounds and feats the
  wizard offers.

ADR-0021's decision 2 (the "no-rewrite" data-model contract) held: the builder writes the same
choice-input schema the play sheet already read, which is why no migration was needed.

## What this changes elsewhere

The scope boundary **"not a character builder" is retired.** It was asserted in `CLAUDE.md`,
`README.md`, `BUILD_PLAN.md`'s non-goals and `docs/ai-context/product-vision.md`; all of those
are corrected in the same change as this record. `packages/content-srd-5.2.1/README.md` already
carried the only correct record of the reversal, and its wording is the model: state the old
boundary, name what changed it, and date it by naming the decision rather than deleting the
history.

## What is still open

Server-held drafts (builder "Phase 3"). The wizard parks drafts in `localStorage` behind
`loadDraft`/`saveDraft`/`clearDraft`, and `apps/client/src/builder/draft.ts` says so in its own
words: the `GameState.characterDrafts[]` store "is Phase 3 and does not exist yet." The
builder is also GM-gated; a player-initiated path is not shipped.
