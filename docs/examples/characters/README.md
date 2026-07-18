# Example importable characters

Three ready-to-import level 7 player characters that complement the seeded starter party
(Borin the fighter, Mirena the cleric, Lyra the wizard — see
`apps/server/src/initial-game-state.ts`), giving a table of six with every combat system
covered:

| File | Character | Role |
| --- | --- | --- |
| `torva-grimtusk-barbarian-7.json` | **Torva Grimtusk**, half-orc Berserker barbarian | Reckless melee damage, Rage, huge HP pool |
| `pip-underbough-rogue-7.json` | **Pip Underbough**, halfling Thief rogue (Small token) | Sneak Attack skirmisher, Cunning Action, Uncanny Dodge reaction |
| `sable-vex-warlock-7.json` | **Sable Vex**, tiefling Fiend warlock | Eldritch Blast artillery, Hex, pact-slot Fireball, Hellish Rebuke reaction |

Each file is a canonical `ActorDefinition` (`vtt.actor-character`, schema version 1,
validated against `@vtt/schemas`). Mechanics follow SRD 5.2.1 (CC BY 4.0); the characters
themselves are original. Conditional damage the action runner can't decide for you (Rage's
+2, Sneak Attack eligibility, Hex's +1d6) is spelled out in each action's description —
the rogue additionally ships a combined "Rapier + Sneak Attack" action for the common case.

## Import through the UI

GM mode → roster → **Import sheet** → pick a JSON file. The character arrives public and
claimable; the full stat block is stored with the campaign and shown to the GM and the
owning player.

## Import through the API

```bash
curl -s -X POST http://host:3001/api/v1/game/definitions/import \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"definition\": $(cat torva-grimtusk-barbarian-7.json)}"
```

`$TOKEN` is a GM session or an integration credential with `actor:write`. The response's
`actorId` is the new claimable actor; players then claim it from the character list (or via
`POST /api/v1/game/claims` with a player session). See `docs/api-reference.md`.
