# Horizon update handoff

This folder is the handoff as it arrived, committed on 2026-10-28 at the owner's request so later work can find it:
`docs/design/light-rail/horizon/` in the repository, beside the first Light rail handoff one folder up. ADR-0046 records
the decision, and `docs/DESIGN.md` holds the rules. The update was built on `claude/friendly-babbage-g7gcge` as U1 to U6.
ESLint and Prettier skip this folder, so it stays as written; the zip it came in is not committed.

Everything a session needs to update the Light rail work already built on `claude/friendly-babbage-g7gcge` (phases 0 to 8) to what the user chose since: the Cup primary button, Chakra Petch for plain display lettering, and Horizon light.

- `UPDATE-PLAN.md` is the plan. Start there. Sections 1 to 4 are the decisions, the rules, what is on the branch now and the exact values. Section 5 is the work in six phases, U1 to U6.
- `mockups/light-rail-horizon.html` is the full Light rail player with a Tone switch in its top bar. Horizon is the target; Before is what the branch built. Open it in a browser (fonts load from Google Fonts; everything else is inline). Also published for the user at https://claude.ai/artifact/WBJWQXU7LwBpHjrPT4Hpi9.
- `mockups/cup-button.html` is the Cup primary with its states and five in-app scenes, beside the Terminal and Cradle versions the user compared it with. It opens on Cup. Also published at https://claude.ai/artifact/Ft6TJBxrg2AD33hXs6FNb5#cup.
- `mockups/*-src/` hold each mockup's source in parts. `sh build.sh` in a source folder rebuilds its page. Section 8 of the plan says where each idea lives.
- `history/` has the three rounds of button mockups that led here: replacements for the magenta button, five faces, and the Rail versions in six colours. Context only; the choices are made.

Nothing here has been committed to the repository. The plan was read against `marcsfsh/OzyVTT` at `55c0707` on `claude/friendly-babbage-g7gcge`. The user chose that branch, and another session commits there too, so section 2 says how to share it.
