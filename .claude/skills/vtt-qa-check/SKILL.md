---
name: vtt-qa-check
description: Use after significant implementation work on this repo, before calling it done, to review the change against its task packet. Checks acceptance criteria, viewer safety, GM/player role boundaries, mobile parity, regressions, and whether verification was real. Outputs pass / pass-with-notes / fix-required.
---

# vtt-qa-check

A milestone checkpoint, not a parallel bureaucracy. Run it once, at the end of meaningful
work, against the original task packet. Keep it cheap by running only at that boundary — not
on every edit.

## Inputs

The task packet (acceptance criteria + constraints), the diff, and the verification evidence
the implementer reported. If there's no packet, QA the change against the request and the
hard invariants directly.

## Checklist

1. **Acceptance criteria** — each one met and *observably* so (you can point at a check, a
   test, or a screenshot). Unmet or unverifiable criteria → fix-required.
2. **Viewer safety** — if projections or the viewer changed: does any GM-only actor, hidden
   token, private roll, hidden turn, or management field reach the public viewer? Any new
   field on a viewer projection must be justified. This is the highest-severity check.
3. **Role boundaries** — GM-only commands still gated per command; a player can act only on
   their claimed character; no authorization moved to or trusted from the client.
4. **Server authority** — no game decision (snapping, visibility, dice, turn order) landed on
   the client; client previews still mirror, not replace, the server result.
5. **Mobile parity** — works at a narrow viewport; new draggable/zoomable surfaces set
   `touch-action: none`; touch targets are usable. No mouse-only control.
6. **Regressions** — nearby behavior still works; contract changes in `packages/domain` are
   reflected on both client and server.
7. **Real verification** — `npm run check` / `npm test` / `npm run build` were actually run
   (not asserted), and UI work got a live browser + narrow-viewport pass. See `testing.md`.
   "Should work now" without evidence → fix-required on verification alone.

## Output

Return exactly one verdict:

- **pass** — criteria met, invariants held, verification real. One-line confirmation.
- **pass with notes** — shippable, but list minor/non-blocking follow-ups.
- **fix required** — something material failed. List each failure tersely, then output a
  **short follow-up prompt** the implementer can act on directly. Do **not** launch a long
  auto-remediation loop; hand back the prompt and stop.

Keep the report compact — a scannable checklist result, not a narrative. After a pass, prompt
`vtt-ledger-update` so the change is recorded.
