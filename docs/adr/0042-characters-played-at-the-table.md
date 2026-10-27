# ADR-0042: Characters played at the table

## Status

Accepted on 2026-10-27, with the owner's choices: the mark is saved on the character and can be changed for one
encounter, and the GM types the dice for such a character.

## Context and decision drivers

At the owner's tables most players never open the app. They keep a printed sheet, watch the table screen and tell the
GM what they do ("I move 20 feet to the goblin and swing my mace"), and the GM carries it out. Today a character
nobody has claimed already falls to the GM in most places (reaction prompts, the initiative it doesn't roll itself),
but nothing says so: a stray phone can claim it, the player-facing prompts look like someone else's job, and the
GM's tools for acting as that character are scattered.

Drivers: the server decides who answers what (authorization from the token, never from the client); the GM may act
on anything; nothing for a played-at-the-table character waits on a device nobody holds; and a character can move
between playstyles without being rebuilt.

## Considered options

1. Infer it from "unclaimed". Rejected: an unclaimed character might be about to be claimed, and the GM can't tell
   the difference at a glance.
2. A saved mark on the character, with a per-encounter override. Chosen.
3. A per-encounter choice only. Rejected: the owner's players keep their playstyle from session to session.

## Decision

- **The mark.** A party character gains `playedAtTable: boolean` (default false), GM-only to change, set from Party
  and from the character's GM tools. While it is set the character can't be claimed: a claim is refused with "Lyra is
  played at the table." A claimed character can't be marked until it is released.
- **For one encounter.** Start the encounter lists each party character in it with "At the table" or "On their
  device" (the saved mark's value first). The choice is kept on the encounter's combat while it runs and goes with
  it; changing the saved mark mid-encounter changes nothing until the next start.
- **Who answers.** For a character played at the table, every prompt that would go to its player goes to the GM's
  Needs you: rolling its own initiative, a saving throw, a reaction offered to it, a death save, a choice its feature
  asks for. Initiative "players roll their own" skips it, so it is rolled (or typed by the GM) at the start.
- **Acting for it.** On its turn the GM's acting card is that character's: its actions, its sheet a tap away, and the
  same commands a player uses, sent by the GM (who may act on anything already).
- **Dice.** The GM types its rolls, as the player reports them (ADR-0043): the box asks for the total, whatever the
  players' dice setting is.
- **Seen by others.** Nothing new: the mark and the per-encounter choice are GM-only, so players and the table screen
  get no field they didn't before.
- **Storage.** An optional field on the actor and on the running combat's entry, read with a default; no SQL
  migration.

## Consequences and tradeoffs

- The GM sees at once who is played at the table and is never left waiting on a device nobody holds.
- A character marked at the table can't be claimed by mistake; unmarking it is one switch.

## Mobile, security, and visibility impact

GM-only fields; projections unchanged and tested to stay so. The Start the encounter list gains one switch per
character, 44px at 390px.

## Migration / reversibility

Additive; every saved character starts unmarked, so nothing changes until the GM marks one.

## Validation evidence

To be added with the code: the claim refusal, each prompt routed to the GM, initiative skipping the character, the
per-encounter override, both transports, and the projection tests.
