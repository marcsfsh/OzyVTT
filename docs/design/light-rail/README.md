# Light rail handoff

This folder is the handoff as it arrived, committed on 2026-10-28 at the owner's request so later work can find it:
`docs/design/light-rail/` in the repository. ADR-0045 records the decision and the Motion section of `docs/DESIGN.md`
holds the rules. Paths below are relative to this folder. ESLint and Prettier skip it, so it stays as written.
The Horizon update that followed (ADR-0046: the Cup primary, Chakra Petch titles and Horizon light) is in `horizon/`.

Everything a new session needs to build Light rail, the motion system the user chose for OzyVTT.

- `PLAN.md` is the implementation plan. Start there. Sections 1 to 4 are the decisions, the repo's rules and the architecture. Section 5 is the work in phases. Appendix A lists all 88 moments with where each lives in the code and what triggers it.
- `mockup/ozyvtt-light-rail.html` is the approved mockup as one standalone page. Open it in a browser (fonts load from Google Fonts; everything else is inline). Pick a group along the top and a moment along the bottom. Slow, 6x in the top bar stretches every timing. It's also published for the user at https://claude.ai/artifact/JiBCjnKGJkcj8TfLm6rYt8.
- `mockup/src/` is the mockup's source in parts. `sh mockup/src/build.sh` rebuilds the page after an edit. Appendix B of the plan says what each part holds.
- `mockup/history/` has the two earlier rounds the user chose from. They're context only; the choice is made.

Nothing here has been committed to the repository. The plan was researched against `marcsfsh/OzyVTT` on branch `claude/friendly-babbage-g7gcge` at `beb0637`, and the user chose that branch for the work. Another session commits design work there too, so section 2 of the plan says how to share it. Section 6 has the user's answers on branch, damage numbers, the camera glide and time.
